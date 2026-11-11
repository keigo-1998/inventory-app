import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { createLoan, deleteItem, moveStock, returnLoan, updateItem } from "@/lib/actions";
import { fmtDate, isOverdue, todayJst } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ItemFields } from "@/components/ItemFields";
import { MovementTable } from "@/components/MovementTable";
import { StockBadge } from "@/components/StockBadge";

export const dynamic = "force-dynamic";

export default async function ItemDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [item, categories] = await Promise.all([
    db.item.findUnique({
      where: { id },
      include: {
        category: true,
        movements: { orderBy: { createdAt: "desc" }, take: 50, include: { item: true } },
        loans: { where: { returnedAt: null }, orderBy: { loanedAt: "desc" } },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!item) notFound();
  const loanedQty = item.loans.reduce((s, l) => s + l.quantity, 0);

  return (
    <>
      <p className="small"><Link href="/items">← 品目一覧</Link></p>
      <div className="page-head">
        <div>
          <h1>{item.name}</h1>
          <p className="muted mono">{item.code} ・ {item.category?.name ?? "未分類"} ・ {item.location ?? "保管場所未設定"}</p>
        </div>
        <ConfirmButton
          action={deleteItem.bind(null, item.id)}
          confirm={`「${item.name}」を削除しますか？履歴もすべて削除されます。`}
          className="btn btn-danger"
        >
          削除
        </ConfirmButton>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">手元在庫</div><div className="stat-value">{item.quantity}<small> {item.unit}</small></div></div>
        <div className="stat"><div className="stat-label">貸出中</div><div className="stat-value">{loanedQty}<small> {item.unit}</small></div></div>
        <div className="stat"><div className="stat-label">発注点</div><div className="stat-value">{item.minQuantity}<small> {item.unit}</small></div></div>
        <div className="stat"><div className="stat-label">状態</div><div className="stat-value"><StockBadge quantity={item.quantity} min={item.minQuantity} /></div></div>
      </div>

      <div className="grid-2 gap-lg">
        <section className="card">
          <h2>入出庫・棚卸</h2>
          <ActionForm action={moveStock.bind(null, item.id)} submitLabel="記録する" resetOnSuccess>
            <div className="grid-2">
              <label>
                区分
                <select name="type" defaultValue="IN">
                  <option value="IN">入庫（増やす）</option>
                  <option value="OUT">出庫（減らす）</option>
                  <option value="ADJUST">棚卸調整（実数に合わせる）</option>
                </select>
              </label>
              <label>
                数量 / 実在庫数
                <input name="quantity" type="number" min={0} required />
              </label>
              <label>
                担当者
                <input name="operator" />
              </label>
              <label>
                備考
                <input name="note" />
              </label>
            </div>
          </ActionForm>
        </section>

        <section className="card">
          <h2>貸出</h2>
          <ActionForm action={createLoan} submitLabel="貸し出す" resetOnSuccess>
            <input type="hidden" name="itemId" value={item.id} />
            <div className="grid-2">
              <label>借用者 <span className="req">*</span><input name="borrower" required /></label>
              <label>数量<input name="quantity" type="number" min={1} defaultValue={1} required /></label>
              <label>返却期限<input name="dueDate" type="date" min={todayJst()} /></label>
              <label>備考<input name="note" /></label>
            </div>
          </ActionForm>
          {item.loans.length > 0 && (
            <table className="table mt">
              <thead><tr><th>借用者</th><th className="num">数量</th><th>貸出日</th><th>期限</th><th></th></tr></thead>
              <tbody>
                {item.loans.map((l) => (
                  <tr key={l.id}>
                    <td>{l.borrower}</td>
                    <td className="num">{l.quantity}</td>
                    <td>{fmtDate(l.loanedAt)}</td>
                    <td className={isOverdue(l.dueDate, l.returnedAt) ? "text-danger" : ""}>{fmtDate(l.dueDate)}</td>
                    <td><ConfirmButton action={returnLoan.bind(null, l.id)} confirm="返却を記録しますか？">返却</ConfirmButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>履歴（最新50件）</h2>
        <MovementTable rows={item.movements} hideItem />
      </section>

      <section className="card">
        <details>
          <summary><h2 className="inline">品目情報を編集</h2></summary>
          <ActionForm action={updateItem.bind(null, item.id)} submitLabel="更新する">
            <ItemFields categories={categories} item={item} />
          </ActionForm>
        </details>
      </section>
    </>
  );
}
