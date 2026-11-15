// 月次販売レポートの中身を、販売の記録から計算する（docs/data-design.md「月次レポート（PDF）とfreee会計」）
// - 対象: その月に売れた販売（廃棄・備品は入れない）と、その月にあった返品・一部返金（マイナスの行）
// - 振込予定額（販路ごと）＝ 売上高 − 販売手数料 − 振込から引かれる送料（− 振込から引かれた返金）
//   売上高 ＝ 売値（円）＋ 設定送料（円）
// - 粗利 ＝ 売値（円）＋ 設定送料（円）− 実送料 − 手数料（円）− 原価（返品・返金の行も足し引きする）
import type { Prisma, PrismaClient } from "@prisma/client";
import { monthRange } from "@/lib/fx";

export type ReportLine = {
  kind: "sale" | "refund" | "return";
  date: string; // "10/04"
  codes: string;
  name: string;
  channel: string;
  currency: string;
  priceForeign: number | null; // 外貨の売値（ドル・ユーロ。セントではない）
  price: number; // 売値（円）
  ship: number; // 設定送料（円）
  real: number; // 実送料（円）。返品の行は返品の送料
  fee: number; // 手数料（円）
  cost: number; // 原価
  profit: number;
  tentative: boolean; // 送料が仮
  inPayout: boolean; // 振込の突き合わせに入れるか（法人口座から返した返金は入れない）
  note: string;
  saleId: number;
};
export type ReportChannel = {
  name: string; currency: string; shipDeduct: boolean;
  n: number; // 販売件数
  sales: number; fee: number; ship: number; expect: number; // 振込の突き合わせ
  price: number; shipFee: number; real: number; feeAll: number; cost: number; profit: number; // 粗利のまとめ（返品・返金も入れる）
  tentative: number;
};
export type ReportData = {
  month: string;
  made: string; // 作った日時
  rates: { currency: string; rate: number; final: boolean }[];
  /** その月の月中平均TTM（三菱UFJ銀行）。外貨の販売の円の金額は、これで換算する。月が終わるまでは空 */
  monthRates?: { currency: string; ttm: number; source: string }[];
  lines: ReportLine[];
  channels: ReportChannel[];
  fxPending: number; // 為替がまだ仮の販売の件数
};

type Db = Prisma.TransactionClient | PrismaClient;
const md = (d: Date) => { const j = new Date(d.getTime() + 9 * 3600 * 1000); return `${String(j.getUTCMonth() + 1).padStart(2, "0")}/${String(j.getUTCDate()).padStart(2, "0")}`; };
const nowText = () => { const j = new Date(Date.now() + 9 * 3600 * 1000); return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, "0")}/${String(j.getUTCDate()).padStart(2, "0")} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; };

export async function buildReport(db: Db, month: string): Promise<ReportData> {
  const { start, end } = monthRange(month);
  const inc = { channel: true, lines: { include: { item: true } } } as const;
  const [sales, adjs, channels, mrates] = await Promise.all([
    db.sale.findMany({ where: { cancelledAt: null, kind: "sale", soldAt: { gte: start, lt: end } }, include: inc, orderBy: [{ soldAt: "asc" }, { id: "asc" }] }),
    db.saleAdjustment.findMany({ where: { cancelledAt: null, date: { gte: start, lt: end }, sale: { cancelledAt: null } }, include: { sale: { include: inc } }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
    db.channel.findMany({ orderBy: { sortOrder: "asc" } }),
    db.monthRate.findMany({ where: { month }, orderBy: { currency: "asc" } }),
  ]);
  const chOrder = new Map(channels.map((c, i) => [c.name, i]));
  const chInfo = new Map(channels.map((c) => [c.name, c]));
  const label = (s: (typeof sales)[number]) => ({
    codes: s.lines.map((l) => l.item.code).join("・"),
    name: s.lines.length > 1 ? `${s.lines[0].item.name} ほか${s.lines.length - 1}点（まとめて売った）` : s.lines[0]?.item.name ?? "",
  });
  const lines: ReportLine[] = [];
  for (const s of sales) {
    const cost = s.lines.reduce((a, l) => a + l.costJpy, 0);
    lines.push({
      kind: "sale", date: md(s.soldAt), ...label(s), channel: s.channel?.name ?? "", currency: s.currency,
      priceForeign: s.priceForeign == null ? null : s.priceForeign / 100,
      price: s.priceJpy, ship: s.shippingFeeJpy, real: s.actualShippingJpy, fee: s.feeJpy, cost,
      profit: s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - cost,
      tentative: s.shippingTentative, inPayout: true, note: "", saleId: s.id,
    });
  }
  for (const a of adjs) {
    const s = a.sale;
    const base = { date: md(a.date), ...label(s), channel: s.channel?.name ?? "", currency: s.currency, priceForeign: null, tentative: false, saleId: s.id };
    if (a.kind === "refund") {
      const viaBank = a.via === "bank";
      lines.push({
        ...base, kind: "refund", price: -a.refundJpy, ship: 0, real: 0, fee: 0, cost: 0, profit: -a.refundJpy, inPayout: !viaBank,
        note: `一部返金（${md(s.soldAt)}に売れた分）${viaBank ? "・法人口座から振込（振込・CSVには入れない）" : "・販路の振込から引かれる"}`,
      });
    } else {
      // 返品：売上と手数料を戻し（手数料は運営から返される）、商品が戻るので原価も戻す。返品の送料と戻らない手数料は損
      const cost = s.lines.reduce((x, l) => x + l.costJpy, 0);
      const fee = -s.feeJpy + a.lostFeeJpy;
      const price = -s.priceJpy, ship = -s.shippingFeeJpy, real = a.returnShippingJpy;
      lines.push({
        ...base, kind: "return", price, ship, real, fee, cost: -cost, profit: price + ship - real - fee + cost, inPayout: true,
        note: `返品（${md(s.soldAt)}に売れた分。商品は在庫に戻った）`,
      });
    }
  }
  lines.sort((a, b) => (chOrder.get(a.channel) ?? 99) - (chOrder.get(b.channel) ?? 99) || a.date.localeCompare(b.date));

  const names = [...new Set(lines.map((l) => l.channel))].sort((a, b) => (chOrder.get(a) ?? 99) - (chOrder.get(b) ?? 99));
  const sum = (ls: ReportLine[], k: keyof ReportLine) => ls.reduce((a, l) => a + (l[k] as number), 0);
  const chs: ReportChannel[] = names.map((name) => {
    const ls = lines.filter((l) => l.channel === name);
    const pay = ls.filter((l) => l.inPayout);
    const c = chInfo.get(name);
    const shipDeduct = c?.shippingPaidBy === "payout";
    const sales = sum(pay, "price") + sum(pay, "ship");
    const fee = sum(pay, "fee");
    const ship = shipDeduct ? sum(ls.filter((l) => l.kind === "sale"), "real") : 0;
    return {
      name, currency: c?.currency ?? "JPY", shipDeduct, n: ls.filter((l) => l.kind === "sale").length,
      sales, fee, ship, expect: sales - fee - ship,
      price: sum(ls, "price"), shipFee: sum(ls, "ship"), real: sum(ls, "real"), feeAll: sum(ls, "fee"), cost: sum(ls, "cost"), profit: sum(ls, "profit"),
      tentative: ls.filter((l) => l.tentative).length,
    };
  });

  // 使った為替レート（外貨の販売のレート。確定していなければ仮）
  const rates: ReportData["rates"] = [];
  for (const cur of ["EUR", "USD"]) {
    const fx = sales.filter((s) => s.currency === cur && s.fxRate != null);
    if (!fx.length) continue;
    const r = Number(fx[0].fxRate);
    rates.push({ currency: cur, rate: r, final: fx.every((s) => s.fxRateFinal && Number(s.fxRate) === r) });
  }
  const monthRates = mrates.map((r) => ({ currency: r.currency, ttm: Number(r.ttm), source: r.source }));
  return { month, made: nowText(), rates, monthRates, lines, channels: chs, fxPending: sales.filter((s) => s.currency !== "JPY" && !s.fxRateFinal).length };
}

/** 中身が変わったかを見るための目印（確定した版と、今の販売の記録を比べる） */
export const reportKey = (d: ReportData) =>
  JSON.stringify(d.lines.map((l) => [l.kind, l.saleId, l.price, l.ship, l.real, l.fee, l.cost, l.tentative, l.inPayout]));
