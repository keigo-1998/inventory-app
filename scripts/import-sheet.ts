// スプレッドシート（在庫管理①・縦積在庫管理②）を、アプリのデータベースに取り込む
// 使い方（本物のデータ用のデータベース prisma/real.db に入れる）:
//   python3 -I scripts/sheet_to_json.py "<Excelのファイル>" import/sheet.json
//   npm run import:sheet          （中身を全部消してから入れ直す）
// 決まり（2026/11/16 栗田さんと決めたこと。docs/data-design.md「スプレッドシートからの移行」）:
// - 原価はシートの数字のまま（山の枝番は手で入れた原価＝manual。割り振り直しで変えない）
// - 山の「-0」と枝番の両方に同じ原価があるときは、二重なので -0 を0円にする
// - 「売却済み」で売上がない行（山を締めた・合わせ売りなど）は「売り切り」
// - 売却日がない売却済みは、仕入日を仮の売却日にする（一覧に出す）
// - 仕入日がない行は、すぐ上の行の仕入日を仮に使う（一覧に出す）
// - 管理番号が重なっていたら、2つ目の番号を変える（一覧に出す）
// - 仕入先：「エコロク」→「株式会社エコロク」、「-」「ー」空 → 仕入先なし
// - 在庫管理①の「個数」は、原価が1行の合計なので、個数1として取り込み、メモに残す
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { GENRES, CHANNELS, SUPPLIERS } from "../prisma/masters";

const db = new PrismaClient();
type Raw = { row: number; cells: string[] };
const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) ?? "import/sheet.json";
const reset = args.includes("--reset");

const num = (v: unknown): number | null => {
  const s = String(v ?? "").normalize("NFKC").replace(/[¥,円\s]/g, "");
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};
const yen = (v: unknown) => Math.round(num(v) ?? 0);
const cents = (v: unknown) => { const n = num(v); return n == null ? null : Math.round(n * 100); };
/** Excel の日付（1900年からの日数）→ 日本時間のその日 */
const xdate = (v: unknown): Date | null => {
  const n = num(v);
  if (n == null || n < 30000 || n > 60000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00+09:00`);
};
const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "/");
const blank = (s: string) => ["", "-", "ー", "－", "―"].includes(s.trim());
const supplierOf = (s: string) => { const t = s.trim(); if (blank(t)) return null; return t === "エコロク" ? "株式会社エコロク" : t; };
const genreOf = (s: string) => (blank(s) ? null : s.trim());
const channelOf = (s: string) => { const t = s.trim(); if (blank(t)) return null; return /^ebay$/i.test(t) ? "eBay" : t; };

type Row = {
  sheet: "①" | "②"; row: number; code: string; name: string; genre: string | null; supplier: string | null;
  date: Date; dateGuessed: boolean; cost: number; qty: number; sheetQty: number; channel: string | null; listed: boolean; sold: boolean;
  price: number; priceF: number | null; ship: number; shipF: number | null; real: number; fee: number; feeF: number | null;
  profit: number | null; soldAt: Date | null; tentative: boolean; exp: number | null; note: string[];
};

async function main() {
  const json = JSON.parse(fs.readFileSync(src, "utf8")) as Record<string, Raw[]>;
  const report: string[] = [];
  const say = (s: string) => report.push(s);

  if ((await db.item.count()) > 0) {
    if (!reset) throw new Error("データベースにもう商品があります。全部消して入れ直すときは --reset を付けてください");
    for (const t of ["ChangeLog", "SaleAdjustment", "SaleLine", "Sale", "Listing", "Item", "Lot", "MonthlyReport", "SalesTarget", "SlipFormat", "Expense", "Channel", "Supplier", "Genre"]) {
      await db.$executeRawUnsafe(`DELETE FROM "${t}"`);
    }
  }

  // ---- 行を読む ----
  const rows: Row[] = [];
  let lastDate: Date | null = null;
  const guessed: string[] = [];
  for (const r of json["在庫管理①"].slice(2)) {
    const c = [...r.cells, ...Array(34).fill("")];
    if (!c[1].trim() && !c[2].trim()) continue;
    let date = xdate(c[0]);
    const dateGuessed = !date;
    if (!date) date = lastDate ?? new Date("2026-01-01T00:00:00+09:00");
    lastDate = date;
    const sheetQty = Math.max(1, Math.round(num(c[6]) ?? 1));
    rows.push({
      sheet: "①", row: r.row, code: c[1].trim(), name: c[2].trim() || "（名前なし）", genre: genreOf(c[3]), supplier: supplierOf(c[4]),
      date, dateGuessed, cost: yen(c[5]), qty: 1, sheetQty, channel: channelOf(c[7]), listed: c[17] === "1", sold: c[18] === "1",
      price: yen(c[9]), priceF: cents(c[8]), ship: yen(c[11]), shipF: cents(c[10]), real: yen(c[12]), fee: yen(c[14]), feeF: cents(c[13]),
      profit: num(c[15]), soldAt: xdate(c[16]), tentative: c[19] === "1", exp: num(c[33]) == null ? null : yen(c[33]),
      note: sheetQty > 1 ? [`シートの個数: ${sheetQty}（原価は合計）`] : [],
    });
    if (dateGuessed) guessed.push(`${c[1].trim()}（${r.row}行目）`);
  }
  lastDate = null;
  for (const r of json["縦積在庫管理②"].slice(2)) {
    const c = [...r.cells, ...Array(16).fill("")];
    if (!c[1].trim()) continue;
    let date = xdate(c[0]);
    const dateGuessed = !date;
    if (!date) date = lastDate ?? new Date("2026-01-01T00:00:00+09:00");
    lastDate = date;
    const left = Math.max(0, Math.round(num(c[6]) ?? 0));
    rows.push({
      sheet: "②", row: r.row, code: c[1].trim(), name: c[2].trim() || "（名前なし）", genre: genreOf(c[3]), supplier: supplierOf(c[4]),
      date, dateGuessed, cost: yen(c[5]), qty: Math.max(1, left), sheetQty: left, channel: channelOf(c[8]), listed: c[10] === "1", sold: c[11] === "1" || left === 0,
      price: 0, priceF: null, ship: 0, shipF: null, real: 0, fee: 0, feeF: null, profit: null, soldAt: null, tentative: false,
      exp: num(c[9]) == null ? null : yen(c[9]), note: ["縦積在庫（シートの在庫残を個数にした。これまでの販売の記録はなし）"],
    });
    if (dateGuessed) guessed.push(`${c[1].trim()}（縦積②の${r.row}行目）`);
  }

  // ---- 管理番号の重なり ----
  const lotRe = /^(\d+)-(\d+)$/;
  const maxBranch = new Map<string, number>();
  for (const r of rows) { const m = lotRe.exec(r.code); if (m) maxBranch.set(m[1], Math.max(maxBranch.get(m[1]) ?? 0, Number(m[2]))); }
  const seen = new Set<string>();
  const renamed: string[] = [];
  for (const r of rows) {
    if (!r.code) { r.code = `NOCODE-${r.row}`; renamed.push(`${r.row}行目「${r.name}」→ ${r.code}（管理番号がなかった）`); }
    if (!seen.has(r.code)) { seen.add(r.code); continue; }
    const m = lotRe.exec(r.code);
    let next: string;
    if (m) { const n = (maxBranch.get(m[1]) ?? 0) + 1; maxBranch.set(m[1], n); next = `${m[1]}-${n}`; }
    else { next = `${r.code}b`; while (seen.has(next)) next += "b"; }
    renamed.push(`${r.code}（${r.row}行目「${r.name}」）→ ${next}`);
    r.note.push(`シートでは ${r.code}（番号が重なっていたので変えた）`);
    r.code = next;
    seen.add(next);
  }

  // ---- 山（-0 と枝番） ----
  const lots = new Map<string, { head: Row | null; branches: Row[] }>();
  for (const r of rows) {
    const m = lotRe.exec(r.code);
    if (!m) continue;
    const g = lots.get(m[1]) ?? { head: null, branches: [] };
    if (m[2] === "0") g.head = r; else g.branches.push(r);
    lots.set(m[1], g);
  }
  const headFix: string[] = [], mismatch: string[] = [], noHead: string[] = [];
  for (const [code, g] of lots) {
    const bsum = g.branches.reduce((a, b) => a + b.cost, 0);
    if (g.head && g.head.cost > 0 && bsum > 0) {
      if (Math.abs(g.head.cost - bsum) <= 10) {
        headFix.push(`${code}-0：${g.head.cost.toLocaleString()}円 → 0円（枝番の原価の合計 ${bsum.toLocaleString()}円と二重）`);
        g.head.note.push(`シートの原価 ${g.head.cost}円（枝番と二重なので0円にした）`);
        g.head.cost = 0;
      } else mismatch.push(`${code}：-0 ${g.head.cost.toLocaleString()}円／枝番の合計 ${bsum.toLocaleString()}円（シートのまま）`);
    }
    if (!g.head) noHead.push(code);
  }

  // ---- 選択肢の一覧 ----
  const genreId = new Map<string, number>(), supplierId = new Map<string, number>(), channel = new Map<string, { id: number; currency: string }>();
  for (const [i, name] of GENRES.entries()) genreId.set(name, (await db.genre.create({ data: { name, sortOrder: i } })).id);
  for (const [i, c] of CHANNELS.entries()) { const x = await db.channel.create({ data: { ...c, sortOrder: i } }); channel.set(x.name, { id: x.id, currency: x.currency }); }
  for (const name of SUPPLIERS) supplierId.set(name, (await db.supplier.create({ data: { name } })).id);
  const addedGenres: string[] = [], addedSuppliers: string[] = [];
  for (const r of rows) {
    if (r.genre && !genreId.has(r.genre)) { genreId.set(r.genre, (await db.genre.create({ data: { name: r.genre, sortOrder: 100 + genreId.size } })).id); addedGenres.push(r.genre); }
    if (r.supplier && !supplierId.has(r.supplier)) { supplierId.set(r.supplier, (await db.supplier.create({ data: { name: r.supplier } })).id); addedSuppliers.push(r.supplier); }
  }

  // ---- 山を作る ----
  const lotId = new Map<string, number>();
  for (const [code, g] of lots) {
    const top = g.head ?? g.branches[0];
    const lot = await db.lot.create({
      data: {
        code, name: top.name, totalCost: (g.head?.cost ?? 0) + g.branches.reduce((a, b) => a + b.cost, 0), purchasedAt: top.date,
        supplierId: top.supplier ? supplierId.get(top.supplier) : null, genreId: top.genre ? genreId.get(top.genre) : null,
      },
    });
    lotId.set(code, lot.id);
    if (!g.head) {
      // -0 がない山は、残りのない -0 を作る（アプリでは山の行が必要なため）
      const all = g.branches.every((b) => b.sold);
      const head: Row = { ...top, sheet: "②", code: `${code}-0`, name: `${top.name}（山の残り）`, cost: 0, sold: all, channel: null, listed: false, price: 0, priceF: null, ship: 0, shipF: null, real: 0, fee: 0, feeF: null, profit: null, soldAt: null, tentative: false, exp: null, note: ["シートに -0 の行がなかったので作った"] };
      rows.push(head);
      g.head = head;
    }
  }

  // ---- 商品と販売 ----
  const soldGuess: string[] = [], closed: string[] = [], unknownCh = new Set<string>(), headSale: string[] = [];
  const diffs: string[] = [];
  let appProfit = 0, sheetProfit = 0;
  const noteOf = (r: Row) => (r.note.length ? r.note.join(" / ") : null);
  for (const r of rows) {
    const m = lotRe.exec(r.code);
    const ch = r.channel ? channel.get(r.channel) : undefined;
    if (r.channel && !ch && !["廃棄", "備品", "合せ売り"].includes(r.channel)) unknownCh.add(r.channel);
    const item = await db.item.create({
      data: {
        code: r.code, name: r.name, genreId: r.genre ? genreId.get(r.genre) : null, supplierId: r.supplier ? supplierId.get(r.supplier) : null,
        purchasedAt: r.date, unitCost: r.cost, quantity: r.qty, expectedPrice: r.exp, note: noteOf(r),
        lotId: m ? lotId.get(m[1]) : null, lotCostMode: m && m[2] !== "0" ? "manual" : null, status: "stock",
      },
    });
    if (!r.sold) {
      if (r.listed && ch) {
        await db.listing.create({ data: { itemId: item.id, channelId: ch.id, startedAt: r.date } });
        await db.item.update({ where: { id: item.id }, data: { status: "list" } });
      }
      continue;
    }
    // 山の -0 は、山かどうかを分かるための行で、売り買いはしない（2026/11/16 決定）
    // → 販売の記録は作らない。シートで売却済みなら「売り切り（山の残りなし）」、売却日もなし
    if (m && m[2] === "0") {
      await db.item.update({ where: { id: item.id }, data: { status: "closed", note: [noteOf(r), "山の残りなし（シートで売却済み）"].filter(Boolean).join(" / ") } });
      if (r.sheet === "①" && (r.price || r.real || r.fee || (r.profit ?? 0) !== 0)) headSale.push(`${r.code} ${r.name}：シートの売値 ${r.price}円・実送料 ${r.real}円・粗利 ${Math.round(r.profit ?? 0)}円 → 取り込まない（-0は売り買いしない）`);
      if (r.sheet === "①") sheetProfit += r.profit ?? 0;
      continue;
    }
    // 売却済み
    let soldAt = r.soldAt;
    if (!soldAt) { soldAt = r.date; if (r.sheet === "①") soldGuess.push(`${r.code} ${r.name}（${r.channel ?? "売り先なし"}・売値 ${r.price.toLocaleString()}円・シートの粗利 ${Math.round(r.profit ?? 0).toLocaleString()}円）→ 仮に仕入日 ${ymd(r.date)}`); }
    const kind = r.channel === "廃棄" ? "disposed" : r.channel === "備品" ? "fixture" : ch && (r.price || r.priceF || r.fee || r.real) ? "sale" : "closed";
    if (kind === "closed" && r.sheet === "①") closed.push(`${r.code} ${r.name}（${r.channel ?? "売り先なし"}・シートの粗利 ${Math.round(r.profit ?? 0)}円）`);
    const fx = ch && ch.currency !== "JPY";
    const sale = await db.sale.create({
      data: {
        soldAt, kind, channelId: kind === "sale" ? ch!.id : null, currency: kind === "sale" ? ch!.currency : "JPY",
        priceForeign: fx ? r.priceF : null, shippingForeign: fx ? r.shipF : null, feeForeign: fx ? r.feeF : null,
        priceJpy: kind === "sale" ? r.price : 0, shippingFeeJpy: kind === "sale" ? r.ship : 0, feeJpy: kind === "sale" ? r.fee : 0, actualShippingJpy: kind === "sale" ? r.real : 0,
        shippingTentative: kind === "sale" && r.tentative, fxRate: fx && r.priceF ? r.price / (r.priceF / 100) : null, fxRateFinal: true,
        note: `スプレッドシートから取り込み（${r.sheet}の${r.row}行目）`,
        lines: { create: [{ itemId: item.id, quantity: r.qty, costJpy: r.cost * r.qty, amountJpy: kind === "sale" ? r.price : 0 }] },
      },
    });
    await db.item.update({ where: { id: item.id }, data: { status: kind === "sale" ? "sold" : kind } });
    if (kind === "sale") await db.listing.create({ data: { itemId: item.id, channelId: ch!.id, state: "sold", startedAt: r.date, endedAt: soldAt, endedBySaleId: sale.id, createdBySale: true } });
    // 粗利の突き合わせ（シートの「粗利」の列と比べる）
    const app = (kind === "sale" ? r.price + r.ship - r.real - r.fee - r.cost : kind === "fixture" ? 0 : -r.cost) + 0; // + 0 で「-0」をなくす
    if (r.sheet === "①") {
      appProfit += app;
      sheetProfit += r.profit ?? 0;
      const sp = Math.round(r.profit ?? 0);
      if (Math.abs(app - sp) > 1) diffs.push(`${r.code} ${r.name.slice(0, 24)}（${r.channel ?? "-"}）：シート ${sp.toLocaleString()}円／アプリ ${app.toLocaleString()}円（差 ${(app - sp).toLocaleString()}円）${r.note.length ? "　※" + r.note.join("・") : ""}`);
    }
  }
  await db.changeLog.create({ data: { table: "Item", recordId: 0, action: "create", note: `スプレッドシートから取り込み（${rows.length}件）` } });

  // ---- 結果 ----
  const items = await db.item.count(), sales = await db.sale.count({ where: { kind: "sale" } });
  say(`# スプレッドシートからの取り込み結果\n\n取り込んだファイル: ${src}\n\n- 商品 ${items}件（山 ${lots.size}個）、販売 ${sales}件\n- 粗利の合計（売却済み・在庫管理①）: シート ${Math.round(sheetProfit).toLocaleString()}円 ／ アプリ ${appProfit.toLocaleString()}円（差 ${(appProfit - Math.round(sheetProfit)).toLocaleString()}円）\n`);
  const sec = (title: string, list: string[]) => say(`## ${title}（${list.length}件）\n${list.length ? list.map((x) => `- ${x}`).join("\n") : "なし"}\n`);
  sec("粗利がシートと違う行", diffs);
  sec("山の -0 の原価を0円にした（枝番と二重）", headFix);
  sec("山の -0 と枝番の原価が合わない（シートのまま）", mismatch);
  sec("-0 の行がなかったので作った山", noHead);
  sec("管理番号を変えた行", renamed);
  sec("売却日がないので、仕入日を仮の売却日にした", soldGuess);
  sec("仕入日がないので、すぐ上の行の仕入日を仮に使った", guessed);
  sec("売り切り（売却済みだが売上がない・山の -0 以外）", closed);
  sec("山の -0 で、シートに売値・送料・粗利が入っていた行（取り込まない）", headSale);
  sec("一覧に追加したジャンル", [...new Set(addedGenres)]);
  sec("一覧に追加した仕入先", [...new Set(addedSuppliers)]);
  sec("知らない売り先（販売として取り込めなかった）", [...unknownCh]);
  fs.mkdirSync("import", { recursive: true });
  fs.writeFileSync("import/report.md", report.join("\n"));
  console.log(report.slice(0, 1).join("\n"));
  console.log(`くわしい結果: import/report.md`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
