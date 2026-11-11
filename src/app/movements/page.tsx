import Link from "next/link";
import { db } from "@/lib/db";
import { MOVEMENT_LABELS } from "@/lib/format";
import { MovementTable } from "@/components/MovementTable";

export const dynamic = "force-dynamic";
const PER_PAGE = 50;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const { type = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const where = type ? { type } : {};
  const [rows, total] = await Promise.all([
    db.stockMovement.findMany({ where, include: { item: true }, orderBy: { createdAt: "desc" }, skip: (p - 1) * PER_PAGE, take: PER_PAGE }),
    db.stockMovement.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (n: number) => `/movements?${new URLSearchParams({ ...(type && { type }), page: String(n) })}`;

  return (
    <>
      <h1>入出庫履歴</h1>
      <form className="filters card">
        <select name="type" defaultValue={type}>
          <option value="">すべての区分</option>
          {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="btn">絞り込み</button>
      </form>
      <section className="card">
        <p className="muted small">{total} 件</p>
        <MovementTable rows={rows} />
        {pages > 1 && (
          <div className="row mt">
            {p > 1 && <Link className="btn btn-sm" href={href(p - 1)}>← 前へ</Link>}
            <span className="muted small">{p} / {pages}</span>
            {p < pages && <Link className="btn btn-sm" href={href(p + 1)}>次へ →</Link>}
          </div>
        )}
      </section>
    </>
  );
}
