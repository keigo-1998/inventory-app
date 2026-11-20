"use server";
// 販売の記録と取り消し（docs/data-design.md「販売の記録」「同時出品の取り下げ」「縦積在庫の一部販売」）
// - 記録すると、商品は売却済み（廃棄・備品）になり、売れた販路が緑になる。ほかの出品先は外して、取り下げを知らせる
// - 縦積在庫はまだ残りがあれば出品中のまま
// - 外貨は売れた月の月初のTTMで仮に計算する（月末に平均TTMで確定するのは、これから作る）
// - 取り消しても記録は消さずに「取り消した」印を付け、商品と出品先を元に戻す
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { LIVE_SALE } from "@/lib/sale-live";
import { logChange } from "@/lib/history";
import { calcSale, type ChannelRule } from "@/lib/sale-calc";
import { saleRate } from "@/lib/fx";

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
        const item = await tx.item.findFirst({ where: { id: e.itemId, deletedAt: null }, include: { saleLines: { where: { sale: LIVE_SALE } } } });
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
          // 実送料は必ず入れる（空のまま0円で記録すると、入れ忘れに気づけないため）。かからなかったときは 0、分からないときは「未定」
          if (e.real == null && !e.tentative) throw new Error(`${item.code} の実送料を入れてください（かからなかったときは 0、まだ分からないときは「未定」）`);
          const fxr = await saleRate(tx, ch.currency, soldAt);
          if (fxr == null) throw new Error(`${ch.currency} の為替レートがまだありません。販売を記録 →「為替レート」で取り込んでください`);
          const rate = fxr.rate;
          const r = calcSale(rule(ch), rate, { price: e.price, ship: e.ship, fee: e.fee, feeTouched: e.feeTouched, real: e.real, cost });
          const fx = ch.currency !== "JPY";
          const cents = (v: number) => Math.round(v * 100);
          sale = await tx.sale.create({
            data: {
              soldAt, kind: "sale", channelId: ch.id, currency: ch.currency,
              priceForeign: fx ? cents(r.price) : null, shippingForeign: fx ? cents(r.shipIn) : null, feeForeign: fx ? cents(r.feeIn) : null,
              priceJpy: Math.round(r.priceY), shippingFeeJpy: Math.round(r.shipY), feeJpy: Math.round(r.feeY), actualShippingJpy: Math.round(r.realY),
              shippingTentative: e.tentative, fxRate: fx ? rate : null, fxRateFinal: fxr.final, shipped: e.shipped,
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
  try {
  await db.$transaction(async (tx) => {
    for (const id of p.data) {
      const sale = await tx.sale.findUnique({ where: { id }, include: { lines: true, adjustments: { where: { cancelledAt: null, kind: "return" } } } });
      if (!sale || sale.cancelledAt) continue;
      if (sale.adjustments.length) throw new Error("この販売は返品として記録されています。先に返品の記録を取り消してください");
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
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "取り消せませんでした" };
  }
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

// ---------- まとめて売る（山売り・合わせ売り） ----------
// docs/data-design.md「まとめて売る」：販売の記録は1件（1行）。中身はすべて売却済み。
// 売れた金額は、山ごとの成績のために中身に分ける（画面で決めた額。合計が売れた金額と合わないと記録できない）
// 粗利 ＝ 売れた金額 − 手数料 − 中身の原価の合計（金額は円で入れる）
const bundleInput = z.object({
  channel: z.string().min(1),
  date: z.string(),
  total: z.number().int().min(0),
  fee: z.number().int().min(0),
  real: z.number().int().min(0), // 実送料は必ず入れる（かからなかったときは 0）
  tentative: z.boolean().default(false), // 送料未定（仮の金額）
  parts: z.array(z.object({ itemId: z.number().int().positive(), amount: z.number().int().min(0) })).min(1).max(200),
});
export type BundleInput = z.input<typeof bundleInput>;
export type BundleResult = { ok: true; saleId: number; codes: string[]; others: { code: string; channels: string[] }[]; profit: number } | { ok: false; error: string };

export async function recordBundle(raw: BundleInput): Promise<BundleResult> {
  const p = bundleInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  const b = p.data;
  const sum = b.parts.reduce((a, x) => a + x.amount, 0);
  if (sum !== b.total) return { ok: false, error: `分けた額の合計（${sum.toLocaleString()}円）が、売れた金額（${b.total.toLocaleString()}円）と合っていません` };
  const soldAt = parseDate(b.date);
  if (!soldAt) return { ok: false, error: `売却日「${b.date}」を 2026/11/12 の形で入れてください` };
  try {
    const res = await db.$transaction(async (tx) => {
      const ch = await tx.channel.findFirst({ where: { name: b.channel, deletedAt: null } });
      if (!ch) throw new Error(`販路「${b.channel}」が見つかりません`);
      const items = await tx.item.findMany({ where: { id: { in: b.parts.map((x) => x.itemId) }, deletedAt: null }, include: { saleLines: { where: { sale: LIVE_SALE } } } });
      if (items.length !== b.parts.length) throw new Error("見つからない商品があります");
      for (const it of items) if (it.status !== "stock" && it.status !== "list") throw new Error(`${it.code} はもう在庫にありません`);
      // 中身は「残り全部」を売る（縦積在庫なら残りの個数ぶん）
      const lines = b.parts.map((x) => {
        const it = items.find((i) => i.id === x.itemId)!;
        const left = it.quantity - it.saleLines.reduce((a, l) => a + l.quantity, 0);
        return { it, qty: left, cost: it.unitCost * left, amount: x.amount };
      });
      const cost = lines.reduce((a, l) => a + l.cost, 0);
      const sale = await tx.sale.create({
        data: {
          soldAt, kind: "sale", channelId: ch.id, currency: "JPY", priceJpy: b.total, feeJpy: b.fee, actualShippingJpy: b.real, shippingTentative: b.tentative, fxRateFinal: true,
          note: "まとめて売る",
          lines: { create: lines.map((l) => ({ itemId: l.it.id, quantity: l.qty, costJpy: l.cost, amountJpy: l.amount })) },
        },
      });
      const profit = b.total - b.fee - b.real - cost;
      const note = "まとめて売る";
      await logChange(tx, { table: "Sale", recordId: sale.id, action: "create", after: { items: lines.map((l) => l.it.code), channel: ch.name, total: b.total, profit }, note });
      const others: { code: string; channels: string[] }[] = [];
      const now = new Date();
      for (const l of lines) {
        await tx.item.update({ where: { id: l.it.id }, data: { status: "sold" } });
        await logChange(tx, { table: "Item", recordId: l.it.id, action: "update", before: { status: l.it.status }, after: { status: "sold" }, note });
        const active = await tx.listing.findMany({ where: { itemId: l.it.id, state: "active" }, include: { channel: true } });
        const off: string[] = [];
        for (const a of active) {
          const here = a.channelId === ch.id;
          await tx.listing.update({ where: { id: a.id }, data: { state: here ? "sold" : "withdrawn", endedAt: now, endedBySaleId: sale.id } });
          if (!here) off.push(a.channel.name);
        }
        if (!active.some((a) => a.channelId === ch.id)) {
          await tx.listing.create({ data: { itemId: l.it.id, channelId: ch.id, state: "sold", endedAt: now, endedBySaleId: sale.id, createdBySale: true } });
        }
        if (off.length) others.push({ code: l.it.code, channels: off });
      }
      return { saleId: sale.id, codes: lines.map((l) => l.it.code), others, profit };
    });
    revalidatePath("/items");
    revalidatePath("/sales");
    revalidatePath("/lots/[code]", "page");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "記録できませんでした" };
  }
}
