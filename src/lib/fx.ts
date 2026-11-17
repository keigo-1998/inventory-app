// 為替レート（docs/data-design.md「為替レート（自動）」）
// 基準は売れた月の平均TTM。月の途中は、その月の月初のTTMを仮のレートとして使う
import type { Prisma, PrismaClient } from "@prisma/client";

/** 売れた月の月初のTTM（その月のいちばん早い日のレート。なければ、それより前でいちばん新しいレート）。円は1 */
export async function monthRate(tx: Prisma.TransactionClient | PrismaClient, currency: string, soldAt: Date): Promise<number | null> {
  if (currency === "JPY") return 1;
  const jst = new Date(soldAt.getTime() + 9 * 3600 * 1000);
  const start = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600 * 1000);
  const end = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1) - 9 * 3600 * 1000);
  const r =
    (await tx.exchangeRate.findFirst({ where: { currency, date: { gte: start, lt: end } }, orderBy: { date: "asc" } })) ??
    (await tx.exchangeRate.findFirst({ where: { currency, date: { lt: start } }, orderBy: { date: "desc" } }));
  return r ? Number(r.ttm) : null;
}

/** "2026-10" の形の月（日本時間） */
export const monthOf = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
export const thisMonth = () => monthOf(new Date());
/** "2026-10" の月の、はじめと次の月のはじめ（日本時間） */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - 9 * 3600 * 1000), end: new Date(Date.UTC(y, m, 1) - 9 * 3600 * 1000) };
}

/** 販売を記録するときのレート。もう終わった月で月中平均があれば、それで確定。なければ月初のTTMで仮 */
export async function saleRate(tx: Prisma.TransactionClient | PrismaClient, currency: string, soldAt: Date): Promise<{ rate: number; final: boolean } | null> {
  if (currency === "JPY") return { rate: 1, final: true };
  const month = monthOf(soldAt);
  if (month < thisMonth()) {
    const avg = await tx.monthRate.findUnique({ where: { currency_month: { currency, month } } });
    if (avg) return { rate: Number(avg.ttm), final: true };
  }
  const r = await monthRate(tx, currency, soldAt);
  return r == null ? null : { rate: r, final: false };
}
