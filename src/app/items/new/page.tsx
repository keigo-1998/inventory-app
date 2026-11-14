// 商品を登録（データベースから、今ある管理番号とジャンルを読んで画面に渡す）
import { db } from "@/lib/db";
import { RegisterView } from "./RegisterView";

export const dynamic = "force-dynamic";

export default async function NewItemsPage() {
  const [items, genres] = await Promise.all([
    // 取り消した商品の番号も使えないので、消した印の付いた商品も含める
    db.item.findMany({ select: { code: true } }),
    db.genre.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
  ]);
  return <RegisterView codes={items.map((i) => i.code)} genres={genres.map((g) => g.name)} />;
}
