// 伝票のPDFを読む（文字が入っているPDFだけ。スキャンや写真のPDFは読めない）
// いまはトレファクの「オークション精算一覧書」の形に合わせている（CSVと同じ中身）
// - 文字の位置（横 x・縦 y）から行と列を組み立てる
// - 「請求明細」の見出し（商品名・数量…小計）の下の行を、商品として読む。原価は「小計」
// - 商品名が2〜3行に分かれていても、つなげて1つにする
import type { SlipResult, SheetLine } from "@/lib/slip";

export type PdfText = { str: string; x: number; y: number; w: number; page: number };
type Row = { y: number; page: number; items: PdfText[]; text: string };

const NUM = /^-?[\d,]+$/;
const toNum = (s: string) => Number(s.replace(/,/g, ""));

/** 同じ高さの文字を1行にまとめる（ページごと、上から順） */
function toRows(items: PdfText[]): Row[] {
  const rows: Row[] = [];
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2) last.items.push(it);
    else rows.push({ y: it.y, page: it.page, items: [it], text: "" });
  }
  for (const r of rows) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map((i) => i.str).join("").replace(/\s+/g, ""); }
  return rows;
}

/** 文字をつなげる。すき間が空いているところには空白を入れる */
function join(items: PdfText[]) {
  let out = "", end: number | null = null;
  for (const it of items) {
    if (end != null && it.x - end > 2) out += " ";
    out += it.str;
    end = it.x + it.w;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** 2〜3行に分かれた商品名をつなぐ。日本語どうしは空白なし（「ノー」＋「ト」→「ノート」）、英数字の間だけ空白を入れる */
function joinLines(parts: string[]) {
  return parts.filter(Boolean).reduce((acc, p) => {
    if (!acc) return p;
    const a = acc.slice(-1), b = p[0];
    const ascii = (c: string) => /[\x21-\x7e]/.test(c);
    const space = (ascii(a) || ascii(b)) && !/[/\-]/.test(a);
    return acc + (space ? " " : "") + p;
  }, "").replace(/\s+/g, " ").trim();
}

/** 見出しの行で、ある言葉が始まる横の位置 */
function labelX(r: Row, label: string): number | null {
  let acc = "";
  const starts: number[] = [];
  for (const it of r.items) for (const ch of it.str.replace(/\s/g, "")) { acc += ch; starts.push(it.x); }
  const i = acc.indexOf(label);
  return i < 0 ? null : starts[i];
}

export function readPdfItems(items: PdfText[]): SlipResult | null {
  const rows = toRows(items);
  const hi = rows.findIndex((r) => r.text.includes("商品名") && r.text.includes("小計"));
  if (hi < 0) return null;
  const head = rows[hi];
  const nameX = labelX(head, "商品名")!, qtyX = labelX(head, "数量") ?? labelX(head, "個数");
  if (qtyX == null) return null;

  const lines: SheetLine[] = [];
  let cur: { name: string[]; qty: string; cost: string } | null = null;
  const flush = () => { if (cur) lines.push(["", "", joinLines(cur.name), "", "", "", cur.cost, cur.qty || "1", ""]); cur = null; };
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (/支払明細|請求金額|商品合計/.test(r.text)) break; // 請求明細の終わり
    if (r.text.includes("商品名") && r.text.includes("小計")) continue; // 次のページの見出し
    const left = r.items.filter((t) => t.x < nameX - 2);
    const nameParts = r.items.filter((t) => t.x >= nameX - 2 && t.x < qtyX - 4);
    const nums = r.items.filter((t) => t.x >= qtyX - 20 && NUM.test(t.str.trim()));
    if (left.length && nums.length >= 2) {
      // 新しい商品の行（左にレーン・商品ID、右に 数量…小計）
      flush();
      cur = { name: [join(nameParts)], qty: nums[0].str.trim(), cost: String(toNum(nums[nums.length - 1].str.trim())) };
    } else if (cur && !left.length && nameParts.length) {
      cur.name.push(join(nameParts)); // 商品名の続きの行
    }
  }
  flush();
  if (!lines.length) return null;

  const valueAfter = (label: string) => {
    const r = rows.find((x) => x.text.startsWith(label));
    if (!r) return "";
    const lx = labelX(r, label)!;
    return join(r.items.filter((t) => t.x > lx + 20)).replace(/^[：:\s]+/, "").trim();
  };
  const date = (valueAfter("開催日").match(/\d{4}\/\d{1,2}\/\d{1,2}/) || [""])[0];
  const hall = valueAfter("会場");
  const fee = rows.find((r) => r.text.startsWith("入場料"));
  const feeAmt = fee ? fee.items.filter((t) => NUM.test(t.str.trim())).pop()?.str.trim() : null;
  return {
    lines, supplier: hall ? `オークション（${hall}）` : "", date,
    note: feeAmt ? `入場料 ¥${toNum(feeAmt).toLocaleString()} は商品の原価に入れません（経費はfreeeで管理）` : "",
  };
}

/** ブラウザで PDF のファイルから文字と位置を取り出す */
export async function pdfTextItems(buf: ArrayBuffer): Promise<PdfText[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: PdfText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    for (const it of c.items) if ("str" in it) out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
  }
  return out;
}
