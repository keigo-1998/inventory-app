"use server";
// 商品を登録する処理（docs/data-design.md「商品を登録」「伝票の取り込み」「スマホでの登録」）
// - 単品はそのまま1件。山は「山」と「-0（山の残り）」を作り、中身があれば枝番も作る
// - 山の中身があるときは、仕入額を枝番に予想売価の比率で全部割り振り、-0 は原価0円
// - ジャンル・仕入先が一覧になければ、一覧に足す
// - 作ったものは、かならず変更の履歴に残す。「元に戻す」は消した印を付けるだけ
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { allocateCost } from "@/lib/lot";

type Tx = Prisma.TransactionClient;

const kid = z.object({ name: z.string().trim().min(1), exp: z.number().int().min(0) });
const row = z.object({
  kind: z.enum(["単品", "山"]),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1, "商品名がありません").max(300),
  genre: z.string().trim().max(50).default(""),
  supplier: z.string().trim().max(100).default(""),
  date: z.string().trim(),
  cost: z.number().int().min(0),
  qty: z.number().int().min(1).default(1),
  exp: z.number().int().min(0).nullable().default(null),
  kids: z.array(kid).default([]),
});
export type RegisterRow = z.input<typeof row>;
export type RegisterResult = { ok: true; codes: string[]; undo: { itemIds: number[]; lotIds: number[] } } | { ok: false; errors: string[] };

/** "2026/11/04" や "2026-11-4" を日本時間の日付にする */
function parseDate(s: string): Date | null {
  const m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(s.normalize("NFKC").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d) - 9 * 3600 * 1000); // 日本時間のその日の0時
  // 2026/02/31 のようなない日付は受け付けない
  const back = new Date(dt.getTime() + 9 * 3600 * 1000);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? dt : null;
}

async function genreId(tx: Tx, name: string, cache: Map<string, number>) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name)!;
  const found = await tx.genre.findUnique({ where: { name } });
  const g = found ?? (await tx.genre.create({ data: { name, sortOrder: 999 } }));
  if (!found) await logChange(tx, { table: "Genre", recordId: g.id, action: "create", after: { name }, note: "商品を登録（一覧にないジャンルを追加）" });
  cache.set(name, g.id);
  return g.id;
}
async function supplierId(tx: Tx, name: string, cache: Map<string, number>) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name)!;
  const found = await tx.supplier.findUnique({ where: { name } });
  const s = found ?? (await tx.supplier.create({ data: { name } }));
  if (!found) await logChange(tx, { table: "Supplier", recordId: s.id, action: "create", after: { name }, note: "商品を登録（一覧にない仕入先を追加）" });
  cache.set(name, s.id);
  return s.id;
}

export async function registerItems(raw: RegisterRow[]): Promise<RegisterResult> {
  const parsed = z.array(row).min(1).max(2000).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${typeof i.path[0] === "number" ? i.path[0] + 1 + "件目" : ""}：${i.message}`) };
  }
  const rows = parsed.data;
  const errors: string[] = [];

  // 管理番号の重複（今回の中・登録済み。取り消した商品の番号も使えない）
  const codes = rows.flatMap((r) => (r.kind === "山" ? [r.code, ...r.kids.map((_, i) => r.code.replace(/-0$/, "") + "-" + (i + 1))] : [r.code]));
  const dupInside = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupInside.length) errors.push(`管理番号が重複しています：${[...new Set(dupInside)].join("、")}`);
  const taken = await db.item.findMany({ where: { code: { in: codes } }, select: { code: true } });
  if (taken.length) errors.push(`すでに登録されている管理番号です：${taken.map((t) => t.code).join("、")}`);
  rows.forEach((r, i) => {
    if (r.kind === "山" && !/^\d+-0$/.test(r.code)) errors.push(`${i + 1}件目：山の管理番号は「0353-0」のように -0 で終わる形にしてください`);
    if (r.kind === "単品" && /-0$/.test(r.code)) errors.push(`${i + 1}件目：-0 で終わる番号は山に使います`);
    if (!parseDate(r.date)) errors.push(`${i + 1}件目：仕入日「${r.date}」を 2026/11/04 の形で入れてください`);
  });
  if (errors.length) return { ok: false, errors };

  const itemIds: number[] = [];
  const lotIds: number[] = [];
  const done: string[] = [];
  const note = "商品を登録";
  await db.$transaction(async (tx) => {
    const gc = new Map<string, number>(), sc = new Map<string, number>();
    for (const r of rows) {
      const purchasedAt = parseDate(r.date)!;
      const gid = await genreId(tx, r.genre, gc);
      const sid = await supplierId(tx, r.supplier, sc);
      if (r.kind === "単品") {
        const it = await tx.item.create({
          data: { code: r.code, name: r.name, genreId: gid, supplierId: sid, purchasedAt, unitCost: r.cost, quantity: r.qty, expectedPrice: r.exp },
        });
        await logChange(tx, { table: "Item", recordId: it.id, action: "create", after: { code: it.code, name: it.name, unitCost: it.unitCost, quantity: it.quantity }, note });
        itemIds.push(it.id);
        done.push(it.code);
        continue;
      }
      // 山：仕入額は山に持つ。中身（予想売価があるもの）があれば、全部を枝番に割り振り、-0 は0円
      const base = r.code.replace(/-0$/, "");
      const kids = r.kids;
      const hasAlloc = kids.some((k) => k.exp > 0);
      const al = allocateCost(r.cost, kids.map((k) => k.exp));
      const lot = await tx.lot.create({ data: { code: base, name: r.name, totalCost: r.cost, purchasedAt, supplierId: sid, genreId: gid } });
      await logChange(tx, { table: "Lot", recordId: lot.id, action: "create", after: { code: base, name: r.name, totalCost: r.cost }, note });
      lotIds.push(lot.id);
      const head = await tx.item.create({
        data: { code: r.code, name: r.name, genreId: gid, supplierId: sid, purchasedAt, unitCost: hasAlloc ? 0 : r.cost, expectedPrice: r.exp, lotId: lot.id },
      });
      await logChange(tx, { table: "Item", recordId: head.id, action: "create", after: { code: head.code, name: head.name, unitCost: head.unitCost }, note });
      itemIds.push(head.id);
      done.push(head.code);
      for (const [i, k] of kids.entries()) {
        const it = await tx.item.create({
          data: {
            code: `${base}-${i + 1}`, name: k.name, genreId: gid, supplierId: sid, purchasedAt,
            unitCost: hasAlloc ? al[i] : 0, expectedPrice: k.exp || null, lotId: lot.id, lotCostMode: hasAlloc ? "alloc" : "zero",
          },
        });
        await logChange(tx, { table: "Item", recordId: it.id, action: "create", after: { code: it.code, name: it.name, unitCost: it.unitCost }, note });
        itemIds.push(it.id);
        done.push(it.code);
      }
    }
  });

  revalidatePath("/items");
  revalidatePath("/items/new");
  return { ok: true, codes: done, undo: { itemIds, lotIds } };
}

/** 直前の登録を取り消す（消した印を付けるだけ。行は残す） */
export async function undoRegister(undo: { itemIds: number[]; lotIds: number[] }): Promise<{ ok: boolean; error?: string }> {
  const p = z.object({ itemIds: z.array(z.number().int()), lotIds: z.array(z.number().int()) }).safeParse(undo);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  // すでに売れた・出品した商品があれば取り消さない
  const used = await db.item.findMany({
    where: { id: { in: p.data.itemIds }, OR: [{ saleLines: { some: {} } }, { listings: { some: {} } }] },
    select: { code: true },
  });
  if (used.length) return { ok: false, error: `${used.map((u) => u.code).join("、")} は出品や販売の記録があるので、取り消せません` };
  const now = new Date();
  const note = "商品の登録を元に戻す";
  await db.$transaction(async (tx) => {
    for (const id of p.data.itemIds) {
      await tx.item.update({ where: { id }, data: { deletedAt: now } });
      await logChange(tx, { table: "Item", recordId: id, action: "delete", note });
    }
    for (const id of p.data.lotIds) {
      await tx.lot.update({ where: { id }, data: { deletedAt: now } });
      await logChange(tx, { table: "Lot", recordId: id, action: "delete", note });
    }
  });
  revalidatePath("/items");
  revalidatePath("/items/new");
  return { ok: true };
}
