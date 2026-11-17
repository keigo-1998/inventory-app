"use server";
// 伝票CSVの形式を覚える・忘れる
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";

const fmt = z.object({
  name: z.string().trim().min(1).max(100), signature: z.string().min(1).max(5000),
  nameCol: z.number().int().min(0), costCols: z.array(z.number().int().min(0)).min(1).max(20),
  qtyCol: z.number().int().min(0).nullable(), expCol: z.number().int().min(0).nullable(), dateCol: z.number().int().min(0).nullable(),
  supplier: z.string().trim().max(100).nullable(),
});

export async function saveSlipFormat(raw: z.input<typeof fmt>): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const p = fmt.safeParse(raw);
  if (!p.success) return { ok: false, error: "形式の名前・商品名の列・原価の列を選んでください" };
  const d = { ...p.data, costCols: JSON.stringify(p.data.costCols), supplier: p.data.supplier || null, deletedAt: null };
  const r = await db.$transaction(async (tx) => {
    const old = await tx.slipFormat.findUnique({ where: { signature: d.signature } });
    const row = old ? await tx.slipFormat.update({ where: { id: old.id }, data: d }) : await tx.slipFormat.create({ data: d });
    await logChange(tx, { table: "SlipFormat", recordId: row.id, action: old ? "update" : "create", before: old ?? undefined, after: d, note: "伝票の形式を覚える" });
    return row;
  });
  revalidatePath("/items/new");
  return { ok: true, id: r.id };
}

export async function forgetSlipFormat(id: number): Promise<{ ok: boolean }> {
  await db.$transaction(async (tx) => {
    await tx.slipFormat.update({ where: { id }, data: { deletedAt: new Date() } });
    await logChange(tx, { table: "SlipFormat", recordId: id, action: "delete", note: "伝票の形式を忘れる" });
  });
  revalidatePath("/items/new");
  return { ok: true };
}
