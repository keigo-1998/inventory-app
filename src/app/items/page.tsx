import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { StockBadge } from "@/components/StockBadge";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; category?: string; filter?: string }>;

export default async function ItemsPage({ searchParams }: { searchParams: SP }) {
  const { q = "", category = "", filter = "" } = await searchParams;
  const where: Prisma.ItemWhereInput = {
    ...(q && { OR: [{ name: { contains: q } }, { code: { contains: q } }, { location: { contains: q } }] }),
    ...(category && { categoryId: category === "none" ? null : Number(category) }),
  };
  const [categories, all, loanAgg] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.item.findMany({ where, include: { category: true }, orderBy: { code: "asc" } }),
    db.loan.groupBy({ by: ["itemId"], where: { returnedAt: null }, _sum: { quantity: true } }),
  ]);
  const loaned = new Map(loanAgg.map((l) => [l.itemId, l._sum.quantity ?? 0]));
  const items = filter === "low" ? all.filter((i) => i.quantity <= i.minQuantity) : all;

  return (
    <>
      <div className="page-head">
        <h1>品目一覧</h1>
        <div className="row">
          <a className="btn" href="/api/items/export">CSV出力</a>
          <Link className="btn btn-primary" href="/items/new">＋ 品目を登録</Link>
        </div>
      </div>

      <form className="filters card">
        <input name="q" defaultValue={q} placeholder="品名・品番・保管場所で検索" />
        <select name="category" defaultValue={category}>
          <option value="">すべてのカテゴリ</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="none">（未分類）</option>
        </select>
        <select name="filter" defaultValue={filter}>
          <option value="">すべての在庫状態</option>
          <option value="low">要発注・在庫切れのみ</option>
        </select>
        <button className="btn">絞り込み</button>
        {(q || category || filter) && <Link href="/items" className="btn btn-ghost">クリア</Link>}
      </form>

      <section className="card">
        <p className="muted small">{items.length} 件</p>
        <table className="table">
          <thead>
            <tr>
              <th>品番</th><th>品名</th><th>カテゴリ</th><th>保管場所</th>
              <th className="num">在庫</th><th className="num">貸出中</th><th className="num">発注点</th><th>状態</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.code}</td>
                <td><Link href={`/items/${i.id}`}>{i.name}</Link></td>
                <td>{i.category?.name ?? <span className="muted">未分類</span>}</td>
                <td>{i.location ?? "-"}</td>
                <td className="num strong">{i.quantity} {i.unit}</td>
                <td className="num">{loaned.get(i.id) ?? 0}</td>
                <td className="num">{i.minQuantity}</td>
                <td><StockBadge quantity={i.quantity} min={i.minQuantity} /></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="muted center">該当する品目がありません</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
