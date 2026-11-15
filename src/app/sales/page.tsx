// 販売を記録（データベースから在庫の商品・販路・為替・今日の記録・送料未定を読んで、画面に渡す）
import { db } from "@/lib/db";
import { LIVE_SALE } from "@/lib/sale-live";
import { fmtDate, todayJst } from "@/lib/format";
import { monthRate, monthOf, thisMonth } from "@/lib/fx";
import { SalesView, type StockItem, type TodaySale, type TbdSale } from "./SalesView";
import type { ChannelSetting } from "./ChannelSettings";
import type { FxMonth } from "./FxPanel";
import { saleProfit, type ChannelRule } from "@/lib/sale-calc";

export const dynamic = "force-dynamic";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const today = todayJst();
  const startOfToday = new Date(`${today}T00:00:00+09:00`);
  const [items, channels, todays, tbd, allChannels, fxSales, dayRates, avgRates] = await Promise.all([
    db.item.findMany({
      where: { deletedAt: null, status: { in: ["stock", "list"] } },
      include: { listings: { where: { state: "active" }, include: { channel: true } }, saleLines: { where: { sale: LIVE_SALE } } },
      orderBy: { code: "asc" },
    }),
    db.channel.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.sale.findMany({
      where: { cancelledAt: null, createdAt: { gte: startOfToday } },
      include: { channel: true, adjustments: true, lines: { include: { item: { include: { listings: { where: { state: "withdrawn" }, include: { channel: true } } } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.sale.findMany({ where: { cancelledAt: null, shippingTentative: true }, include: { channel: true, adjustments: true, lines: { include: { item: true } } }, orderBy: { soldAt: "asc" } }),
    db.channel.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { sales: { where: { cancelledAt: null } } } } } }),
    db.sale.findMany({ where: { cancelledAt: null, currency: { not: "JPY" } }, select: { soldAt: true, fxRateFinal: true } }),
    db.exchangeRate.findMany({ orderBy: { date: "asc" } }),
    db.monthRate.findMany(),
  ]);

  const now = new Date();
  const rates = { EUR: await monthRate(db, "EUR", now), USD: await monthRate(db, "USD", now) };

  const stock: StockItem[] = items.map((it) => ({
    id: it.id, code: it.code, name: it.name, unitCost: it.unitCost, quantity: it.quantity,
    left: it.quantity - it.saleLines.reduce((a, l) => a + l.quantity, 0),
    channels: it.listings.map((l) => l.channel.name),
  }));
  const rules: ChannelRule[] = channels.map((c) => ({
    name: c.name, currency: c.currency, feeMode: c.feeMode, feeRate: c.feeRate == null ? null : Number(c.feeRate),
    feeHintRate: c.feeHintRate == null ? null : Number(c.feeHintRate), usesShippingFee: c.usesShippingFee, undecided: c.undecided,
  }));
  const profitOf = saleProfit;
  const todayList: TodaySale[] = todays.map((s) => ({
    id: s.id,
    label: s.lines.map((l) => `${l.item.code} ${l.item.name}`).join("、"),
    channel: s.channel?.name ?? (s.kind === "disposed" ? "廃棄" : "備品にした"),
    qty: s.lines.reduce((a, l) => a + l.quantity, 0),
    priceJpy: s.priceJpy,
    profit: profitOf(s),
    tentative: s.shippingTentative,
    // この販売で外した出品先（取り下げのお知らせ）
    others: s.lines.flatMap((l) => l.item.listings.filter((x) => x.endedBySaleId === s.id).map((x) => x.channel.name)),
  }));
  const tbdList: TbdSale[] = tbd.map((s) => ({
    id: s.id, date: fmtDate(s.soldAt), channel: s.channel?.name ?? "", label: s.lines.map((l) => `${l.item.code} ${l.item.name}`).join("、"),
    real: s.actualShippingJpy, profit: profitOf(s) ?? 0,
    base: (profitOf(s) ?? 0) + s.actualShippingJpy,
  }));

  const settings: ChannelSetting[] = allChannels.map((c) => ({
    id: c.id, name: c.name, currency: c.currency, feeMode: c.feeMode, feeRate: c.feeRate == null ? null : Number(c.feeRate),
    feeHintRate: c.feeHintRate == null ? null : Number(c.feeHintRate), usesShippingFee: c.usesShippingFee, shippingPaidBy: c.shippingPaidBy,
    refundVia: c.refundVia, returnShippingBack: c.returnShippingBack, undecided: c.undecided, hidden: !!c.deletedAt, used: c._count.sales,
  }));

  // 為替レート：今月から3か月前までと、外貨の販売がある月
  const nowM = thisMonth();
  const monthSet = new Set<string>([nowM]);
  for (let i = 1; i <= 3; i++) { const [y, m] = nowM.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - i, 15)); monthSet.add(d.toISOString().slice(0, 7)); }
  fxSales.forEach((s) => monthSet.add(monthOf(s.soldAt)));
  const fxMonths: FxMonth[] = [...monthSet].sort().reverse().map((m) => {
    const first: FxMonth["first"] = {}, avg: FxMonth["avg"] = {};
    for (const c of ["EUR", "USD"] as const) {
      const d = dayRates.find((r) => r.currency === c && monthOf(r.date) === m);
      if (d) first[c] = { date: fmtDate(d.date).replace(/\//g, "-"), ttm: Number(d.ttm), source: d.source };
      const a = avgRates.find((r) => r.currency === c && r.month === m);
      if (a) avg[c] = { ttm: Number(a.ttm), source: a.source };
    }
    const ss = fxSales.filter((s) => monthOf(s.soldAt) === m);
    return { month: m, ended: m < nowM, first, avg, sales: ss.length, finalCount: ss.filter((s) => s.fxRateFinal).length };
  });

  return <SalesView fxMonths={fxMonths} settings={settings} initialTab={tab} items={stock} channels={rules} rates={rates} today={today.replace(/-/g, "/")} todayList={todayList} tbdList={tbdList} />;
}
