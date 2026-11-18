// スプレッドシートから取り込んだ外貨の販売で、手数料・設定送料が円だけで入っているものに、外貨の金額を入れる
// （シートの円 ÷ シートのレート）。そのあと、月ごとに平均TTMで確定し直せるようにする（確定の印を外す）。
// 使い方: DATABASE_URL=file:./real.db tsx scripts/fx-fill-foreign.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
async function main() {
  const sales = await db.sale.findMany({ where: { cancelledAt: null, currency: { not: "JPY" }, fxRate: { not: null } } });
  let filled = 0;
  for (const s of sales) {
    const rate = Number(s.fxRate);
    const cents = (jpy: number) => Math.round((jpy / rate) * 100);
    const data: { feeForeign?: number; shippingForeign?: number; fxRateFinal: boolean } = { fxRateFinal: false };
    if (s.feeForeign == null && s.feeJpy > 0) data.feeForeign = cents(s.feeJpy);
    if (s.shippingForeign == null && s.shippingFeeJpy > 0) data.shippingForeign = cents(s.shippingFeeJpy);
    if (data.feeForeign != null || data.shippingForeign != null) filled++;
    await db.sale.update({ where: { id: s.id }, data });
    await db.changeLog.create({ data: { table: "Sale", recordId: s.id, action: "update", before: JSON.stringify({ feeForeign: s.feeForeign, shippingForeign: s.shippingForeign, fxRateFinal: s.fxRateFinal }), after: JSON.stringify(data), note: "シートの外貨の販売をTTMで計算し直す準備（外貨の金額を入れ、確定の印を外す）" } });
  }
  console.log(`外貨の販売 ${sales.length}件の確定の印を外し、そのうち ${filled}件に外貨の手数料・送料を入れました`);
}
main().finally(() => db.$disconnect());
