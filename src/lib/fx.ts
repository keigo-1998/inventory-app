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
