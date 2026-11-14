"use server";
// 山の画面で枝番を足す処理（docs/data-design.md「山の原価の割り振り」「山の画面と枝番の追加」）
// - 割り振る：「仕入額 − 売れた枝番の原価」を、まだ売れていない「割り振る」の枝番と新しい枝番で、予想売価の比率で分け直す。-0 は0円にする
// - 0円で出す：原価0円で足す。ほかの枝番の原価は変えない。あとで割り振り直しがあっても0円のまま
// - 売れた商品の原価は変えない
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { isFixed, reallocate } from "@/lib/lot";

const input = z.object({
  lotCode: z.string().regex(/^\d+$/),
  rows: z.array(z.object({ name: z.string().trim().min(1).max(300), exp: z.number().int().min(0), mode: z.enum(["alloc", "zero"]) })).min(1).max(200),
});
export type BranchUndo = { created: number[]; costs: { id: number; before: number }[] };
export type BranchResult = { ok: true; codes: string[]; alloc: number; zero: number; undo: BranchUndo } | { ok: false; error: string };

export async function addBranches(raw: z.input<typeof input>): Promise<BranchResult> {
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません（商品名を入れてください）" };
  const { lotCode, rows } = p.data;
  const note = `山${lotCode}に枝番を追加`;

  try {
    return await db.$transaction(async (tx) => {
      const lot = await tx.lot.findFirst({ where: { code: lotCode, deletedAt: null } });
      if (!lot) throw new Error("山が見つかりません");
      // 取り消した枝番の番号も使わないので、消した印の付いたものも含めて続きの番号を探す
      const all = await tx.item.findMany({ where: { lotId: lot.id } });
      const live = all.filter((i) => !i.deletedAt);
      const head = live.find((i) => i.code === `${lotCode}-0`);
      const branchNo = (code: string) => Number(code.split("-")[1] ?? 0);
      let next = Math.max(0, ...all.map((i) => branchNo(i.code))) + 1;

      const branches = live.filter((i) => i.code !== `${lotCode}-0`);
      const allocNew = rows.filter((r) => r.mode === "alloc");
      const costs: BranchUndo["costs"] = [];
      const created: number[] = [];
      const codes: string[] = [];

      // 新しい枝番を作る（原価はいったん0。割り振るものは下で決める）
      const newItems = [];
      for (const r of rows) {
        const it = await tx.item.create({
          data: {
            code: `${lotCode}-${next++}`, name: r.name, genreId: lot.genreId, supplierId: lot.supplierId, purchasedAt: lot.purchasedAt,
            unitCost: 0, expectedPrice: r.exp || null, lotId: lot.id, lotCostMode: r.mode,
          },
        });
        newItems.push({ it, r });
        created.push(it.id);
        codes.push(it.code);
      }

      if (allocNew.length) {
        const sold = branches.filter((b) => isFixed(b.status));
        const pool = lot.totalCost - sold.reduce((a, b) => a + b.unitCost * b.quantity, 0);
        const targets = [
          ...branches.filter((b) => !isFixed(b.status) && b.lotCostMode !== "zero").map((b) => ({ key: String(b.id), exp: b.expectedPrice ?? 0 })),
          ...newItems.filter((n) => n.r.mode === "alloc").map((n) => ({ key: String(n.it.id), exp: n.r.exp })),
        ];
        const map = reallocate(Math.max(0, pool), targets);
        for (const [key, cost] of Object.entries(map)) {
          const id = Number(key);
          const old = branches.find((b) => b.id === id);
          if (old && old.unitCost === cost) continue;
          await tx.item.update({ where: { id }, data: { unitCost: cost } });
          if (old) {
            costs.push({ id, before: old.unitCost });
            await logChange(tx, { table: "Item", recordId: id, action: "update", before: { unitCost: old.unitCost }, after: { unitCost: cost }, note: `${note}（割り振り直し）` });
          } else newItems.find((n) => n.it.id === id)!.it.unitCost = cost;
        }
        // 山の残り（-0）は原価0円にする
        if (head && head.unitCost !== 0 && !isFixed(head.status)) {
          await tx.item.update({ where: { id: head.id }, data: { unitCost: 0 } });
          costs.push({ id: head.id, before: head.unitCost });
          await logChange(tx, { table: "Item", recordId: head.id, action: "update", before: { unitCost: head.unitCost }, after: { unitCost: 0 }, note: `${note}（山の残りは0円）` });
        }
      }
      for (const { it } of newItems) {
        await logChange(tx, { table: "Item", recordId: it.id, action: "create", after: { code: it.code, name: it.name, unitCost: it.unitCost, lotCostMode: it.lotCostMode }, note });
      }
      return { ok: true as const, codes, alloc: allocNew.length, zero: rows.length - allocNew.length, undo: { created, costs } };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "登録できませんでした" };
  } finally {
    revalidatePath("/items");
    revalidatePath(`/lots/${lotCode}`);
  }
}

/** 直前の枝番の追加を取り消す（足した枝番に消した印を付け、原価を元に戻す） */
export async function undoBranches(lotCode: string, undo: BranchUndo): Promise<{ ok: boolean; error?: string }> {
  const p = z.object({ created: z.array(z.number().int()), costs: z.array(z.object({ id: z.number().int(), before: z.number().int() })) }).safeParse(undo);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  const used = await db.item.findMany({
    where: { id: { in: p.data.created }, OR: [{ saleLines: { some: {} } }, { listings: { some: {} } }] },
    select: { code: true },
  });
  if (used.length) return { ok: false, error: `${used.map((u) => u.code).join("、")} は出品や販売の記録があるので、取り消せません` };
  const note = `山${lotCode}の枝番の追加を元に戻す`;
  await db.$transaction(async (tx) => {
    const now = new Date();
    for (const id of p.data.created) {
      await tx.item.update({ where: { id }, data: { deletedAt: now } });
      await logChange(tx, { table: "Item", recordId: id, action: "delete", note });
    }
    for (const c of p.data.costs) {
      const it = await tx.item.findUnique({ where: { id: c.id } });
      if (!it || isFixed(it.status)) continue; // 取り消すまでの間に売れた商品の原価は変えない
      await tx.item.update({ where: { id: c.id }, data: { unitCost: c.before } });
      await logChange(tx, { table: "Item", recordId: c.id, action: "update", before: { unitCost: it.unitCost }, after: { unitCost: c.before }, note });
    }
  });
  revalidatePath("/items");
  revalidatePath(`/lots/${lotCode}`);
  return { ok: true };
}
