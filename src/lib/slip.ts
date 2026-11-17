// 伝票CSVを読む（画面とテストで同じものを使う）
// - 決まった形（いま使っているオークションの伝票）は、そのまま読める
// - 初めての形は、列を選んでもらい（SlipFormat）、次からはその設定で読む

export type SlipFormat = {
  id?: number; name: string; signature: string;
  nameCol: number; costCols: number[]; qtyCol: number | null; expCol: number | null; dateCol: number | null; supplier: string | null;
};
/** 表に入れる1行: [種類, 管理番号, 商品名, ジャンル, 仕入先, 仕入日, 原価, 個数, 予想売価] */
export type SheetLine = string[];
export type SlipResult = { lines: SheetLine[]; supplier: string; date: string; note: string };

export function parseCSV(text: string): string[][] {
  // 改行を含むマス（"…\n…"）にも対応する
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export const signatureOf = (row: string[]) => row.map((c) => c.trim()).join("|").replace(/\|+$/, "");
const filled = (r: string[]) => r.filter((c) => c.trim() !== "").length;
const num = (s: string) => { const v = Number(String(s ?? "").normalize("NFKC").replace(/[¥,円\s]/g, "")); return Number.isFinite(v) ? v : NaN; };

/** 見出しの行の候補（文字が3つ以上入っている最初の行） */
export const guessHeader = (rows: string[][]) => Math.max(0, rows.findIndex((r) => filled(r) >= 3 && r.some((c) => /[^\d\s,.¥円-]/.test(c))));

/** いま使っているオークションの伝票（「請求明細」の下に「商品名」「小計」の見出し） */
function builtIn(rows: string[][]): SlipResult | null {
  const get = (k: string) => (rows.find((r) => r[0] === k) || [])[1] || "";
  const hi = rows.findIndex((r, i) => r.includes("商品名") && r.includes("小計") && (rows[i - 1] || [])[0] === "請求明細");
  if (hi < 0) return null;
  const H = rows[hi], ix = (k: string) => H.indexOf(k), lines: SheetLine[] = [];
  // 原価は「小計」（単価＋税＋落札手数料＋税）。オークションの商品IDは取り込まない
  for (let i = hi + 1; i < rows.length && rows[i].length > 1; i++) { const r = rows[i]; lines.push(["", "", r[ix("商品名")], "", "", "", r[ix("小計")], r[ix("数量")], ""]); }
  const hall = get("会場");
  const extra = rows.find((r) => r[0] === "入場料");
  return {
    lines, supplier: hall ? `オークション（${hall}）` : "", date: get("開催日"),
    note: extra ? `入場料 ¥${(+extra[3]).toLocaleString()} は商品の原価に入れません（経費はfreeeで管理）` : "",
  };
}

/** 覚えた形式で読む */
export function applyFormat(rows: string[][], f: SlipFormat, hi?: number): SlipResult | null {
  const h = hi ?? rows.findIndex((r) => signatureOf(r) === f.signature);
  if (h < 0) return null;
  const lines: SheetLine[] = [];
  let date = "";
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[f.nameCol] ?? "").trim();
    if (!name) { if (filled(r) === 0 && lines.length) break; continue; } // 空の行で終わり
    const costs = f.costCols.map((c) => num(r[c] ?? ""));
    const cost = costs.some((v) => Number.isNaN(v)) ? f.costCols.map((c) => r[c] ?? "").join("+") : String(costs.reduce((a, b) => a + b, 0));
    const pick = (c: number | null) => (c == null ? "" : (r[c] ?? "").trim());
    if (!date && f.dateCol != null) date = pick(f.dateCol);
    lines.push(["", "", name, "", "", "", cost, pick(f.qtyCol) || "1", pick(f.expCol)]);
  }
  // 日付の列がないときは、見出しより上の「〇〇日, 2026/11/14」のような行から拾う
  if (!date) for (const r of rows.slice(0, h)) { const i = r.findIndex((c) => /日/.test(c)); const v = i >= 0 ? (r[i + 1] ?? "").trim() : ""; if (/^\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}$/.test(v)) { date = v; break; } }
  return { lines, supplier: f.supplier ?? "", date, note: "" };
}

/** 伝票を読む。読めない形なら null（列を選んでもらう） */
export function readSlip(rows: string[][], formats: SlipFormat[]): (SlipResult & { format: string | null }) | null {
  const b = builtIn(rows);
  if (b) return { ...b, format: null };
  for (const f of formats) {
    const r = applyFormat(rows, f);
    if (r) return { ...r, format: f.name };
  }
  return null;
}
