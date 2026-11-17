"use server";
// 登録した商品を、あとから取り消す・戻す・直す（docs/data-design.md「データを消さない・戻せるようにする」）
// - 取り消す: 消した印を付けるだけ（ゴミ箱と同じ）。出品中・売れた記録がある商品は取り消せない
//   山（-0）を取り消すと、枝番ごと山全体を取り消す。「割り振る」の枝番を取り消すと、その原価を残りの枝番で分け直す
// - 戻す: 消した印を外す。山の原価は分け直す
// - 直す: 商品名・ジャンル・仕入先・仕入日・原価・個数・予想売価。何から何に変えたかを履歴に残す
//   もう売れた分の粗利は変えない（販売の記録に、記録したときの原価を写してあるため）
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";
import { isFixed, reallocate } from "@/lib/lot";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export type RemoveUndo = { itemIds: number[]; lotIds: number[]; costs: { id: number; before: number }[] };

const refresh = (lotCode?: string | null) => {
  revalidatePath("/items");
  revalidatePath("/items/new");
  revalidatePath("/sales");
  if (lotCode) revalidatePath(`/lots/${lotCode}`);
};

/** 山の原価を分け直す（仕入額 − 売れた枝番の原価 を、まだ売れていない「割り振る」の枝番で。なければ -0 に全部） */
async function rebalance(tx: Tx, lotId: number, note: string, costs: RemoveUndo["costs"]) {
  const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
  const live = await tx.item.findMany({ where: { lotId, deletedAt: null } });
  const head = live.find((i) => i.code === `${lot.code}-0`);
  const branches = live.filter((i) => i !== head);
  const pool = Math.max(0, lot.totalCost - branches.filter((b) => isFixed(b.status)).reduce((a, b) => a + b.unitCost * b.quantity, 0));
  const targets = branches.filter((b) => !isFixed(b.status) && b.lotCostMode === "alloc");
  const set = async (id: number, before: number, cost: number) => {
    if (before === cost) return;
    await tx.item.update({ where: { id }, data: { unitCost: cost } });
    costs.push({ id, before });
    await logChange(tx, { table: "Item", recordId: id, action: "update", before: { unitCost: before }, after: { unitCost: cost }, note: `${note}（山の原価を分け直し）` });
  };
  if (targets.length && targets.some((t) => (t.expectedPrice ?? 0) > 0)) {
    const map = reallocate(pool, targets.map((t) => ({ key: String(t.id), exp: t.expectedPrice ?? 0 })));
    for (const t of targets) await set(t.id, t.unitCost, map[String(t.id)]);
    if (head && !isFixed(head.status)) await set(head.id, head.unitCost, 0);
  } else if (head && !isFixed(head.status)) {
    await set(head.id, head.unitCost, pool); // 割り振る枝番がなくなったら、山の残りに全部戻す
  }
}

/** 取り消してよいか（出品中・売れた記録がない） */
async function checkRemovable(tx: Tx, ids: number[]) {
  const items = await tx.item.findMany({
    where: { id: { in: ids } },
    include: { listings: { where: { state: "active" } }, saleLines: { where: { sale: { cancelledAt: null } } } },
  });
  for (const it of items) {
    if (it.saleLines.length) throw new Error(`${it.code} は売れた記録があるので取り消せません（先に販売の記録を取り消してください）`);
    if (it.listings.length) throw new Error(`${it.code} は出品中です。先に出品先を外してから取り消してください`);
  }
}

/** 商品を取り消す */
export async function removeItem(itemId: number): Promise<{ ok: true; codes: string[]; undo: RemoveUndo } | { ok: false; error: string }> {
  if (!Number.isInteger(itemId)) return { ok: false, error: "入力の形が正しくありません" };
  try {
    let lotCode: string | null = null;
    const r = await db.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, deletedAt: null }, include: { lot: true } });
      if (!item) throw new Error("商品が見つかりません（もう取り消したかもしれません）");
      lotCode = item.lot?.code ?? null;
      const now = new Date();
      const undo: RemoveUndo = { itemIds: [], lotIds: [], costs: [] };
      const isHead = !!item.lot && item.code === `${item.lot.code}-0`;
      const note = isHead ? `山${item.lot!.code}を取り消す` : `${item.code} を取り消す`;
      const targets = isHead ? await tx.item.findMany({ where: { lotId: item.lotId, deletedAt: null } }) : [item];
      await checkRemovable(tx, targets.map((t) => t.id));
      for (const t of targets) {
        await tx.item.update({ where: { id: t.id }, data: { deletedAt: now } });
        await logChange(tx, { table: "Item", recordId: t.id, action: "delete", before: { code: t.code, name: t.name }, note });
        undo.itemIds.push(t.id);
      }
      if (isHead) {
        await tx.lot.update({ where: { id: item.lotId! }, data: { deletedAt: now } });
        await logChange(tx, { table: "Lot", recordId: item.lotId!, action: "delete", note });
        undo.lotIds.push(item.lotId!);
      } else if (item.lotId && item.lotCostMode === "alloc") {
        await rebalance(tx, item.lotId, note, undo.costs);
      }
      return { codes: targets.map((t) => t.code), undo };
    });
    refresh(lotCode);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "取り消せませんでした" };
  }
}

/** 取り消した直後の「元に戻す」（原価も取り消す前の金額に戻す） */
export async function undoRemove(undo: RemoveUndo): Promise<{ ok: boolean; error?: string }> {
  const p = z.object({ itemIds: z.array(z.number().int()), lotIds: z.array(z.number().int()), costs: z.array(z.object({ id: z.number().int(), before: z.number().int() })) }).safeParse(undo);
  if (!p.success) return { ok: false, error: "入力の形が正しくありません" };
  const note = "商品の取り消しを元に戻す";
  await db.$transaction(async (tx) => {
    for (const id of p.data.lotIds) { await tx.lot.update({ where: { id }, data: { deletedAt: null } }); await logChange(tx, { table: "Lot", recordId: id, action: "restore", note }); }
    for (const id of p.data.itemIds) { await tx.item.update({ where: { id }, data: { deletedAt: null } }); await logChange(tx, { table: "Item", recordId: id, action: "restore", note }); }
    for (const c of p.data.costs) { await tx.item.update({ where: { id: c.id }, data: { unitCost: c.before } }); await logChange(tx, { table: "Item", recordId: c.id, action: "update", after: { unitCost: c.before }, note }); }
  });
  refresh();
  return { ok: true };
}

/** 消した商品の一覧から戻す（山の -0 なら、一緒に消した枝番と山も戻す） */
export async function restoreItem(itemId: number): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  try {
    let lotCode: string | null = null;
    const codes = await db.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, deletedAt: { not: null } }, include: { lot: true } });
      if (!item) throw new Error("消した商品が見つかりません");
      lotCode = item.lot?.code ?? null;
      const note = `${item.code} を戻す`;
      const isHead = !!item.lot && item.code === `${item.lot.code}-0`;
      if (!isHead && item.lot?.deletedAt) throw new Error(`山${item.lot.code}が取り消されています。先に山（${item.lot.code}-0）を戻してください`);
      // 山ごと消したときは、同じときに消した枝番も戻す
      const targets = isHead && item.lot!.deletedAt
        ? await tx.item.findMany({ where: { lotId: item.lotId, deletedAt: item.deletedAt } })
        : [item];
      if (isHead && item.lot!.deletedAt) {
        await tx.lot.update({ where: { id: item.lotId! }, data: { deletedAt: null } });
        await logChange(tx, { table: "Lot", recordId: item.lotId!, action: "restore", note });
      }
      for (const t of targets) {
        await tx.item.update({ where: { id: t.id }, data: { deletedAt: null } });
        await logChange(tx, { table: "Item", recordId: t.id, action: "restore", note });
      }
      if (item.lotId && !isHead && item.lotCostMode === "alloc") await rebalance(tx, item.lotId, note, []);
      return targets.map((t) => t.code);
    });
    refresh(lotCode);
    return { ok: true, codes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "戻せませんでした" };
  }
}

// ---- 直す ----
const patch = z.object({
  name: z.string().trim().min(1, "商品名を入れてください").max(300),
  genre: z.string().trim().max(50),
  supplier: z.string().trim().max(100),
  date: z.string(),
  unitCost: z.number().int().min(0).nullable(), // 山の商品は直さない（null）
  quantity: z.number().int().min(1).nullable(), // 山の商品は直さない（null）
  expectedPrice: z.number().int().min(0).nullable(),
});
export type ItemPatch = z.input<typeof patch>;

function parseDate(s: string): Date | null {
  const m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(s.normalize("NFKC").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d) - 9 * 3600 * 1000);
  const back = new Date(dt.getTime() + 9 * 3600 * 1000);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? dt : null;
}
const fmt = (d: Date) => { const j = new Date(d.getTime() + 9 * 3600 * 1000); return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, "0")}/${String(j.getUTCDate()).padStart(2, "0")}`; };

/** 商品を直す。戻すための「前の中身」を返す */
export async function updateItem(itemId: number, raw: ItemPatch): Promise<{ ok: true; before: ItemPatch; changed: string[] } | { ok: false; error: string }> {
  const p = patch.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message.startsWith("商品名") ? p.error.issues[0].message : "入力の形が正しくありません（金額・個数は0以上の整数）" };
  const v = p.data;
  const date = parseDate(v.date);
  if (!date) return { ok: false, error: "仕入日を 2026/11/15 の形で入れてください" };
  try {
    let lotCode: string | null = null;
    const r = await db.$transaction(async (tx) => {
      const it = await tx.item.findFirst({ where: { id: itemId, deletedAt: null }, include: { genre: true, supplier: true, lot: true, saleLines: { where: { sale: { cancelledAt: null } } } } });
      if (!it) throw new Error("商品が見つかりません");
      lotCode = it.lot?.code ?? null;
      const before: ItemPatch = {
        name: it.name, genre: it.genre?.name ?? "", supplier: it.supplier?.name ?? "", date: fmt(it.purchasedAt),
        unitCost: it.lotId ? null : it.unitCost, quantity: it.lotId ? null : it.quantity, expectedPrice: it.expectedPrice,
      };
      const sold = it.saleLines.reduce((a, l) => a + l.quantity, 0);
      if (v.quantity != null && v.quantity < sold) throw new Error(`もう${sold}個売れているので、個数は${sold}以上にしてください`);
      const findOrMake = async (kind: "genre" | "supplier", name: string) => {
        if (!name) return null;
        const found = kind === "genre" ? await tx.genre.findFirst({ where: { name } }) : await tx.supplier.findFirst({ where: { name } });
        if (found) return found.id;
        const made = kind === "genre" ? await tx.genre.create({ data: { name } }) : await tx.supplier.create({ data: { name } });
        await logChange(tx, { table: kind === "genre" ? "Genre" : "Supplier", recordId: made.id, action: "create", after: { name }, note: "商品を直す（一覧に追加）" });
        return made.id;
      };
      const data = {
        name: v.name, genreId: await findOrMake("genre", v.genre), supplierId: await findOrMake("supplier", v.supplier), purchasedAt: date,
        expectedPrice: v.expectedPrice,
        ...(it.lotId ? {} : { unitCost: v.unitCost ?? it.unitCost, quantity: v.quantity ?? it.quantity }),
      };
      const changed = (Object.keys(before) as (keyof ItemPatch)[]).filter((k) => !it.lotId || (k !== "unitCost" && k !== "quantity")).filter((k) => String(before[k] ?? "") !== String(v[k] ?? ""));
      if (!changed.length) return { before, changed };
      await tx.item.update({ where: { id: it.id }, data });
      await logChange(tx, {
        table: "Item", recordId: it.id, action: "update",
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, v[k]])), note: `${it.code} を直す`,
      });
      return { before, changed };
    });
    refresh(lotCode);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "直せませんでした" };
  }
}
