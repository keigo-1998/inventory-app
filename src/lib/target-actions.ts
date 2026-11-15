"use server";
// ECの売上目標（月ごとに1つ）を入れる・消す
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";

export async function setTarget(month: string, amount: number | null): Promise<{ ok: boolean; error?: string; before?: number | null }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "月の形が正しくありません" };
  if (amount != null && (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000_000)) return { ok: false, error: "目標は0以上の整数（円）で入れてください" };
  const before = await db.$transaction(async (tx) => {
    const old = await tx.salesTarget.findUnique({ where: { month } });
    if (amount == null) { if (old) await tx.salesTarget.delete({ where: { month } }); }
    else await tx.salesTarget.upsert({ where: { month }, create: { month, amountJpy: amount }, update: { amountJpy: amount } });
    await logChange(tx, { table: "SalesTarget", recordId: old?.id ?? 0, action: amount == null ? "delete" : old ? "update" : "create", before: { month, amount: old?.amountJpy ?? null }, after: { month, amount }, note: "売上目標" });
    return old?.amountJpy ?? null;
  });
  revalidatePath("/dashboard");
  return { ok: true, before };
}
