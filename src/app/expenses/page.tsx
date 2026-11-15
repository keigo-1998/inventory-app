// 経費（入場料など）。データベースから読んで画面に渡す
import { db } from "@/lib/db";
import { fmtDate, todayJst } from "@/lib/format";
import { ExpensesView, type ExpenseRow } from "./ExpensesView";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const list = await db.expense.findMany({ where: { deletedAt: null }, orderBy: [{ date: "desc" }, { id: "desc" }] });
  const rows: ExpenseRow[] = list.map((e) => ({ id: e.id, date: fmtDate(e.date), category: e.category, amount: e.amountJpy, supplier: e.supplier ?? "", note: e.note ?? "" }));
  return <ExpensesView rows={rows} today={todayJst().replace(/-/g, "/")} />;
}
