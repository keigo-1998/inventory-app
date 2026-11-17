// 商品一覧（データベースから読んで、画面の部品に渡す）
import { db } from "@/lib/db";
import { fmtDate, todayJst } from "@/lib/format";
import { returnLoss } from "@/lib/sale-calc";
import { ItemsView, type ItemRow, type ChannelInfo, type LotInfo, type RemovedItem } from "./ItemsView";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const [items, channels, lots, genres, suppliers, deleted] = await Promise.all([
    db.item.findMany({
      where: { deletedAt: null },
      include: {
        genre: true,
        supplier: true,
        listings: { where: { state: { in: ["active", "sold"] } }, include: { channel: true }, orderBy: { startedAt: "asc" } },
        saleLines: { where: { sale: { cancelledAt: null } }, include: { sale: { include: { channel: true, lines: true, adjustments: { where: { cancelledAt: null } } } } } },
      },
      orderBy: { code: "asc" },
    }),
    db.channel.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.lot.findMany({ where: { deletedAt: null } }),
    db.genre.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.supplier.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    // 消した商品（山ごと消したときは、山の -0 だけを出す）
    db.item.findMany({ where: { deletedAt: { not: null } }, include: { lot: true }, orderBy: { deletedAt: "desc" }, take: 200 }),
  ]);

  const today = new Date(`${todayJst()}T00:00:00+09:00`).getTime();
  const lotById = new Map(lots.map((l) => [l.id, l]));

  const rows: ItemRow[] = items.map((it) => {
    // 返品された販売は「売れた」に数えない（商品は在庫に戻っている）
    const isReturned = (s: (typeof it.saleLines)[number]["sale"]) => s.adjustments.some((a) => a.kind === "return");
    const liveLines = it.saleLines.filter((l) => !isReturned(l.sale));
    const soldQty = liveLines.reduce((a, l) => a + l.quantity, 0);
    const inStock = it.status === "stock" || it.status === "list";
    // いちばん新しい販売（売却済みの商品の利益の内訳に使う）
    const last = liveLines.map((l) => ({ line: l, sale: l.sale })).sort((a, b) => b.sale.soldAt.getTime() - a.sale.soldAt.getTime())[0];
    return {
      id: it.id,
      code: it.code,
      name: it.name,
      genre: it.genre?.name ?? "",
      supplier: it.supplier?.name ?? "",
      purchasedAt: fmtDate(it.purchasedAt),
      unitCost: it.unitCost,
      expectedPrice: it.expectedPrice,
      quantity: it.quantity,
      left: it.quantity - soldQty,
      status: it.status,
      channels: it.listings.filter((l) => l.state === "active").map((l) => l.channel.name),
      soldChannels: it.listings.filter((l) => l.state === "sold").map((l) => l.channel.name),
      days: inStock ? Math.max(0, Math.floor((today - it.purchasedAt.getTime()) / 86400000)) : null,
      lotCode: it.lotId ? lotById.get(it.lotId)?.code ?? null : null,
      lotCostMode: it.lotCostMode,
      sale: last
        ? {
            saleId: last.sale.id,
            refundVia: last.sale.channel?.refundVia ?? "payout",
            returnShippingBack: last.sale.channel?.returnShippingBack ?? false,
            refunds: last.sale.adjustments.filter((a) => a.kind === "refund").map((a) => ({ id: a.id, date: fmtDate(a.date), amount: a.refundJpy, via: a.via ?? "payout" })),
            date: fmtDate(last.sale.soldAt),
            channel: last.sale.channel?.name ?? "",
            currency: last.sale.currency,
            fxRate: last.sale.fxRate ? Number(last.sale.fxRate) : null,
            fxRateFinal: last.sale.fxRateFinal,
            priceForeign: last.sale.priceForeign,
            shippingForeign: last.sale.shippingForeign,
            feeForeign: last.sale.feeForeign,
            priceJpy: last.sale.priceJpy,
            shippingFeeJpy: last.sale.shippingFeeJpy,
            actualShippingJpy: last.sale.actualShippingJpy,
            shippingTentative: last.sale.shippingTentative,
            feeJpy: last.sale.feeJpy,
            costJpy: last.sale.lines.reduce((a, l) => a + l.costJpy, 0),
            lineCount: last.sale.lines.length,
          }
        : null,
      returns: it.saleLines
        .filter((l) => isReturned(l.sale))
        .map((l) => {
          const a = l.sale.adjustments.find((x) => x.kind === "return")!;
          return { adjId: a.id, date: fmtDate(a.date), channel: l.sale.channel?.name ?? "", loss: returnLoss(l.sale, a) };
        }),
    };
  });

  const ch: ChannelInfo[] = channels.map((c) => ({
    id: c.id,
    name: c.name,
    currency: c.currency,
    feeMode: c.feeMode,
    feeRate: c.feeRate ? Number(c.feeRate) : null,
    feeHintRate: c.feeHintRate ? Number(c.feeHintRate) : null,
    usesShippingFee: c.usesShippingFee,
    undecided: c.undecided,
  }));
  const lotInfo: LotInfo[] = lots.map((l) => ({ code: l.code, name: l.name, totalCost: l.totalCost }));

  const removed: RemovedItem[] = deleted
    .filter((d) => !d.lot || !d.lot.deletedAt || d.code === `${d.lot.code}-0`)
    .map((d) => ({
      id: d.id, code: d.code, name: d.name, deletedAt: fmtDate(d.deletedAt!),
      withBranches: !!d.lot?.deletedAt && d.code === `${d.lot.code}-0` ? deleted.filter((x) => x.lotId === d.lotId && x.id !== d.id && x.deletedAt?.getTime() === d.deletedAt?.getTime()).length : 0,
    }));

  return <ItemsView rows={rows} channels={ch} lots={lotInfo} genres={genres.map((g) => g.name)} suppliers={suppliers.map((x) => x.name)} removed={removed} />;
}
