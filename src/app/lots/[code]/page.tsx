// 山の画面（商品一覧で山の行を押すと開く）。データベースから山と枝番を読んで、画面の部品に渡す
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { LotView, type LotRow } from "./LotView";

export const dynamic = "force-dynamic";

export default async function LotPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lot = await db.lot.findFirst({
    where: { code, deletedAt: null },
    include: {
      supplier: true,
      items: {
        where: { deletedAt: null },
        include: {
          listings: { where: { state: { in: ["active", "sold"] } }, include: { channel: true } },
          saleLines: { where: { sale: { cancelledAt: null } }, include: { sale: { include: { channel: true, lines: true } } } },
        },
      },
    },
  });
  if (!lot) notFound();

  const branchNo = (c: string) => (c.endsWith("-0") ? 1e9 : Number(c.split("-")[1]));
  const rows: LotRow[] = lot.items
    .map((it) => {
      // 売れた金額と粗利。まとめて売ったときは、この商品の分（分けた額）で見る
      let price: number | null = null, profit: number | null = null;
      for (const l of it.saleLines) {
        const s = l.sale;
        if (s.lines.length === 1) {
          price = (price ?? 0) + s.priceJpy;
          profit = (profit ?? 0) + s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - l.costJpy;
        } else {
          price = (price ?? 0) + l.amountJpy;
          profit = (profit ?? 0) + l.amountJpy - l.costJpy;
        }
      }
      return {
        id: it.id, code: it.code, name: it.name, exp: it.expectedPrice, cost: it.unitCost * it.quantity, status: it.status,
        channels: it.listings.filter((l) => l.state === "active").map((l) => l.channel.name),
        soldChannels: it.listings.filter((l) => l.state === "sold").map((l) => l.channel.name),
        price, profit, costMode: it.lotCostMode,
      };
    })
    .sort((a, b) => branchNo(a.code) - branchNo(b.code));

  return (
    <LotView
      lot={{ code: lot.code, name: lot.name, totalCost: lot.totalCost, supplier: lot.supplier?.name ?? "—", purchasedAt: fmtDate(lot.purchasedAt) }}
      rows={rows}
    />
  );
}
