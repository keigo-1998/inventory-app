import Link from "next/link";
import { db } from "@/lib/db";
import { createLoan, returnLoan } from "@/lib/actions";
import { fmtDate, isOverdue, todayJst } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const all = show === "all";
  const [loans, items] = await Promise.all([
    db.loan.findMany({
      where: all ? {} : { returnedAt: null },
      include: { item: true },
      orderBy: [{ returnedAt: "asc" }, { dueDate: "asc" }, { loanedAt: "desc" }],
      take: 200,
    }),
    db.item.findMany({ where: { quantity: { gt: 0 } }, orderBy: { code: "asc" } }),
  ]);

  return (
    <>
      <h1>貸出管理</h1>
      <section className="card">
        <h2>新規貸出</h2>
        <ActionForm action={createLoan} submitLabel="貸し出す" resetOnSuccess>
          <div className="grid-3">
            <label className="span-2">
              品目 <span className="req">*</span>
              <select name="itemId" required defaultValue="">
                <option value="" disabled>選択してください</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} {i.name}（在庫 {i.quantity}{i.unit}）
                  </option>
                ))}
              </select>
            </label>
            <label>数量<input name="quantity" type="number" min={1} defaultValue={1} required /></label>
            <label>借用者 <span className="req">*</span><input name="borrower" required /></label>
            <label>返却期限<input name="dueDate" type="date" min={todayJst()} /></label>
            <label>備考<input name="note" /></label>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <div className="page-head">
          <h2>{all ? "すべての貸出記録" : "貸出中"}</h2>
          <Link href={all ? "/loans" : "/loans?show=all"}>{all ? "貸出中のみ表示" : "返却済みも表示"}</Link>
        </div>
        <table className="table">
          <thead>
            <tr><th>品目</th><th className="num">数量</th><th>借用者</th><th>貸出日</th><th>返却期限</th><th>返却日</th><th>備考</th><th></th></tr>
          </thead>
          <tbody>
            {loans.map((l) => {
              const od = isOverdue(l.dueDate, l.returnedAt);
              return (
                <tr key={l.id} className={l.returnedAt ? "row-muted" : ""}>
                  <td><Link href={`/items/${l.itemId}`}>{l.item.name}</Link></td>
                  <td className="num">{l.quantity} {l.item.unit}</td>
                  <td>{l.borrower}</td>
                  <td>{fmtDate(l.loanedAt)}</td>
                  <td className={od ? "text-danger strong" : ""}>{fmtDate(l.dueDate)}{od && " 超過"}</td>
                  <td>{fmtDate(l.returnedAt)}</td>
                  <td className="muted">{l.note ?? ""}</td>
                  <td>
                    {!l.returnedAt && (
                      <ConfirmButton action={returnLoan.bind(null, l.id)} confirm={`${l.borrower} さんの「${l.item.name}」の返却を記録しますか？`}>
                        返却
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              );
            })}
            {loans.length === 0 && <tr><td colSpan={8} className="muted center">貸出記録はありません</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
