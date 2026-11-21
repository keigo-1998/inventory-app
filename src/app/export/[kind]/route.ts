// 全件の書き出し（CSV・Excelで開ける）。/export/items（商品）・/export/sales（販売）
// docs/data-design.md「書き出し」：手元に控えを持つため・Excelで自由に集計するため。中身は見るだけ（取り込みには使わない）
import { db } from "@/lib/db";
import { fmtDate, STATUS_LABEL, todayJst } from "@/lib/format";

export const dynamic = "force-dynamic";

/** CSVの1つのマス（, " 改行 があれば "" で囲む） */
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"; // 先頭の印（BOM）でExcelが文字化けしない
const KIND: Record<string, string> = { sale: "販売", disposed: "廃棄", fixture: "備品にした", closed: "売り切り" };

async function items() {
  const list = await db.item.findMany({
    where: { deletedAt: null },
    include: {
      genre: true, supplier: true, lot: true,
      listings: { where: { state: { in: ["active", "sold"] } }, include: { channel: true } },
      saleLines: { where: { sale: { cancelledAt: null } }, include: { sale: { include: { adjustments: { where: { cancelledAt: null, kind: "return" } } } } } },
    },
    orderBy: { code: "asc" },
  });
  const head = ["管理番号", "商品名", "ジャンル", "仕入先", "仕入日", "原価（1個）", "個数", "残り", "予想売価", "状態", "出品先", "売れた販路", "山"];
  const rows = list.map((it) => {
    const sold = it.saleLines.filter((l) => !l.sale.adjustments.length).reduce((a, l) => a + l.quantity, 0);
    return [
      it.code, it.name, it.genre?.name, it.supplier?.name, fmtDate(it.purchasedAt), it.unitCost, it.quantity, it.quantity - sold, it.expectedPrice,
      STATUS_LABEL[it.status] ?? it.status,
      it.listings.filter((l) => l.state === "active").map((l) => l.channel.name).join("・"),
      it.listings.filter((l) => l.state === "sold").map((l) => l.channel.name).join("・"),
      it.lot?.code,
    ];
  });
  return [head, ...rows];
}

async function sales() {
  const list = await db.sale.findMany({
    where: { cancelledAt: null },
    include: { channel: true, lines: { include: { item: true } }, adjustments: { where: { cancelledAt: null } } },
    orderBy: [{ soldAt: "asc" }, { id: "asc" }],
  });
  const head = ["売却日", "種類", "管理番号", "商品名", "個数", "販路", "通貨", "売値（外貨）", "設定送料（外貨）", "手数料（外貨）", "為替レート", "為替",
    "売値（円）", "設定送料（円）", "手数料（円）", "実送料（円）", "送料", "原価", "粗利（返品・返金の前）", "一部返金", "返品日", "メモ"];
  const f2 = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
  const rows = list.map((s) => {
    const fx = s.currency !== "JPY";
    const cost = s.lines.reduce((a, l) => a + l.costJpy, 0);
    const isSale = s.kind === "sale";
    const ret = s.adjustments.find((a) => a.kind === "return");
    return [
      fmtDate(s.soldAt), KIND[s.kind] ?? s.kind,
      s.lines.map((l) => l.item.code).join("・"),
      s.lines.length === 1 ? s.lines[0].item.name : s.lines.map((l) => l.item.name).join("・"),
      s.lines.reduce((a, l) => a + l.quantity, 0),
      s.channel?.name ?? "", s.currency,
      fx ? f2(s.priceForeign) : "", fx ? f2(s.shippingForeign) : "", fx ? f2(s.feeForeign) : "",
      fx && s.fxRate ? Number(s.fxRate) : "", fx ? (s.fxRateFinal ? "確定" : "仮") : "",
      s.priceJpy, s.shippingFeeJpy, s.feeJpy, s.actualShippingJpy, isSale ? (s.shippingTentative ? "仮" : "確定") : "",
      cost, isSale ? s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - cost : -cost,
      s.adjustments.filter((a) => a.kind === "refund").reduce((a, x) => a + x.refundJpy, 0) || "",
      ret ? fmtDate(ret.date) : "", s.note ?? "",
    ];
  });
  return [head, ...rows];
}

const MAKERS: Record<string, { name: string; make: () => Promise<unknown[][]> }> = {
  items: { name: "商品", make: items },
  sales: { name: "販売", make: sales },
};

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const m = MAKERS[kind];
  if (!m) return new Response("ありません", { status: 404 });
  const body = csv(await m.make());
  const file = `JOYNT_${m.name}_${todayJst().replace(/-/g, "")}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(file)}`,
      "Cache-Control": "no-store",
    },
  });
}
