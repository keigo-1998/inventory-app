// 変更履歴（ChangeLog）を、人が読める形にして画面に渡す
// docs/data-design.md「変更履歴の画面」
// - 同じ操作でまとめて変わったもの（同じ説明・数秒以内）は1行にまとめる
// - 「何が」は管理番号（販売・出品先も、その商品の管理番号）で出す
// - 変わった項目は日本語の名前と、円・日付・状態の言葉で出す
import { db } from "@/lib/db";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { HistoryView, type HistGroup, type HistRow } from "./HistoryView";

export const dynamic = "force-dynamic";

const LIMIT = 5000; // 新しい順にこの件数まで読む

const FIELD: Record<string, string> = {
  code: "管理番号", name: "商品名", genre: "ジャンル", supplier: "仕入先", date: "日付", purchasedAt: "仕入日", unitCost: "原価", quantity: "個数", expectedPrice: "予想売価",
  status: "状態", state: "出品の状態", channel: "販路", channelId: "売り先", item: "商品", items: "商品", qty: "個数", total: "売れた金額", profit: "粗利",
  soldAt: "売却日", priceJpy: "売値", shippingFeeJpy: "設定送料", feeJpy: "手数料", actualShippingJpy: "実送料", shippingTentative: "送料が仮",
  priceForeign: "売値（外貨）", shippingForeign: "設定送料（外貨）", feeForeign: "手数料（外貨）", fxRate: "為替レート", fxRateFinal: "為替の確定",
  month: "月", amountJpy: "売上目標", profitJpy: "粗利目標", version: "版", totalCost: "仕入額",
};
const YEN = new Set(["unitCost", "expectedPrice", "total", "profit", "priceJpy", "shippingFeeJpy", "feeJpy", "actualShippingJpy", "amountJpy", "profitJpy", "totalCost"]);
const CENTS = new Set(["priceForeign", "shippingForeign", "feeForeign"]);
const LISTING: Record<string, string> = { active: "出品中", withdrawn: "取り下げ", sold: "売れた", cancelled: "取り消し" };
const ACTION: Record<string, string> = { create: "追加", update: "変更", delete: "取り消し", restore: "戻す" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const logs = await db.changeLog.findMany({ orderBy: { id: "desc" }, take: LIMIT });

  // 番号から名前を引くための表（消した物も含める）
  const ids = (t: string) => [...new Set(logs.filter((l) => l.table === t).map((l) => l.recordId))];
  const [items, sales, listings, lots, channels, suppliers, genres, adjs, reports] = await Promise.all([
    db.item.findMany({ where: { id: { in: ids("Item") } }, select: { id: true, code: true, name: true } }),
    db.sale.findMany({ where: { id: { in: ids("Sale") } }, select: { id: true, lines: { select: { item: { select: { code: true, name: true } } } } } }),
    db.listing.findMany({ where: { id: { in: ids("Listing") } }, select: { id: true, item: { select: { code: true, name: true } }, channel: { select: { name: true } } } }),
    db.lot.findMany({ where: { id: { in: ids("Lot") } }, select: { id: true, code: true, name: true } }),
    db.channel.findMany({ select: { id: true, name: true } }),
    db.supplier.findMany({ where: { id: { in: ids("Supplier") } }, select: { id: true, name: true } }),
    db.genre.findMany({ where: { id: { in: ids("Genre") } }, select: { id: true, name: true } }),
    db.saleAdjustment.findMany({ where: { id: { in: ids("SaleAdjustment") } }, select: { id: true, sale: { select: { lines: { select: { item: { select: { code: true, name: true } } } } } } } }),
    db.monthlyReport.findMany({ where: { id: { in: ids("MonthlyReport") } }, select: { id: true, month: true } }),
  ]);
  const chName = new Map(channels.map((c) => [c.id, c.name]));
  const codesOf = (ls: { item: { code: string; name: string } }[]) => ({ code: ls.map((l) => l.item.code).join("・"), name: ls.length === 1 ? ls[0].item.name : `${ls.length}点` });
  const what = new Map<string, { code: string; name: string }>();
  for (const x of items) what.set(`Item:${x.id}`, { code: x.code, name: x.name });
  for (const x of sales) what.set(`Sale:${x.id}`, codesOf(x.lines));
  for (const x of listings) what.set(`Listing:${x.id}`, { code: x.item.code, name: `${x.item.name}（${x.channel.name}）` });
  for (const x of lots) what.set(`Lot:${x.id}`, { code: `山${x.code}`, name: x.name });
  for (const x of channels) what.set(`Channel:${x.id}`, { code: "", name: `販路 ${x.name}` });
  for (const x of suppliers) what.set(`Supplier:${x.id}`, { code: "", name: `仕入先 ${x.name}` });
  for (const x of genres) what.set(`Genre:${x.id}`, { code: "", name: `ジャンル ${x.name}` });
  for (const x of adjs) what.set(`SaleAdjustment:${x.id}`, codesOf(x.sale.lines));
  for (const x of reports) what.set(`MonthlyReport:${x.id}`, { code: "", name: `${x.month} の月次レポート` });

  const show = (k: string, v: unknown): string => {
    if (v == null || v === "") return "なし";
    if (k === "channelId") return chName.get(Number(v)) ?? String(v);
    if (k === "status") return STATUS_LABEL[String(v)] ?? String(v);
    if (k === "state") return LISTING[String(v)] ?? String(v);
    if (k === "soldAt" || k === "purchasedAt") { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : fmtDate(d); }
    if (v === true || v === "true") return "はい";
    if (v === false || v === "false") return "いいえ";
    if (YEN.has(k) && !Number.isNaN(Number(v))) return "¥" + Number(v).toLocaleString("ja-JP");
    if (CENTS.has(k) && !Number.isNaN(Number(v))) return (Number(v) / 100).toFixed(2);
    if (Array.isArray(v)) return v.join("・");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  const parse = (s: string | null): Record<string, unknown> => { try { const o = s ? JSON.parse(s) : {}; return o && typeof o === "object" ? o : {}; } catch { return {}; } };

  const rows: (HistRow & { at: Date; note: string })[] = logs.map((l) => {
    const b = parse(l.before), a = parse(l.after);
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => k !== "itemId");
    const changes = keys
      .map((k) => ({ field: FIELD[k] ?? k, before: k in b ? show(k, b[k]) : "", after: k in a ? show(k, a[k]) : "" }))
      .filter((c) => c.before !== c.after);
    const month = (a.month ?? b.month) as string | undefined;
    const w = what.get(`${l.table}:${l.recordId}`)
      ?? (l.table === "SalesTarget" ? { code: "", name: `${month ?? ""} の目標` } : l.table === "SlipFormat" ? { code: "", name: "伝票の読み取り方" } : { code: "", name: "" });
    return { at: l.at, note: l.note ?? ACTION[l.action] ?? l.action, code: w.code, name: w.name, action: ACTION[l.action] ?? l.action, table: l.table, changes };
  });

  // 同じ説明で、前の行から5秒以内なら同じ操作としてまとめる
  const groups: HistGroup[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    const last = g?.rows[g.rows.length - 1] as (typeof rows)[number] | undefined;
    if (g && g.note === r.note && last && Math.abs(last.at.getTime() - r.at.getTime()) < 5000) { g.rows.push(r); continue; }
    groups.push({ key: groups.length, at: fmtDate(r.at, true), note: r.note, rows: [r] });
  }
  // 画面に渡すのは文字だけ（Date は外す）
  const plain = groups.map((g) => ({ ...g, rows: g.rows.map(({ code, name, action, table, changes }) => ({ code, name, action, table, changes })) }));

  return <HistoryView groups={plain} total={logs.length} limited={logs.length >= LIMIT} q={sp.q ?? ""} />;
}
