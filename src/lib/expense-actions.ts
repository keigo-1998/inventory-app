"use server";
// 経費の記録（入場料など）。消すときは消した印を付けるだけ（元に戻せる）
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";


function parseDate(s: string): Date | null {
  const m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(s.normalize("NFKC").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d) - 9 * 3600 * 1000);
  const back = new Date(dt.getTime() + 9 * 3600 * 1000);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? dt : null;
}

const input = z.object({
  date: z.string(), category: z.string().trim().min(1).max(30), amount: z.number().int().min(1).max(100000000),
  supplier: z.string().trim().max(100).optional(), note: z.string().trim().max(500).optional(),
});

export async function recordExpense(raw: z.input<typeof input>): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, error: "種類と金額（1円以上の整数）を入れてください" };
  const date = parseDate(p.data.date);
  if (!date) return { ok: false, error: "日付を 2026/11/15 の形で入れてください" };
  const e = await db.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { date, category: p.data.category, amountJpy: p.data.amount, supplier: p.data.supplier || null, note: p.data.note || null } });
    await logChange(tx, { table: "Expense", recordId: e.id, action: "create", after: p.data, note: "経費を記録" });
    return e;
  });
  revalidatePath("/expenses");
  return { ok: true, id: e.id };
}

/** 消す（印を付けるだけ）／戻す */
export async function removeExpense(id: number, remove = true): Promise<{ ok: boolean }> {
  await db.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { deletedAt: remove ? new Date() : null } });
    await logChange(tx, { table: "Expense", recordId: id, action: remove ? "delete" : "restore", note: remove ? "経費を消す" : "経費を戻す" });
  });
  revalidatePath("/expenses");
  return { ok: true };
}
