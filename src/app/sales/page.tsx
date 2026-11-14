// 販売を記録（データベースから在庫の商品・販路・為替・今日の記録・送料未定を読んで、画面に渡す）
import { db } from "@/lib/db";
import { fmtDate, todayJst } from "@/lib/format";
import { monthRate } from "@/lib/fx";
import { SalesView, type StockItem, type TodaySale, type TbdSale } from "./SalesView";
import type { ChannelRule } from "@/lib/sale-calc";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const today = todayJst();
  const startOfToday = new Date(`${today}T00:00:00+09:00`);
  const [items, channels, todays, tbd] = await Promise.all([
    db.item.findMany({
      where: { deletedAt: null, status: { in: ["stock", "list"] } },
      include: { listings: { where: { state: "active" }, include: { channel: true } }, saleLines: { where: { sale: { cancelledAt: null } } } },
      orderBy: { code: "asc" },
    }),
    db.channel.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.sale.findMany({
      where: { cancelledAt: null, createdAt: { gte: startOfToday } },
      include: { channel: true, lines: { include: { item: { include: { listings: { where: { state: "withdrawn" }, include: { channel: true } } } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.sale.findMany({ where: { cancelledAt: null, shippingTentative: true }, include: { channel: true, lines: { include: { item: true } } }, orderBy: { soldAt: "asc" } }),
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
  const profitOf = (s: { kind: string; priceJpy: number; shippingFeeJpy: number; actualShippingJpy: number; feeJpy: number; lines: { costJpy: number }[] }) => {
    const cost = s.lines.reduce((a, l) => a + l.costJpy, 0);
    return s.kind === "sale" ? s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - cost : s.kind === "disposed" ? -cost : null;
  };
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
    base: s.priceJpy + s.shippingFeeJpy - s.feeJpy - s.lines.reduce((a, l) => a + l.costJpy, 0),
  }));

  return <SalesView items={stock} channels={rules} rates={rates} today={today.replace(/-/g, "/")} todayList={todayList} tbdList={tbdList} />;
}
