"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";

export type ActionState = { error?: string; message?: string };

class UserError extends Error {}

const optText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const int = (label: string, min = 0) =>
  z.coerce.number({ invalid_type_error: `${label}は数値で入力してください` }).int(`${label}は整数で入力してください`).min(min, `${label}は${min}以上で入力してください`);

function parse<T extends z.ZodTypeAny>(schema: T, fd: FormData): z.infer<T> {
  const r = schema.safeParse(Object.fromEntries(fd));
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "入力内容が正しくありません");
  return r.data;
}

async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { message: message ?? "保存しました" };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: "同じ値が既に登録されています（品番・カテゴリ名は重複できません）" };
    throw e;
  }
}

/* ---------- 品目 ---------- */

const itemSchema = z.object({
  code: z.string().trim().min(1, "品番を入力してください").max(50),
  name: z.string().trim().min(1, "品名を入力してください").max(200),
  categoryId: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null)),
  unit: z.string().trim().min(1, "単位を入力してください").max(10),
  minQuantity: int("発注点"),
  location: optText,
  note: optText,
});

export async function createItem(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await run(async () => {
    const data = parse(itemSchema.extend({ quantity: int("初期在庫数"), operator: optText }), fd);
    const { quantity, operator, ...rest } = data;
    const item = await db.item.create({ data: { ...rest, quantity } });
    if (quantity > 0) {
      await db.stockMovement.create({
        data: { itemId: item.id, type: "IN", quantity, after: quantity, operator, note: "初期登録" },
      });
    }
    id = item.id;
  });
  if (res.error) return res;
  redirect(`/items/${id}`);
}

export async function updateItem(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await db.item.update({ where: { id }, data: parse(itemSchema, fd) });
    return "品目情報を更新しました";
  });
}

export async function deleteItem(id: number): Promise<void> {
  const active = await db.loan.count({ where: { itemId: id, returnedAt: null } });
  if (active > 0) throw new Error("貸出中の品目は削除できません");
  await db.item.delete({ where: { id } });
  revalidatePath("/", "layout");
  redirect("/items");
}

/* ---------- 入出庫 ---------- */

const moveSchema = z.object({
  type: z.enum(["IN", "OUT", "ADJUST"]),
  quantity: int("数量"),
  operator: optText,
  note: optText,
});

export async function moveStock(itemId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { type, quantity, operator, note } = parse(moveSchema, fd);
    if (type !== "ADJUST" && quantity === 0) throw new UserError("数量は1以上で入力してください");
    await db.$transaction(async (tx) => {
      const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
      const delta = type === "IN" ? quantity : type === "OUT" ? -quantity : quantity - item.quantity;
      const after = item.quantity + delta;
      if (after < 0) throw new UserError(`在庫が不足しています（現在庫: ${item.quantity}${item.unit}）`);
      if (delta === 0) throw new UserError("在庫数に変化がありません");
      await tx.item.update({ where: { id: itemId }, data: { quantity: after } });
      await tx.stockMovement.create({ data: { itemId, type, quantity: delta, after, operator, note } });
    });
    return "在庫を更新しました";
  });
}

/* ---------- 貸出 ---------- */

const loanSchema = z.object({
  itemId: z.coerce.number().int().positive("品目を選択してください"),
  borrower: z.string().trim().min(1, "借用者を入力してください").max(100),
  quantity: int("数量", 1),
  dueDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00+09:00`) : null)),
  note: optText,
});

export async function createLoan(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { itemId, borrower, quantity, dueDate, note } = parse(loanSchema, fd);
    await db.$transaction(async (tx) => {
      const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
      const after = item.quantity - quantity;
      if (after < 0) throw new UserError(`在庫が不足しています（現在庫: ${item.quantity}${item.unit}）`);
      await tx.item.update({ where: { id: itemId }, data: { quantity: after } });
      await tx.loan.create({ data: { itemId, borrower, quantity, dueDate, note } });
      await tx.stockMovement.create({
        data: { itemId, type: "LOAN", quantity: -quantity, after, operator: borrower, note },
      });
    });
    return "貸出を登録しました";
  });
}

export async function returnLoan(loanId: number): Promise<void> {
  await db.$transaction(async (tx) => {
    const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId } });
    if (loan.returnedAt) return;
    const item = await tx.item.update({
      where: { id: loan.itemId },
      data: { quantity: { increment: loan.quantity } },
    });
    await tx.loan.update({ where: { id: loanId }, data: { returnedAt: new Date() } });
    await tx.stockMovement.create({
      data: { itemId: loan.itemId, type: "RETURN", quantity: loan.quantity, after: item.quantity, operator: loan.borrower },
    });
  });
  revalidatePath("/", "layout");
}

/* ---------- カテゴリ ---------- */

export async function createCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { name } = parse(z.object({ name: z.string().trim().min(1, "カテゴリ名を入力してください").max(50) }), fd);
    await db.category.create({ data: { name } });
    return "カテゴリを追加しました";
  });
}

export async function deleteCategory(id: number): Promise<void> {
  await db.category.delete({ where: { id } });
  revalidatePath("/", "layout");
}
