"use server";
// 為替レートの取り込みと、月末の確定（docs/data-design.md「為替レート（自動）」）
// - 月の途中: その月の月初のTTM（その月で最初に発表された日）で仮に計算している
// - 月が終わったら: 三菱UFJ銀行の「月中平均」のTTMで、その月の外貨の販売をすべて計算し直して確定する
// - 確定は取り消せる（月初のTTMの仮の計算に戻す）
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { monthRate, monthOf, monthRange, thisMonth } from "@/lib/fx";
import { fetchDaily, fetchDays, fetchMonthAvg, CURRENCIES } from "@/lib/mufg";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const jstDate = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`);

/** 三菱UFJの発表から、まだ持っていないレートを取り込む（各月の月初の日と、終わった月の月中平均） */
export async function syncRates(): Promise<{ ok: boolean; added: string[]; error?: string }> {
  const added: string[] = [];
  const days = await fetchDays();
  if (!days.length) return { ok: false, added, error: "三菱UFJのページを読めませんでした。時間をおいて試すか、手で入れてください" };
  // 各月で最初に発表された日（＝月初のTTM。月の途中の仮のレートに使う）
  const firstOfMonth = new Map<string, string>();
  for (const d of days) if (!firstOfMonth.has(d.slice(0, 7))) firstOfMonth.set(d.slice(0, 7), d);
  // いちばん古い月は途中からしか載っていないことがあるので、その月の1日〜5日に発表がある場合だけ使う
  for (const [month, d] of firstOfMonth) {
    if (Number(d.slice(8)) > 5) continue;
    const have = await db.exchangeRate.count({ where: { date: jstDate(d) } });
    if (have >= CURRENCIES.length) continue;
    const r = await fetchDaily(d);
    if (!r) continue;
    for (const c of CURRENCIES) {
      if (r[c] == null) continue;
      await db.exchangeRate.upsert({ where: { currency_date: { currency: c, date: jstDate(d) } }, create: { currency: c, date: jstDate(d), ttm: r[c]!, source: "mufg" }, update: { ttm: r[c]!, source: "mufg" } });
    }
    added.push(`${month} の月初（${d.slice(5).replace("-", "/")}）`);
  }
  // 終わった月の月中平均（今月より前で、外貨の販売がある月と、直近3か月）
  const now = thisMonth();
  const months = new Set([...firstOfMonth.keys()].filter((m) => m < now));
  const fx = await db.sale.findMany({ where: { cancelledAt: null, currency: { not: "JPY" } }, select: { soldAt: true } });
  for (const s of fx) { const m = monthOf(s.soldAt); if (m < now) months.add(m); }
  for (const m of months) {
    const have = await db.monthRate.count({ where: { month: m } });
    if (have >= CURRENCIES.length) continue;
    const r = await fetchMonthAvg(m);
    if (!r) continue;
    for (const c of CURRENCIES) {
      if (r[c] == null) continue;
      await db.monthRate.upsert({ where: { currency_month: { currency: c, month: m } }, create: { currency: c, month: m, ttm: r[c]!, source: "mufg" }, update: { ttm: r[c]!, source: "mufg" } });
    }
    added.push(`${m} の月中平均`);
  }
  revalidatePath("/sales");
  return { ok: true, added };
}

/** 三菱UFJのページが読めないときのために、手で入れる */
export async function saveRateByHand(raw: { kind: "day" | "month"; key: string; currency: string; ttm: number }): Promise<{ ok: boolean; error?: string }> {
  const p = z.object({ kind: z.enum(["day", "month"]), key: z.string(), currency: z.enum(CURRENCIES), ttm: z.number().positive().max(10000) }).safeParse(raw);
  if (!p.success) return { ok: false, error: "レートは数字で入れてください" };
  const { kind, key, currency, ttm } = p.data;
  if (kind === "day") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return { ok: false, error: "日付の形が正しくありません" };
    await db.exchangeRate.upsert({ where: { currency_date: { currency, date: jstDate(key) } }, create: { currency, date: jstDate(key), ttm, source: "manual" }, update: { ttm, source: "manual" } });
  } else {
    if (!/^\d{4}-\d{2}$/.test(key)) return { ok: false, error: "月の形が正しくありません" };
    await db.monthRate.upsert({ where: { currency_month: { currency, month: key } }, create: { currency, month: key, ttm, source: "manual" }, update: { ttm, source: "manual" } });
  }
  revalidatePath("/sales");
  return { ok: true };
}

/** 外貨の販売1件を、あるレートで計算し直す（外貨の金額から円をもう一度出す） */
async function reprice(tx: Tx, saleId: number, rate: number, final: boolean, note: string) {
  const s = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: true } });
  // 外貨の金額がない項目（円だけで入れたもの）は、円の金額をそのまま残す（0円にしない）
  const yen = (cents: number | null, keep: number) => (cents == null ? keep : Math.round((cents / 100) * rate));
  const after = { fxRate: rate, fxRateFinal: final, priceJpy: yen(s.priceForeign, s.priceJpy), shippingFeeJpy: yen(s.shippingForeign, s.shippingFeeJpy), feeJpy: yen(s.feeForeign, s.feeJpy) };
  await tx.sale.update({ where: { id: saleId }, data: after });
  // 1点だけの販売なら、その商品の分＝売値
  if (s.lines.length === 1) await tx.saleLine.update({ where: { id: s.lines[0].id }, data: { amountJpy: after.priceJpy } });
  await logChange(tx, {
    table: "Sale", recordId: saleId, action: "update",
    before: { fxRate: s.fxRate == null ? null : Number(s.fxRate), fxRateFinal: s.fxRateFinal, priceJpy: s.priceJpy, shippingFeeJpy: s.shippingFeeJpy, feeJpy: s.feeJpy },
    after, note,
  });
}

/** 終わった月を、月中平均のTTMで確定する */
export async function finalizeMonth(month: string): Promise<{ ok: true; count: number; rates: Record<string, number> } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "月の形が正しくありません" };
  if (month >= thisMonth()) return { ok: false, error: "月が終わってから確定できます" };
  const { start, end } = monthRange(month);
  const sales = await db.sale.findMany({ where: { cancelledAt: null, currency: { not: "JPY" }, soldAt: { gte: start, lt: end } } });
  const need = [...new Set(sales.map((s) => s.currency))];
  const rates: Record<string, number> = {};
  for (const c of need) {
    let r = await db.monthRate.findUnique({ where: { currency_month: { currency: c, month } } });
    if (!r) {
      const got = await fetchMonthAvg(month);
      const v = got?.[c as (typeof CURRENCIES)[number]];
      if (v != null) r = await db.monthRate.create({ data: { currency: c, month, ttm: v, source: "mufg" } });
    }
    if (!r) return { ok: false, error: `${month.replace("-", "年")}月の ${c} の月中平均がまだありません。「最新のレートを取り込む」を押すか、手で入れてください` };
    rates[c] = Number(r.ttm);
  }
  await db.$transaction(async (tx) => {
    for (const s of sales) await reprice(tx, s.id, rates[s.currency], true, `${month} の為替を確定（月中平均TTM）`);
  });
  revalidatePath("/sales");
  revalidatePath("/items");
  return { ok: true, count: sales.length, rates };
}

/** 確定を取り消して、月初のTTMの仮の計算に戻す */
export async function unfinalizeMonth(month: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "月の形が正しくありません" };
  const { start, end } = monthRange(month);
  try {
    await db.$transaction(async (tx) => {
      const sales = await tx.sale.findMany({ where: { cancelledAt: null, currency: { not: "JPY" }, soldAt: { gte: start, lt: end } } });
      for (const s of sales) {
        const r = await monthRate(tx, s.currency, s.soldAt);
        if (r == null) throw new Error(`${s.currency} の月初のレートがありません`);
        await reprice(tx, s.id, r, false, `${month} の為替の確定を取り消す`);
      }
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "取り消せませんでした" };
  }
  revalidatePath("/sales");
  revalidatePath("/items");
  return { ok: true };
}
