import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDate, isOverdue } from "@/lib/format";
import { MovementTable } from "@/components/MovementTable";
import { StockBadge } from "@/components/StockBadge";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [items, activeLoans, recent] = await Promise.all([
    db.item.findMany({ include: { category: true }, orderBy: { code: "asc" } }),
    db.loan.findMany({ where: { returnedAt: null }, include: { item: true }, orderBy: { dueDate: "asc" } }),
    db.stockMovement.findMany({ include: { item: true }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const low = items.filter((i) => i.quantity <= i.minQuantity);
  const overdue = activeLoans.filter((l) => isOverdue(l.dueDate, l.returnedAt));

  return (
    <>
      <h1>ダッシュボード</h1>
      <div className="stats">
        <Stat label="登録品目" value={items.length} href="/items" />
        <Stat label="要発注・在庫切れ" value={low.length} tone={low.length ? "warn" : undefined} href="/items?filter=low" />
        <Stat label="貸出中" value={activeLoans.length} href="/loans" />
        <Stat label="返却期限超過" value={overdue.length} tone={overdue.length ? "danger" : undefined} href="/loans" />
      </div>

      <div className="grid-2 gap-lg">
        <section className="card">
          <h2>要発注の品目</h2>
          {low.length === 0 ? (
            <p className="muted">発注点を下回っている品目はありません。</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>品目</th><th className="num">在庫/発注点</th><th>状態</th></tr>
              </thead>
              <tbody>
                {low.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/items/${i.id}`}>{i.name}</Link><div className="muted small">{i.code}</div></td>
                    <td className="num">{i.quantity} / {i.minQuantity} {i.unit}</td>
                    <td><StockBadge quantity={i.quantity} min={i.minQuantity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2>貸出中</h2>
          {activeLoans.length === 0 ? (
            <p className="muted">貸出中の備品はありません。</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>品目</th><th>借用者</th><th>返却期限</th></tr>
              </thead>
              <tbody>
                {activeLoans.slice(0, 8).map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/items/${l.itemId}`}>{l.item.name}</Link> × {l.quantity}</td>
                    <td>{l.borrower}</td>
                    <td className={isOverdue(l.dueDate, l.returnedAt) ? "text-danger" : ""}>{fmtDate(l.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>最近の入出庫</h2>
        <MovementTable rows={recent} />
        <p><Link href="/movements">すべての履歴を見る →</Link></p>
      </section>
    </>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: number; tone?: "warn" | "danger"; href: string }) {
  return (
    <Link href={href} className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </Link>
  );
}
