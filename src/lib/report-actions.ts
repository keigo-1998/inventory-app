"use server";
// 月次レポート：実際の振込額を入れる・確定して保存する（第1版、第2版…）
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { buildReport } from "@/lib/report";
import { thisMonth } from "@/lib/fx";

const monthOk = (m: string) => /^\d{4}-\d{2}$/.test(m);

/** 販路の実際の振込額を入れる（空にすると未入力に戻す） */
export async function savePaid(month: string, channel: string, amount: number | null): Promise<{ ok: boolean; error?: string }> {
  const p = z.object({ month: z.string().refine(monthOk), channel: z.string().min(1), amount: z.number().int().nullable() }).safeParse({ month, channel, amount });
  if (!p.success) return { ok: false, error: "金額は整数で入れてください" };
  await db.$transaction(async (tx) => {
    const row = await tx.monthlyReport.upsert({ where: { month_version: { month, version: 0 } }, create: { month, version: 0 }, update: {} });
    const paid = JSON.parse(row.paid) as Record<string, number>;
    const before = paid[channel] ?? null;
    if (amount == null) delete paid[channel]; else paid[channel] = amount;
    await tx.monthlyReport.update({ where: { id: row.id }, data: { paid: JSON.stringify(paid) } });
    await logChange(tx, { table: "MonthlyReport", recordId: row.id, action: "update", before: { [channel]: before }, after: { [channel]: amount }, note: `${month} の振込額` });
  });
  revalidatePath("/report");
  return { ok: true };
}

/** 確定して保存する。前の版があれば、次の版として保存する（前の版は消さない） */
export async function fixReport(month: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  if (!monthOk(month)) return { ok: false, error: "月の形が正しくありません" };
  if (month >= thisMonth()) return { ok: false, error: "月が終わってから確定できます" };
  try {
    const version = await db.$transaction(async (tx) => {
      const data = await buildReport(tx, month);
      if (data.fxPending) throw new Error(`為替がまだ仮の販売が ${data.fxPending}件 あります。先に「販売を記録」→「為替レート」で確定してください`);
      const tentative = data.lines.filter((l) => l.tentative).length;
      if (tentative) throw new Error(`送料が仮のままの販売が ${tentative}件 あります。本当の送料を入れてから確定してください`);
      const draft = await tx.monthlyReport.findUnique({ where: { month_version: { month, version: 0 } } });
      const paid = draft?.paid ?? "{}";
      const last = await tx.monthlyReport.aggregate({ where: { month }, _max: { version: true } });
      const version = (last._max.version ?? 0) + 1;
      const row = await tx.monthlyReport.create({ data: { month, version, data: JSON.stringify(data), paid, fixedAt: new Date() } });
      await logChange(tx, { table: "MonthlyReport", recordId: row.id, action: "create", after: { month, version }, note: `${month} の月次レポートを確定（第${version}版）` });
      return version;
    });
    revalidatePath("/report");
    return { ok: true, version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "確定できませんでした" };
  }
}
