"use server";
// 販路の設定（docs/profit-formulas.md）。変えると「1件ずつ」「まとめて入力」の計算もすぐ変わる
// - すでに記録した販売の金額は変えない（記録したときの円の金額を持っているため）
// - 変更は ChangeLog に残し、「元に戻す」で前の値に戻せる
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { logChange } from "@/lib/history";

const FIELDS = {
  currency: z.enum(["JPY", "EUR", "USD"]),
  feeMode: z.enum(["auto", "manual", "none"]),
  feeRate: z.number().min(0).max(1).nullable(),
  feeHintRate: z.number().min(0).max(1).nullable(),
  usesShippingFee: z.boolean(),
  shippingPaidBy: z.enum(["payout", "bank"]),
  refundVia: z.enum(["payout", "bank"]),
  undecided: z.boolean(),
  returnShippingBack: z.boolean(),
} as const;
export type ChannelField = keyof typeof FIELDS;
export type ChannelValue = string | number | boolean | null;

const plain = (v: unknown) => (v != null && typeof v === "object" ? Number(v) : v) as ChannelValue; // Decimal → 数

/** 販路の設定を1つ変える。戻すための前の値を返す */
export async function updateChannel(id: number, field: ChannelField, value: ChannelValue): Promise<{ ok: true; before: ChannelValue } | { ok: false; error: string }> {
  const schema = FIELDS[field];
  if (!schema || !Number.isInteger(id)) return { ok: false, error: "入力の形が正しくありません" };
  const p = schema.safeParse(value);
  if (!p.success) return { ok: false, error: field.includes("Rate") ? "率は 0〜100% の数字で入れてください" : "入力の形が正しくありません" };
  const ch = await db.channel.findFirst({ where: { id, deletedAt: null } });
  if (!ch) return { ok: false, error: "販路が見つかりません" };
  const before = plain(ch[field]);
  const data: Record<string, unknown> = { [field]: p.data };
  // 自動にしたのに率が空なら、10% を入れておく
  if (field === "feeMode" && p.data === "auto" && ch.feeRate == null) data.feeRate = 0.1;
  await db.$transaction(async (tx) => {
    await tx.channel.update({ where: { id }, data });
    await logChange(tx, { table: "Channel", recordId: id, action: "update", before: { [field]: before }, after: data, note: `販路の設定（${ch.name}）` });
  });
  revalidatePath("/sales");
  revalidatePath("/items");
  return { ok: true, before };
}

/** 販路を追加する（最初は「毎回入力・円・計算のルールは未定」） */
export async function addChannel(name: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const n = name.normalize("NFKC").trim();
  if (!n) return { ok: false, error: "販路の名前を入れてください" };
  if (["廃棄", "備品にした"].includes(n)) return { ok: false, error: `「${n}」は販路の名前に使えません` };
  const dup = await db.channel.findFirst({ where: { name: n } });
  if (dup && !dup.deletedAt) return { ok: false, error: `「${n}」はもうあります` };
  const last = await db.channel.aggregate({ _max: { sortOrder: true } });
  const ch = await db.$transaction(async (tx) => {
    const c = dup
      ? await tx.channel.update({ where: { id: dup.id }, data: { deletedAt: null } }) // 前に消したものを戻す
      : await tx.channel.create({ data: { name: n, sortOrder: (last._max.sortOrder ?? 0) + 1, undecided: true } });
    await logChange(tx, { table: "Channel", recordId: c.id, action: dup ? "restore" : "create", after: { name: n }, note: "販路を追加" });
    return c;
  });
  revalidatePath("/sales");
  revalidatePath("/items");
  return { ok: true, id: ch.id };
}

/** 販路を一覧から外す（消した印を付けるだけ。記録した販売はそのまま残る） */
export async function hideChannel(id: number, hide: boolean): Promise<{ ok: boolean; error?: string }> {
  const ch = await db.channel.findUnique({ where: { id } });
  if (!ch) return { ok: false, error: "販路が見つかりません" };
  if (hide && (await db.listing.count({ where: { channelId: id, state: "active" } })) > 0)
    return { ok: false, error: `${ch.name} に出品中の商品があるので外せません。先に出品先を外してください` };
  await db.$transaction(async (tx) => {
    await tx.channel.update({ where: { id }, data: { deletedAt: hide ? new Date() : null } });
    await logChange(tx, { table: "Channel", recordId: id, action: hide ? "delete" : "restore", note: hide ? "販路を外す" : "販路を戻す" });
  });
  revalidatePath("/sales");
  revalidatePath("/items");
  return { ok: true };
}
