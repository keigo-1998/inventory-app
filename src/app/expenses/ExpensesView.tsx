"use client";
// 経費の一覧と記録。オークションの入場料など、商品の原価に入れない費用を入れる
// 伝票CSVに入場料があるときは、商品を登録する画面から「経費として記録する」でも入る
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordExpense, removeExpense } from "@/lib/expense-actions";
import { EXPENSE_CATEGORIES } from "@/lib/expense";
import { yen } from "@/lib/format";
import { toast, esc } from "@/lib/toast";
import { ask } from "@/lib/ask";

export type ExpenseRow = { id: number; date: string; category: string; amount: number; supplier: string; note: string };

export function ExpensesView({ rows, today }: { rows: ExpenseRow[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState("入場料");
  const [amount, setAmount] = useState("");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  // 月ごとの合計
  const months = useMemo(() => {
    const m = new Map<string, { total: number; rows: ExpenseRow[] }>();
    for (const r of rows) { const k = r.date.slice(0, 7); const g = m.get(k) ?? { total: 0, rows: [] }; g.total += r.amount; g.rows.push(r); m.set(k, g); }
    return [...m.entries()];
  }, [rows]);

  const save = () => {
    setErr("");
    const v = Number(amount.normalize("NFKC").replace(/[¥,円\s]/g, ""));
    if (!Number.isInteger(v) || v <= 0) { setErr("金額は1円以上の整数で入れてください"); return; }
    start(async () => {
      const res = await recordExpense({ date, category, amount: v, supplier, note });
      if (!res.ok) { setErr(res.error); return; }
      setAmount(""); setNote("");
      router.refresh();
      toast(`${esc(category)} ${yen(v)} を記録しました`, async () => { await removeExpense(res.id); router.refresh(); return "取り消しました"; });
    });
  };
  const remove = (r: ExpenseRow) => {
    start(async () => {
      if (!(await ask(`${r.date} の${r.category} ${yen(r.amount)} を消しますか？\n（消した印を付けるだけで、元に戻せます）`, "消す"))) return;
      await removeExpense(r.id);
      router.refresh();
      toast(`${esc(r.category)} ${yen(r.amount)} を消しました`, async () => { await removeExpense(r.id, false); router.refresh(); return "元に戻しました"; });
    });
  };

  return (
    <section>
      <h1>経費</h1>
      <p className="lead">オークションの入場料など、<b>商品の原価に入れない費用</b>を記録します。月次レポートで、販路の売上とは別に載せます。<br />
        <span className="muted">伝票CSVに入場料があるときは、商品を登録する画面の「経費として記録する」でも入ります。</span></p>

      <div className="card form" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10, alignItems: "end" }}>
        <label className="f"><span>日付</span><input className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f"><span>種類</span>
          <input className="inp" list="expcat" value={category} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="expcat">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="f"><span>金額（税込・円）</span><input className="inp" inputMode="numeric" placeholder="例：2200" value={amount} onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) save(); }} style={{ textAlign: "right" }} /></label>
        <label className="f"><span>どこの（会場など）</span><input className="inp" placeholder="例：オークション（関東）" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
        <label className="f"><span>メモ</span><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn primary" disabled={pending} onClick={save}>記録する</button>
      </div>
      {err && <p className="err">{err}</p>}

      {!rows.length && <p className="muted" style={{ marginTop: 16 }}>まだ経費の記録はありません。</p>}
      {months.map(([m, g]) => (
        <div key={m}>
          <div className="sec">{m.slice(0, 4)}年{Number(m.slice(5))}月　合計 {yen(g.total)}</div>
          <div className="card tablewrap" style={{ padding: "4px 8px" }}>
            <table>
              <thead><tr><th>日付</th><th>種類</th><th>どこの</th><th>メモ</th><th className="n">金額</th><th></th></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td><td>{r.category}</td><td>{r.supplier || "—"}</td><td className="muted">{r.note}</td>
                    <td className="n">{yen(r.amount)}</td>
                    <td><button className="linkbtn" disabled={pending} onClick={() => remove(r)}>消す</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
