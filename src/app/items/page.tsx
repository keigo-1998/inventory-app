// 商品一覧（データベースから読んで、画面の部品に渡す）
import { db } from "@/lib/db";
import { fmtDate, todayJst } from "@/lib/format";
import { ItemsView, type ItemRow, type ChannelInfo, type LotInfo } from "./ItemsView";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const [items, channels, lots, genres] = await Promise.all([
    db.item.findMany({
      where: { deletedAt: null },
      include: {
        genre: true,
        listings: { where: { state: { in: ["active", "sold"] } }, include: { channel: true }, orderBy: { startedAt: "asc" } },
        saleLines: { where: { sale: { cancelledAt: null } }, include: { sale: { include: { channel: true, lines: true } } } },
      },
      orderBy: { code: "asc" },
    }),
    db.channel.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.lot.findMany({ where: { deletedAt: null } }),
    db.genre.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
  ]);

  const today = new Date(`${todayJst()}T00:00:00+09:00`).getTime();
  const lotById = new Map(lots.map((l) => [l.id, l]));

  const rows: ItemRow[] = items.map((it) => {
    const soldQty = it.saleLines.reduce((a, l) => a + l.quantity, 0);
    const inStock = it.status === "stock" || it.status === "list";
    // いちばん新しい販売（売却済みの商品の利益の内訳に使う）
    const last = it.saleLines.map((l) => ({ line: l, sale: l.sale })).sort((a, b) => b.sale.soldAt.getTime() - a.sale.soldAt.getTime())[0];
    return {
      id: it.id,
      code: it.code,
      name: it.name,
      genre: it.genre?.name ?? "",
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

  return <ItemsView rows={rows} channels={ch} lots={lotInfo} genres={genres.map((g) => g.name)} />;
}
