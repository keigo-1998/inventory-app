// ダッシュボード（ECの売上・粗利・売上目標、在庫、山の回収）。データベースから集計して画面に渡す
// 売上・粗利は月次レポートと同じ計算（売れた日の月。返品・返金はあった月にマイナス）
import { db } from "@/lib/db";
import { todayJst } from "@/lib/format";
import { thisMonth } from "@/lib/fx";
import { buildReport } from "@/lib/report";
import { LIVE_SALE } from "@/lib/sale-live";
import { DashboardView, type DashData } from "./DashboardView";

export const dynamic = "force-dynamic";

const addMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 15)).toISOString().slice(0, 7); };

export default async function DashboardPage() {
  const now = thisMonth();
  const months = Array.from({ length: 12 }, (_, i) => addMonth(now, i - 11));
  const reports = await Promise.all(months.map((m) => buildReport(db, m)));
  const [targets, items, lots, tbd, drafts] = await Promise.all([
    db.salesTarget.findMany({ where: { month: { gte: months[0], lte: addMonth(now, 3) } } }),
    db.item.findMany({
      where: { deletedAt: null, status: { in: ["stock", "list"] } },
      include: { genre: true, saleLines: { where: { sale: LIVE_SALE } }, listings: { where: { state: "active" } } },
    }),
    db.lot.findMany({
      where: { deletedAt: null },
      include: { items: { where: { deletedAt: null }, include: { saleLines: { where: { sale: LIVE_SALE } } } } },
      orderBy: { purchasedAt: "desc" },
    }),
    db.sale.count({ where: { cancelledAt: null, shippingTentative: true } }),
    db.monthlyReport.findMany({ where: { version: { gt: 0 } }, select: { month: true } }),
  ]);
  const tmap = new Map(targets.map((t) => [t.month, t.amountJpy]));

  // 月ごとの売上・粗利
  const monthly = reports.map((r) => {
    const sales = r.lines.reduce((a, l) => a + l.price + l.ship, 0);
    const profit = r.lines.reduce((a, l) => a + l.profit, 0);
    return { month: r.month, sales, profit, n: r.lines.filter((l) => l.kind === "sale").length, target: tmap.get(r.month) ?? null };
  });
  const cur = reports[reports.length - 1];
  const channels = cur.channels.map((c) => ({ name: c.name, sales: c.price + c.shipFee, profit: c.profit, n: c.n }));

  // ジャンルごと（今月売れた商品の粗利。まとめて売った分は、分けた金額で）
  const today = new Date(`${todayJst()}T00:00:00+09:00`);
  const curSales = await db.sale.findMany({
    // 返品された販売は入れない（返品の行と打ち消し合うため）
    where: { cancelledAt: null, kind: "sale", soldAt: { gte: new Date(`${now}-01T00:00:00+09:00`) }, adjustments: { none: { kind: "return", cancelledAt: null } } },
    include: { lines: { include: { item: { include: { genre: true } } } } },
  });
  const genreMap = new Map<string, { sales: number; profit: number; n: number }>();
  for (const s of curSales) {
    for (const l of s.lines) {
      const g = l.item.genre?.name ?? "（ジャンルなし）";
      const one = s.lines.length === 1;
      const amount = one ? s.priceJpy + s.shippingFeeJpy : l.amountJpy;
      const profit = one ? s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - l.costJpy : l.amountJpy - l.costJpy - Math.round((s.feeJpy + s.actualShippingJpy) * (s.priceJpy ? l.amountJpy / s.priceJpy : 0));
      const x = genreMap.get(g) ?? { sales: 0, profit: 0, n: 0 };
      x.sales += amount; x.profit += profit; x.n += 1;
      genreMap.set(g, x);
    }
  }
  const genres = [...genreMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.profit - a.profit);

  // 在庫
  const stock = items.map((it) => {
    const left = it.quantity - it.saleLines.reduce((a, l) => a + l.quantity, 0);
    return { left, value: left * it.unitCost, listed: it.listings.length > 0, days: Math.floor((today.getTime() - it.purchasedAt.getTime()) / 86400000), exp: (it.expectedPrice ?? 0) * left };
  }).filter((x) => x.left > 0);
  const bucket = (lo: number, hi: number) => { const xs = stock.filter((x) => x.days >= lo && x.days <= hi); return { n: xs.length, value: xs.reduce((a, x) => a + x.value, 0) }; };
  const inventory = {
    n: stock.length, value: stock.reduce((a, x) => a + x.value, 0), exp: stock.reduce((a, x) => a + x.exp, 0),
    listed: stock.filter((x) => x.listed).length,
    aging: [
      { label: "30日以内", ...bucket(0, 30) }, { label: "31〜90日", ...bucket(31, 90) },
      { label: "91〜180日", ...bucket(91, 180) }, { label: "181日以上", ...bucket(181, 1e9) },
    ],
  };

  // 山の回収（仕入額に対して、売れた金額がどれだけ戻ったか）
  const lotRows = lots.map((l) => {
    const sold = l.items.flatMap((i) => i.saleLines).reduce((a, sl) => a + sl.amountJpy, 0);
    const branches = l.items.filter((i) => !i.code.endsWith("-0"));
    return {
      code: l.code, name: l.name, cost: l.totalCost, sold, rate: l.totalCost ? sold / l.totalCost : 0,
      branches: branches.length, soldBranches: branches.filter((b) => b.status !== "stock" && b.status !== "list").length,
      days: Math.floor((today.getTime() - l.purchasedAt.getTime()) / 86400000),
    };
  });

  // 気をつけること
  const fixed = new Set(drafts.map((d) => d.month));
  const prev = addMonth(now, -1);
  const prevHasSales = monthly.find((m) => m.month === prev)!.n > 0;
  const fxPending = reports.filter((r) => r.month < now).reduce((a, r) => a + r.fxPending, 0);

  const data: DashData = {
    now, today: todayJst(), monthly, channels, genres, inventory, lots: lotRows,
    alerts: { tbd, fxPending, reportDraft: prevHasSales && !fixed.has(prev) ? prev : null },
    futureTargets: [0, 1, 2, 3].map((i) => addMonth(now, i)).map((m) => ({ month: m, target: tmap.get(m) ?? null })),
  };
  return <DashboardView data={data} />;
}
