"use server";
// 返品と一部返金（docs/data-design.md「返品・キャンセル・一部返金」）
// - 返品: 販売の記録は消さずに「返品」として残す。売値は0円、行きの送料＋返品の送料＋戻らない手数料を損として残す。
//         商品は在庫に戻り、同じ管理番号のまま売り直せる
// - 一部返金: 返金した金額の分だけ粗利が減る。商品は売却済みのまま
// - 発送前のキャンセルは、販売の記録の取り消し（cancelSales）を使う
// - どれも「元に戻す」ができる（記録は消さずに取り消しの印を付ける）
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { LIVE_SALE } from "@/lib/sale-live";
import { returnLoss } from "@/lib/sale-calc";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export type AdjResult = { ok: true; adjId: number; loss?: number; codes: string[] } | { ok: false; error: string };

function parseDate(s: string): Date | null {
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s.normalize("NFKC").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d) - 9 * 3600 * 1000);
  const back = new Date(dt.getTime() + 9 * 3600 * 1000);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? dt : null;
}

/** 商品の状態を、出品先と有効な販売から決め直す */
async function refreshItem(tx: Tx, itemId: number, note: string) {
  const item = await tx.item.findUniqueOrThrow({ where: { id: itemId }, include: { saleLines: { where: { sale: LIVE_SALE }, include: { sale: true } } } });
  const left = item.quantity - item.saleLines.reduce((a, l) => a + l.quantity, 0);
  const active = await tx.listing.count({ where: { itemId, state: "active" } });
  const lastKind = item.saleLines.map((l) => l.sale).sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())[0]?.kind;
  const next = left > 0 ? (active > 0 ? "list" : "stock") : lastKind === "disposed" ? "disposed" : lastKind === "fixture" ? "fixture" : lastKind === "closed" ? "closed" : "sold";
  if (item.status !== next) {
    await tx.item.update({ where: { id: itemId }, data: { status: next } });
    await logChange(tx, { table: "Item", recordId: itemId, action: "update", before: { status: item.status }, after: { status: next }, note });
  }
}

const base = z.object({ saleId: z.number().int().positive(), date: z.string(), note: z.string().max(500).optional() });

/** 返品（商品が戻ってくる） */
export async function recordReturn(raw: z.input<typeof base> & { returnShipping: number; lostFee: number; outboundBack: boolean }): Promise<AdjResult> {
  const p = base.extend({ returnShipping: z.number().int().min(0), lostFee: z.number().int().min(0), outboundBack: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  const date = parseDate(p.data.date);
  if (!date) return { ok: false, error: "返品の日を 2026/11/15 の形で入れてください" };
  const note = "返品を記録";
  try {
    const r = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id: p.data.saleId, ...LIVE_SALE }, include: { lines: { include: { item: true } } } });
      if (!sale) throw new Error("この販売の記録が見つかりません（取り消し済み・返品済みかもしれません）");
      if (sale.kind !== "sale") throw new Error("廃棄・備品の記録は返品にできません。販売を取り消してください");
      const adj = await tx.saleAdjustment.create({
        data: { saleId: sale.id, kind: "return", date, returnShippingJpy: p.data.returnShipping, lostFeeJpy: p.data.lostFee, outboundBack: p.data.outboundBack, note: p.data.note || null },
      });
      const loss = returnLoss(sale, adj);
      await logChange(tx, { table: "SaleAdjustment", recordId: adj.id, action: "create", after: { saleId: sale.id, kind: "return", loss }, note });
      // 売れた販路の印（緑）は「返品」にする。ほかの販路は取り下げのまま（出品し直すときは出品先を押す）
      await tx.listing.updateMany({ where: { endedBySaleId: sale.id, state: "sold" }, data: { state: "returned" } });
      for (const l of sale.lines) await refreshItem(tx, l.itemId, note);
      return { ok: true as const, adjId: adj.id, loss, codes: sale.lines.map((l) => l.item.code) };
    });
    revalidatePath("/items");
    revalidatePath("/sales");
    return r;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "記録できませんでした" };
  }
}

/** 一部だけ返金（商品は売却済みのまま） */
export async function recordRefund(raw: z.input<typeof base> & { amount: number; via: string }): Promise<AdjResult> {
  const p = base.extend({ amount: z.number().int().min(1), via: z.enum(["payout", "bank"]) }).safeParse(raw);
  if (!p.success) return { ok: false, error: "返金した金額を入れてください" };
  const date = parseDate(p.data.date);
  if (!date) return { ok: false, error: "返金した日を 2026/11/15 の形で入れてください" };
  try {
    const r = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id: p.data.saleId, ...LIVE_SALE }, include: { lines: { include: { item: true } } } });
      if (!sale || sale.kind !== "sale") throw new Error("この販売の記録が見つかりません");
      const adj = await tx.saleAdjustment.create({ data: { saleId: sale.id, kind: "refund", date, refundJpy: p.data.amount, via: p.data.via, note: p.data.note || null } });
      await logChange(tx, { table: "SaleAdjustment", recordId: adj.id, action: "create", after: { saleId: sale.id, kind: "refund", refundJpy: p.data.amount, via: p.data.via }, note: "一部返金を記録" });
      return { ok: true as const, adjId: adj.id, codes: sale.lines.map((l) => l.item.code) };
    });
    revalidatePath("/items");
    return r;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "記録できませんでした" };
  }
}

/** 返品・一部返金の記録を取り消す（元に戻す） */
export async function cancelAdjustment(adjId: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(adjId) || adjId <= 0) return { ok: false, error: "入力の形が正しくありません" };
  const note = "返品・返金の記録を取り消す";
  try {
    await db.$transaction(async (tx) => {
      const adj = await tx.saleAdjustment.findUnique({ where: { id: adjId }, include: { sale: { include: { lines: { include: { item: true } } } } } });
      if (!adj || adj.cancelledAt) return;
      if (adj.kind === "return") {
        // 戻った商品をもう出品したり売ったりしていたら、先にそちらを戻してもらう
        for (const l of adj.sale.lines) {
          const it = await tx.item.findUniqueOrThrow({ where: { id: l.itemId }, include: { saleLines: { where: { sale: LIVE_SALE } } } });
          const left = it.quantity - it.saleLines.reduce((a, x) => a + x.quantity, 0);
          if (left < l.quantity) throw new Error(`${it.code} は返品のあとにもう売れているので、返品を取り消せません`);
          if (it.quantity === 1 && (await tx.listing.count({ where: { itemId: it.id, state: "active" } })) > 0)
            throw new Error(`${it.code} は返品のあとに出品しています。先に出品先を外してから取り消してください`);
        }
      }
      await tx.saleAdjustment.update({ where: { id: adjId }, data: { cancelledAt: new Date() } });
      await logChange(tx, { table: "SaleAdjustment", recordId: adjId, action: "delete", note });
      if (adj.kind === "return") {
        await tx.listing.updateMany({ where: { endedBySaleId: adj.saleId, state: "returned" }, data: { state: "sold" } });
        for (const l of adj.sale.lines) await refreshItem(tx, l.itemId, note);
      }
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "取り消せませんでした" };
  }
  revalidatePath("/items");
  revalidatePath("/sales");
  return { ok: true };
}
