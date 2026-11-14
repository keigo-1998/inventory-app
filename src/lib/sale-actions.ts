"use server";
// 販売の記録と取り消し（docs/data-design.md「販売の記録」「同時出品の取り下げ」「縦積在庫の一部販売」）
// - 記録すると、商品は売却済み（廃棄・備品）になり、売れた販路が緑になる。ほかの出品先は外して、取り下げを知らせる
// - 縦積在庫はまだ残りがあれば出品中のまま
// - 外貨は売れた月の月初のTTMで仮に計算する（月末に平均TTMで確定するのは、これから作る）
// - 取り消しても記録は消さずに「取り消した」印を付け、商品と出品先を元に戻す
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { calcSale, type ChannelRule } from "@/lib/sale-calc";
import { monthRate } from "@/lib/fx";

const SPECIAL = { 廃棄: "disposed", 備品にした: "fixture" } as const;

const entry = z.object({
  itemId: z.number().int().positive(),
  channel: z.string().min(1), // 販路の名前、または「廃棄」「備品にした」
  date: z.string(),
  qty: z.number().int().min(1).default(1),
  price: z.number().min(0).nullable(),
  ship: z.number().min(0).nullable(),
  fee: z.number().min(0).nullable(),
  feeTouched: z.boolean(),
  real: z.number().int().min(0).nullable(),
  tentative: z.boolean().default(false),
  shipped: z.boolean().default(false),
});
export type SaleEntry = z.input<typeof entry>;
export type SaleDone = { saleId: number; code: string; name: string; channel: string; qty: number; left: number | null; others: string[]; profit: number | null; priceJpy: number };
export type SaleResult = { ok: true; done: SaleDone[] } | { ok: false; error: string };

function parseDate(s: string): Date | null {
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s.normalize("NFKC").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d) - 9 * 3600 * 1000);
  const back = new Date(dt.getTime() + 9 * 3600 * 1000);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? dt : null;
}

const rule = (c: { name: string; currency: string; feeMode: string; feeRate: unknown; feeHintRate: unknown; usesShippingFee: boolean; undecided: boolean }): ChannelRule => ({
  name: c.name, currency: c.currency, feeMode: c.feeMode, feeRate: c.feeRate == null ? null : Number(c.feeRate),
  feeHintRate: c.feeHintRate == null ? null : Number(c.feeHintRate), usesShippingFee: c.usesShippingFee, undecided: c.undecided,
});

/** 販売を記録する（1件でも、まとめてでも） */
export async function recordSales(raw: SaleEntry[], note = "販売を記録"): Promise<SaleResult> {
  const p = z.array(entry).min(1).max(200).safeParse(raw);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  try {
    const done = await db.$transaction(async (tx) => {
      const out: SaleDone[] = [];
      for (const e of p.data) {
        const soldAt = parseDate(e.date);
        if (!soldAt) throw new Error(`売却日「${e.date}」を 2026/11/12 の形で入れてください`);
        const item = await tx.item.findFirst({ where: { id: e.itemId, deletedAt: null }, include: { saleLines: { where: { sale: { cancelledAt: null } } } } });
        if (!item) throw new Error("商品が見つかりません");
        if (item.status !== "stock" && item.status !== "list") throw new Error(`${item.code} はもう在庫にありません（売却済みなど）`);
        const soldQty = item.saleLines.reduce((a, l) => a + l.quantity, 0);
        const left = item.quantity - soldQty;
        if (e.qty > left) throw new Error(`${item.code} の在庫は残り${left}個です`);
        const cost = item.unitCost * e.qty;
        const special = SPECIAL[e.channel as keyof typeof SPECIAL];

        let sale;
        let profit: number | null = null;
        let channelName = e.channel;
        if (special) {
          sale = await tx.sale.create({ data: { soldAt, kind: special, lines: { create: [{ itemId: item.id, quantity: e.qty, costJpy: cost, amountJpy: 0 }] } } });
        } else {
          const ch = await tx.channel.findFirst({ where: { name: e.channel, deletedAt: null } });
          if (!ch) throw new Error(`販路「${e.channel}」が見つかりません`);
          channelName = ch.name;
          const rate = await monthRate(tx, ch.currency, soldAt);
          if (rate == null) throw new Error(`${ch.currency} の為替レートがまだありません`);
          const r = calcSale(rule(ch), rate, { price: e.price, ship: e.ship, fee: e.fee, feeTouched: e.feeTouched, real: e.real, cost });
          const fx = ch.currency !== "JPY";
          const cents = (v: number) => Math.round(v * 100);
          sale = await tx.sale.create({
            data: {
              soldAt, kind: "sale", channelId: ch.id, currency: ch.currency,
              priceForeign: fx ? cents(r.price) : null, shippingForeign: fx ? cents(r.shipIn) : null, feeForeign: fx ? cents(r.feeIn) : null,
              priceJpy: Math.round(r.priceY), shippingFeeJpy: Math.round(r.shipY), feeJpy: Math.round(r.feeY), actualShippingJpy: Math.round(r.realY),
              shippingTentative: e.tentative, fxRate: fx ? rate : null, fxRateFinal: !fx, shipped: e.shipped,
              lines: { create: [{ itemId: item.id, quantity: e.qty, costJpy: cost, amountJpy: Math.round(r.priceY) }] },
            },
          });
          profit = sale.priceJpy + sale.shippingFeeJpy - sale.actualShippingJpy - sale.feeJpy - cost;
        }
        await logChange(tx, { table: "Sale", recordId: sale.id, action: "create", after: { item: item.code, channel: channelName, qty: e.qty, priceJpy: sale.priceJpy, profit }, note });

        // 縦積在庫でまだ残りがあれば、出品中のまま（取り下げのお知らせも出さない）
        const remain = left - e.qty;
        let others: string[] = [];
        if (remain <= 0) {
          const next = special ?? "sold";
          await tx.item.update({ where: { id: item.id }, data: { status: next } });
          await logChange(tx, { table: "Item", recordId: item.id, action: "update", before: { status: item.status }, after: { status: next }, note });
          const active = await tx.listing.findMany({ where: { itemId: item.id, state: "active" }, include: { channel: true } });
          const now = new Date();
          for (const l of active) {
            const isSoldHere = !special && l.channel.name === channelName;
            await tx.listing.update({ where: { id: l.id }, data: { state: isSoldHere ? "sold" : "withdrawn", endedAt: now, endedBySaleId: sale.id } });
            if (!isSoldHere) others.push(l.channel.name);
          }
          // 出品先に入っていなかった販路で売れたときは、売れた販路の行を作る（緑の印のため）
          if (!special && !active.some((l) => l.channel.name === channelName)) {
            await tx.listing.create({ data: { itemId: item.id, channelId: sale.channelId!, state: "sold", endedAt: now, endedBySaleId: sale.id, createdBySale: true } });
          }
          if (special) others = []; // 廃棄・備品は取り下げのお知らせを出さない（出品先は外す）
        }
        out.push({ saleId: sale.id, code: item.code, name: item.name, channel: channelName, qty: e.qty, left: item.quantity > 1 ? remain : null, others, profit, priceJpy: sale.priceJpy });
      }
      return out;
    });
    revalidatePath("/items");
    revalidatePath("/sales");
    return { ok: true, done };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "記録できませんでした" };
  }
}

/** 販売の記録を取り消す（記録は消さずに印を付ける。商品と出品先は記録する前に戻す） */
export async function cancelSales(saleIds: number[], note = "販売の記録を取り消す"): Promise<{ ok: boolean; error?: string }> {
  const p = z.array(z.number().int().positive()).min(1).safeParse(saleIds);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  await db.$transaction(async (tx) => {
    for (const id of p.data) {
      const sale = await tx.sale.findUnique({ where: { id }, include: { lines: true } });
      if (!sale || sale.cancelledAt) continue;
      await tx.sale.update({ where: { id }, data: { cancelledAt: new Date() } });
      await logChange(tx, { table: "Sale", recordId: id, action: "delete", note });
      // この販売で終わった出品先を元に戻す。販売が作った行は「取り消し」にする
      const ended = await tx.listing.findMany({ where: { endedBySaleId: id } });
      for (const l of ended) {
        if (l.createdBySale) await tx.listing.update({ where: { id: l.id }, data: { state: "cancelled", endedBySaleId: null } });
        else await tx.listing.update({ where: { id: l.id }, data: { state: "active", endedAt: null, endedBySaleId: null } });
      }
      for (const line of sale.lines) {
        const item = await tx.item.findUniqueOrThrow({ where: { id: line.itemId } });
        const active = await tx.listing.count({ where: { itemId: item.id, state: "active" } });
        const next = active > 0 ? "list" : "stock";
        if (item.status !== next) {
          await tx.item.update({ where: { id: item.id }, data: { status: next } });
          await logChange(tx, { table: "Item", recordId: item.id, action: "update", before: { status: item.status }, after: { status: next }, note });
        }
      }
    }
  });
  revalidatePath("/items");
  revalidatePath("/sales");
  return { ok: true };
}

/** 送料未定の販売に、本当の送料を入れて確定する */
export async function fixShipping(saleId: number, real: number): Promise<{ ok: boolean; before?: number; error?: string }> {
  const p = z.object({ id: z.number().int().positive(), real: z.number().int().min(0) }).safeParse({ id: saleId, real });
  if (!p.success) return { ok: false, error: "送料を0以上の数字で入れてください" };
  const sale = await db.sale.findUnique({ where: { id: p.data.id } });
  if (!sale || sale.cancelledAt) return { ok: false, error: "販売の記録が見つかりません" };
  await db.$transaction(async (tx) => {
    await tx.sale.update({ where: { id: sale.id }, data: { actualShippingJpy: p.data.real, shippingTentative: false } });
    await logChange(tx, { table: "Sale", recordId: sale.id, action: "update", before: { actualShippingJpy: sale.actualShippingJpy, shippingTentative: true }, after: { actualShippingJpy: p.data.real, shippingTentative: false }, note: "本当の送料を入れて確定" });
  });
  revalidatePath("/items");
  revalidatePath("/sales");
  return { ok: true, before: sale.actualShippingJpy };
}

/** 確定した送料を、仮の金額に戻す（「元に戻す」） */
export async function unfixShipping(saleId: number, before: number): Promise<{ ok: boolean }> {
  await db.$transaction(async (tx) => {
    const s = await tx.sale.findUnique({ where: { id: saleId } });
    if (!s) return;
    await tx.sale.update({ where: { id: saleId }, data: { actualShippingJpy: before, shippingTentative: true } });
    await logChange(tx, { table: "Sale", recordId: saleId, action: "update", before: { actualShippingJpy: s.actualShippingJpy, shippingTentative: false }, after: { actualShippingJpy: before, shippingTentative: true }, note: "送料の確定を元に戻す" });
  });
  revalidatePath("/items");
  revalidatePath("/sales");
  return { ok: true };
}
