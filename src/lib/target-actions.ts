"use server";
// ECの売上目標・粗利目標（月ごとに1つずつ）を入れる・消す
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";

export type TargetKind = "sales" | "profit";

export async function setTarget(month: string, kind: TargetKind, amount: number | null): Promise<{ ok: boolean; error?: string; before?: number | null }> {
  if (!/^\d{4}-\d{2}$/.test(month) || (kind !== "sales" && kind !== "profit")) return { ok: false, error: "入力の形が正しくありません" };
  if (amount != null && (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000_000)) return { ok: false, error: "目標は0以上の整数（円）で入れてください" };
  const field = kind === "sales" ? "amountJpy" : "profitJpy";
  const before = await db.$transaction(async (tx) => {
    const old = await tx.salesTarget.findUnique({ where: { month } });
    const row = await tx.salesTarget.upsert({ where: { month }, create: { month, [field]: amount }, update: { [field]: amount } });
    await logChange(tx, { table: "SalesTarget", recordId: row.id, action: old ? "update" : "create", before: { month, [field]: old?.[field] ?? null }, after: { month, [field]: amount }, note: kind === "sales" ? "売上目標" : "粗利目標" });
    return old?.[field] ?? null;
  });
  revalidatePath("/dashboard");
  return { ok: true, before };
}
