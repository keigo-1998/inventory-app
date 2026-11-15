// 月次レポート（データベースから月ごとの状態と中身を読んで、画面に渡す）
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { monthOf, thisMonth } from "@/lib/fx";
import { buildReport, reportKey, type ReportData } from "@/lib/report";
import { ReportView, type MonthRow } from "./ReportView";

export const dynamic = "force-dynamic";

const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 15)).toISOString().slice(0, 7); };

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ m?: string; v?: string }> }) {
  const sp = await searchParams;
  const now = thisMonth();
  const [first, reports] = await Promise.all([
    db.sale.findFirst({ where: { cancelledAt: null, kind: "sale" }, orderBy: { soldAt: "asc" }, select: { soldAt: true } }),
    db.monthlyReport.findMany({ orderBy: [{ month: "desc" }, { version: "desc" }] }),
  ]);
  // 今月から、いちばん古い販売の月まで（最大24か月）
  const months: string[] = [];
  const oldest = first ? monthOf(first.soldAt) : now;
  for (let m = now; months.length < 24; m = prevMonth(m)) { months.push(m); if (m <= oldest) break; }

  const list: MonthRow[] = [];
  for (const m of months) {
    const fixed = reports.filter((r) => r.month === m && r.version > 0);
    const latest = fixed[0];
    let changed = false;
    if (latest?.data) changed = reportKey(JSON.parse(latest.data) as ReportData) !== reportKey(await buildReport(db, m));
    list.push({
      month: m, state: m === now ? "open" : latest ? "fixed" : "draft",
      version: latest?.version ?? 0, fixedAt: latest?.fixedAt ? fmtDate(latest.fixedAt, true) : "", changed,
      versions: fixed.map((r) => ({ version: r.version, fixedAt: r.fixedAt ? fmtDate(r.fixedAt, true) : "" })),
    });
  }
  // 開く月：指定がなければ、まだ確定していない前の月から
  const sel = sp.m && months.includes(sp.m) ? sp.m : list.find((x) => x.state === "draft")?.month ?? prevMonth(now);
  const row = list.find((x) => x.month === sel) ?? list[0];
  const live = await buildReport(db, sel);
  const wantV = sp.v === "draft" ? 0 : sp.v ? Number(sp.v) : row?.version ?? 0;
  const shown = wantV > 0 ? reports.find((r) => r.month === sel && r.version === wantV) : null;
  const draft = reports.find((r) => r.month === sel && r.version === 0);
  const data: ReportData = shown?.data ? JSON.parse(shown.data) : live;
  const paid: Record<string, number> = JSON.parse((shown ?? draft)?.paid ?? "{}");

  return (
    <ReportView
      list={list}
      month={sel}
      version={shown ? shown.version : 0}
      fixedAt={shown?.fixedAt ? fmtDate(shown.fixedAt, true) : ""}
      data={data}
      paid={paid}
      changed={!!shown && reportKey(data) !== reportKey(live)}
    />
  );
}
