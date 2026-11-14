"use server";
// 出品先を変える処理（docs/data-design.md「出品先と状態の変え方」）
// - 状態は手で選ばない。出品先が1つ以上 → 出品中、ひとつもない → 未出品
// - 売却済み・廃棄・備品の商品は変えない
// - 変えたことは、かならず変更の履歴に残す。「元に戻す」もできる
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logChange } from "@/lib/history";

type Tx = Prisma.TransactionClient;

/** 「元に戻す」に使う控え。どの出品先を作った・取り下げたか */
export type ListingUndo = { created: number[]; withdrawn: number[] };

export type ListingResult =
  | { ok: true; changed: number; toStock: number; undo: ListingUndo }
  | { ok: false; error: string };

const input = z.object({
  itemIds: z.array(z.number().int().positive()).min(1).max(500),
  channelId: z.number().int().positive(),
  on: z.boolean(),
});

/** 出品先のあるなしから、状態（未出品・出品中）を決め直す */
async function refreshStatus(tx: Tx, itemId: number, note: string) {
  const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
  if (item.status !== "stock" && item.status !== "list") return item.status;
  const active = await tx.listing.count({ where: { itemId, state: "active" } });
  const next = active > 0 ? "list" : "stock";
  if (next !== item.status) {
    await tx.item.update({ where: { id: itemId }, data: { status: next } });
    await logChange(tx, { table: "Item", recordId: itemId, action: "update", before: { status: item.status }, after: { status: next }, note });
  }
  return next;
}

/** 選んだ商品を、ある販路に「出品した」（on: true）または「取り下げる」（on: false） */
export async function changeListings(raw: { itemIds: number[]; channelId: number; on: boolean }): Promise<ListingResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "入力の形が正しくありません" };
  const { itemIds, channelId, on } = parsed.data;

  const channel = await db.channel.findFirst({ where: { id: channelId, deletedAt: null } });
  if (!channel) return { ok: false, error: "販路が見つかりません" };

  const note = on ? `出品先を付ける（${channel.name}）` : `出品先を取り下げる（${channel.name}）`;
  const undo: ListingUndo = { created: [], withdrawn: [] };
  let toStock = 0;

  await db.$transaction(async (tx) => {
    // 在庫の商品だけ（売却済みなどは変えない）
    const items = await tx.item.findMany({ where: { id: { in: itemIds }, deletedAt: null, status: { in: ["stock", "list"] } } });
    for (const item of items) {
      const current = await tx.listing.findFirst({ where: { itemId: item.id, channelId, state: "active" } });
      if (on && !current) {
        const l = await tx.listing.create({ data: { itemId: item.id, channelId } });
        await logChange(tx, { table: "Listing", recordId: l.id, action: "create", after: { itemId: item.id, channel: channel.name, state: "active" }, note });
        undo.created.push(l.id);
      } else if (!on && current) {
        await tx.listing.update({ where: { id: current.id }, data: { state: "withdrawn", endedAt: new Date() } });
        await logChange(tx, { table: "Listing", recordId: current.id, action: "update", before: { state: "active" }, after: { state: "withdrawn" }, note });
        undo.withdrawn.push(current.id);
      } else continue;
      const st = await refreshStatus(tx, item.id, note);
      if (!on && st === "stock") toStock++;
    }
  });

  revalidatePath("/items");
  return { ok: true, changed: undo.created.length + undo.withdrawn.length, toStock, undo };
}

/** 直前の「出品先を変える」を取り消す */
export async function undoListings(undo: ListingUndo): Promise<{ ok: boolean }> {
  const ids = z.object({ created: z.array(z.number().int()), withdrawn: z.array(z.number().int()) }).safeParse(undo);
  if (!ids.success) return { ok: false };
  const note = "出品先の変更を元に戻す";
  await db.$transaction(async (tx) => {
    const touched = new Set<number>();
    // 付けた出品先は取り下げに戻す（行は消さずに残す）
    for (const id of ids.data.created) {
      const l = await tx.listing.findUnique({ where: { id } });
      if (!l || l.state !== "active") continue;
      await tx.listing.update({ where: { id }, data: { state: "withdrawn", endedAt: new Date() } });
      await logChange(tx, { table: "Listing", recordId: id, action: "update", before: { state: "active" }, after: { state: "withdrawn" }, note });
      touched.add(l.itemId);
    }
    // 取り下げた出品先は、出品中に戻す
    for (const id of ids.data.withdrawn) {
      const l = await tx.listing.findUnique({ where: { id } });
      if (!l || l.state !== "withdrawn") continue;
      await tx.listing.update({ where: { id }, data: { state: "active", endedAt: null } });
      await logChange(tx, { table: "Listing", recordId: id, action: "restore", before: { state: "withdrawn" }, after: { state: "active" }, note });
      touched.add(l.itemId);
    }
    for (const itemId of touched) await refreshStatus(tx, itemId, note);
  });
  revalidatePath("/items");
  return { ok: true };
}
