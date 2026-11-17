// 商品を登録（データベースから、今ある管理番号とジャンルを読んで画面に渡す）
import { db } from "@/lib/db";
import { RegisterView } from "./RegisterView";
import type { SlipFormat } from "@/lib/slip";

export const dynamic = "force-dynamic";

export default async function NewItemsPage() {
  const [items, genres, formats] = await Promise.all([
    // 取り消した商品の番号も使えないので、消した印の付いた商品も含める
    db.item.findMany({ select: { code: true } }),
    db.genre.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.slipFormat.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" } }),
  ]);
  const fm: SlipFormat[] = formats.map((f) => ({
    id: f.id, name: f.name, signature: f.signature, nameCol: f.nameCol, costCols: JSON.parse(f.costCols) as number[],
    qtyCol: f.qtyCol, expCol: f.expCol, dateCol: f.dateCol, supplier: f.supplier,
  }));
  return <RegisterView codes={items.map((i) => i.code)} genres={genres.map((g) => g.name)} formats={fm} />;
}
