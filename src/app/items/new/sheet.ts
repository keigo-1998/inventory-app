// スプレッドシート風の登録の表（パソコン）。画面イメージ docs/mockup/index.html の「まとめて登録」と同じ動き。
// ドラッグで選ぶ・⌘C/⌘V・右下の■で下にコピー・⌘D・Delete・伝票CSVの取り込み・確認（赤で知らせる）
import { guessGenre } from "@/lib/genre-guess";
import { padNo } from "@/lib/lot";
import { esc } from "@/lib/toast";
import type { RegisterRow } from "@/lib/register-actions";

export type SheetOpts = {
  existing: Set<string>;
  nextNo: number;
  genres: string[];
  /** 登録ボタンを押したとき。成功したら true を返す（表を空にする） */
  onRegister: (rows: RegisterRow[]) => Promise<boolean>;
};

const COLS: [string, number][] = [["種類", 64], ["管理番号", 96], ["商品名", 300], ["ジャンル", 90], ["仕入先", 150], ["仕入日", 100], ["原価", 90], ["個数", 54], ["予想売価", 90]];
const GENRE_COL = 3;
const NC = COLS.length;
const NUMCOL = new Set([6, 7, 8]);
// スプレッドシートの見出しの言い方の違い
const ALIAS: Record<string, string> = { "商品名 メーカー/ブランド": "商品名", f: "仕入日", 在庫残: "個数", 予想売上: "予想売価", 数量: "個数", 小計: "原価" };
const YAMA_WORDS = /まとめ|山売り|ロット|大量|詰め合わせ|\d+点/;
const DATE_RE = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/;
/** 2026/11/04 の形で、しかも本当にある日付か（2026/02/31 などはだめ） */
const isDate = (s: string) => {
  const m = DATE_RE.exec(s.normalize("NFKC").trim());
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

export const num = (s: unknown) => {
  const v = String(s ?? "").normalize("NFKC").replace(/[¥,円\s]/g, "");
  return v === "" ? null : Number.isNaN(+v) ? NaN : +v;
};
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "");

export function initSheet(root: HTMLElement, opts: SheetOpts) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const sheet = $<HTMLTableElement>("sheet");
  const GENRES = opts.genres;
  let grid: string[][] = [];
  const autoCells = new Set<string>();
  let sel = { r1: 0, c1: 2, r2: 0, c2: 2 };
  let dragging = false;
  let filling: { to: number } | null = null;
  let editing: { r: number; c: number; inp: HTMLInputElement; dd?: HTMLDivElement } | null = null;
  let busy = false;

  const blank = () => Array(NC).fill("") as string[];
  const ensureRows = (n: number) => { while (grid.length < n) grid.push(blank()); };
  const box = () => ({ top: Math.min(sel.r1, sel.r2), bot: Math.max(sel.r1, sel.r2), left: Math.min(sel.c1, sel.c2), right: Math.max(sel.c1, sel.c2) });
  const cellEl = (r: number, c: number) => sheet.querySelector<HTMLTableCellElement>(`td[data-r="${r}"][data-c="${c}"]`);
  const fmt = (v: string, c: number) => {
    if (c === 0) return v === "山" ? '<span class="tag t-yama">山</span>' : v ? '<span class="tag t-stock">単品</span>' : "";
    if (c === GENRE_COL) return `<span class="ddv">${esc(v)}</span><span class="dd" title="一覧から選ぶ">▾</span>`;
    if (!NUMCOL.has(c)) return esc(v);
    const n = num(v);
    return n == null || Number.isNaN(n) ? esc(v) : n.toLocaleString();
  };
  const hasContent = (r: number) => [2, 3, 6, 7, 8].some((c) => String(grid[r][c]).trim() !== "") || (!autoCells.has(r + ":1") && !!grid[r][1]);

  // 種類・管理番号・ジャンル・仕入先・仕入日・個数を自動で入れる（自動で入れたマスは青い文字）
  function applyAuto() {
    autoCells.forEach((k) => { const [r, c] = k.split(":").map(Number); if (grid[r]) grid[r][c] = ""; });
    autoCells.clear();
    const supplier = $<HTMLInputElement>("slipSupplier").value.trim();
    const date = $<HTMLInputElement>("slipDate").value.trim();
    let n = opts.nextNo;
    grid.forEach((row, r) => {
      if (!hasContent(r)) return;
      if (!row[0]) { row[0] = YAMA_WORDS.test(row[2]) ? "山" : "単品"; autoCells.add(r + ":0"); }
      // 番号は、自分で入れた行は飛ばして、空いている行にだけ続きの番号を入れる
      if (!row[1]) {
        while (opts.existing.has(padNo(n)) || opts.existing.has(padNo(n) + "-0") || grid.some((x) => x[1] === padNo(n) || x[1] === padNo(n) + "-0")) n++;
        row[1] = row[0] === "山" ? padNo(n) + "-0" : padNo(n);
        autoCells.add(r + ":1");
        n++;
      }
      if (!row[3]) { const g = guessGenre(row[2], GENRES); if (g) { row[3] = g; autoCells.add(r + ":3"); } }
      if (!row[4] && supplier) { row[4] = supplier; autoCells.add(r + ":4"); }
      if (!row[5] && date) { row[5] = date; autoCells.add(r + ":5"); }
      if (!row[7]) { row[7] = "1"; autoCells.add(r + ":7"); }
    });
  }
  function draw() {
    applyAuto();
    sheet.innerHTML =
      `<thead><tr><th class="rn"></th>${COLS.map(([c, w], i) => `<th style="min-width:${w}px" class="${NUMCOL.has(i) ? "n" : ""}">${c}</th>`).join("")}</tr></thead><tbody>` +
      grid.map((r, ri) => `<tr><td class="rn">${ri + 1}</td>${r.map((v, ci) => `<td data-r="${ri}" data-c="${ci}" class="cell${NUMCOL.has(ci) ? " n" : ""}${ci === 0 ? " kind" : ""}">${fmt(v, ci)}</td>`).join("")}</tr>`).join("") +
      "</tbody>";
    paintSel();
    recalc();
  }
  function paintSel() {
    sheet.querySelectorAll("td.cell").forEach((td) => td.classList.remove("sel", "anchor"));
    sheet.querySelectorAll(".handle").forEach((h) => h.remove());
    const b = box();
    const fb = filling ? { top: b.top, bot: Math.max(b.bot, filling.to), left: b.left, right: b.right } : b;
    for (let r = fb.top; r <= fb.bot; r++) for (let c = fb.left; c <= fb.right; c++) cellEl(r, c)?.classList.add("sel");
    cellEl(sel.r1, sel.c1)?.classList.add("anchor");
    const br = cellEl(fb.bot, fb.right);
    if (br && !editing) {
      const h = document.createElement("div");
      h.className = "handle";
      h.title = "下にドラッグしてコピー";
      br.appendChild(h);
      h.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); filling = { to: box().bot }; });
    }
  }
  function setCell(r: number, c: number, v: unknown) { ensureRows(r + 1); grid[r][c] = String(v ?? "").trim(); autoCells.delete(r + ":" + c); }

  // ---- マウス操作 ----
  sheet.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    const td = t.closest<HTMLTableCellElement>("td.cell");
    if (!td || t.classList.contains("handle")) return;
    if (editing && td.contains(editing.inp)) return;
    commitEdit();
    const r = +td.dataset.r!, c = +td.dataset.c!;
    if (t.classList.contains("dd")) { sel = { r1: r, c1: c, r2: r, c2: c }; paintSel(); e.preventDefault(); startEdit(r, c, false); return; }
    if (c === 0 && !e.shiftKey && grid[r][0]) {
      // 種類のマスは押すたびに 単品⇔山
      setCell(r, 0, grid[r][0] === "山" ? "単品" : "山");
      if (autoCells.has(r + ":1")) grid[r][1] = "";
      sel = { r1: r, c1: 0, r2: r, c2: 0 };
      draw(); sheet.focus(); e.preventDefault(); return;
    }
    if (e.shiftKey) { sel.r2 = r; sel.c2 = c; } else sel = { r1: r, c1: c, r2: r, c2: c };
    dragging = true; paintSel(); sheet.focus(); e.preventDefault();
  });
  sheet.addEventListener("mouseover", (e) => {
    const td = (e.target as HTMLElement).closest<HTMLTableCellElement>("td.cell");
    if (!td) return;
    if (dragging) { sel.r2 = +td.dataset.r!; sel.c2 = +td.dataset.c!; paintSel(); }
    if (filling) { filling.to = Math.max(box().bot, +td.dataset.r!); paintSel(); }
  });
  const onMouseUp = () => {
    dragging = false;
    if (filling) {
      const b = box(), to = filling.to;
      filling = null;
      if (to > b.bot) {
        const h = b.bot - b.top + 1;
        for (let r = b.bot + 1; r <= to; r++) for (let c = b.left; c <= b.right; c++) { if (c === 1) continue; setCell(r, c, grid[b.top + ((r - b.top) % h)][c]); }
        sel = { r1: b.top, r2: to, c1: b.left, c2: b.right };
      }
      draw();
    }
  };
  sheet.addEventListener("dblclick", (e) => { const td = (e.target as HTMLElement).closest<HTMLTableCellElement>("td.cell"); if (td && +td.dataset.c! !== 0) startEdit(+td.dataset.r!, +td.dataset.c!, false); });

  // ---- 編集 ----
  function startEdit(r: number, c: number, clear: boolean, initial = "") {
    if (c === 0) return;
    commitEdit();
    const td = cellEl(r, c);
    if (!td) return;
    const inp = document.createElement("input");
    inp.className = "editor" + (NUMCOL.has(c) ? " n" : "");
    inp.value = clear ? initial : grid[r][c];
    td.textContent = "";
    td.appendChild(inp);
    const ed = { r, c, inp } as NonNullable<typeof editing>;
    editing = ed;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    if (c === GENRE_COL) {
      // ジャンルは一覧から選ぶ。文字を打つと絞り込める
      const dd = document.createElement("div");
      dd.className = "ddlist";
      document.body.appendChild(dd);
      ed.dd = dd;
      const rc = td.getBoundingClientRect();
      dd.style.left = rc.left + "px"; dd.style.top = rc.bottom + 2 + "px"; dd.style.minWidth = Math.max(180, rc.width) + "px";
      let typed = clear, hi = -1;
      const show = () => {
        const q = typed ? inp.value.trim() : "";
        const cur = inp.value.trim();
        const list = GENRES.filter((g) => !q || norm(g).includes(norm(q)));
        if (!typed && hi < 0) hi = list.indexOf(cur);
        dd.innerHTML = list.map((g, i) => `<div class="opt${i === hi ? " on" : ""}${g === cur ? " cur" : ""}" data-v="${esc(g)}">${g === cur ? "✓ " : ""}${esc(g)}</div>`).join("") ||
          `<div class="none">「${esc(q)}」は一覧にありません（Enterでそのまま入れる）</div>`;
        dd.querySelectorAll<HTMLDivElement>(".opt").forEach((o) => o.addEventListener("mousedown", (ev) => { ev.preventDefault(); inp.value = o.dataset.v!; commitEdit(); sheet.focus(); }));
      };
      inp.addEventListener("input", () => { typed = true; hi = -1; show(); });
      inp.addEventListener("keydown", (ev) => {
        const n = dd.querySelectorAll(".opt").length;
        if (ev.key === "ArrowDown") { ev.preventDefault(); hi = Math.min(n - 1, hi + 1); show(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); hi = Math.max(-1, hi - 1); show(); }
        else if (ev.key === "Enter" && hi >= 0) { const o = dd.querySelectorAll<HTMLDivElement>(".opt")[hi]; if (o) inp.value = o.dataset.v!; }
      });
      show();
    }
    inp.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return; // 日本語の変換中の Enter は確定に使う
      if (ev.key === "Enter") { ev.preventDefault(); commitEdit(); move(1, 0); }
      else if (ev.key === "Tab") { ev.preventDefault(); commitEdit(); move(0, ev.shiftKey ? -1 : 1); }
      else if (ev.key === "Escape") { editing?.dd?.remove(); editing = null; draw(); sheet.focus(); }
    });
    inp.addEventListener("blur", () => setTimeout(commitEdit, 0));
  }
  function commitEdit() {
    if (!editing) return;
    const { r, c, inp, dd } = editing;
    editing = null;
    dd?.remove();
    setCell(r, c, inp.value);
    draw();
  }
  function move(dr: number, dc: number, extend = false) {
    const r = Math.max(0, sel.r2 + dr), c = Math.min(NC - 1, Math.max(0, sel.c2 + dc));
    if (r >= grid.length) { ensureRows(r + 5); draw(); }
    if (extend) { sel.r2 = r; sel.c2 = c; } else sel = { r1: r, c1: c, r2: r, c2: c };
    paintSel(); sheet.focus();
    cellEl(r, c)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---- キーボード ----
  sheet.addEventListener("keydown", (e) => {
    if (editing || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); move(...arrows[k], e.shiftKey); return; }
    if (k === "Enter") { e.preventDefault(); startEdit(sel.r1, sel.c1, false); return; }
    if (k === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); const b = box(); for (let r = b.top; r <= b.bot; r++) for (let c = b.left; c <= b.right; c++) setCell(r, c, ""); draw(); return; }
    if (mod && k.toLowerCase() === "d") { e.preventDefault(); const b = box(); for (let r = b.top + 1; r <= b.bot; r++) for (let c = b.left; c <= b.right; c++) { if (c === 1) continue; setCell(r, c, grid[b.top][c]); } draw(); return; }
    if (mod && k.toLowerCase() === "a") { e.preventDefault(); sel = { r1: 0, c1: 0, r2: grid.length - 1, c2: NC - 1 }; paintSel(); return; }
    if (!mod && k.length === 1) { e.preventDefault(); startEdit(sel.r1, sel.c1, true, k); }
  });
  // 日本語入力は keydown では文字が取れないので、マスを選んだまま変換を始めたら編集にする
  sheet.addEventListener("compositionstart", () => { if (!editing) startEdit(sel.r1, sel.c1, true, ""); });

  // ---- コピー・貼り付け ----
  const selText = () => { const b = box(), rows: string[] = []; for (let r = b.top; r <= b.bot; r++) rows.push(grid[r].slice(b.left, b.right + 1).join("\t")); return rows.join("\n"); };
  const onCopy = (e: ClipboardEvent) => { if (document.activeElement !== sheet) return; e.clipboardData!.setData("text/plain", selText()); e.preventDefault(); };
  const onCut = (e: ClipboardEvent) => {
    if (document.activeElement !== sheet) return;
    e.clipboardData!.setData("text/plain", selText()); e.preventDefault();
    const b = box(); for (let r = b.top; r <= b.bot; r++) for (let c = b.left; c <= b.right; c++) setCell(r, c, ""); draw();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (document.activeElement !== sheet) return;
    e.preventDefault();
    let lines = (e.clipboardData!.getData("text/plain") || "").replace(/\r/g, "").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    let rows = lines.map((l) => l.split("\t"));
    const b = box();
    let colMap: number[] | null = null, left = b.left;
    // 1行目が見出し（管理番号・商品名など）なら、列の順番は自由
    const head = rows[0].map((h) => ALIAS[h.trim()] || h.trim());
    if (rows.length > 1 && head.some((h) => COLS.some(([c]) => c === h))) { colMap = head.map((h) => COLS.findIndex(([c]) => c === h)); rows = rows.slice(1); left = 0; }
    const h = rows.length, w = rows[0].length;
    // 1行コピーして複数行を選んで貼り付けると、選んだ行すべてに同じ内容が入る
    const fillH = b.bot - b.top + 1 > h && (b.bot - b.top + 1) % h === 0 ? b.bot - b.top + 1 : h;
    const fillW = !colMap && b.right - b.left + 1 > w && (b.right - b.left + 1) % w === 0 ? b.right - b.left + 1 : w;
    ensureRows(b.top + fillH + 3);
    for (let i = 0; i < fillH; i++) for (let j = 0; j < fillW; j++) {
      const c = colMap ? colMap[j % w] : left + j;
      if (c == null || c < 0 || c >= NC) continue;
      setCell(b.top + i, c, rows[i % h][j % w]);
    }
    sel = { r1: b.top, c1: colMap ? 0 : left, r2: b.top + fillH - 1, c2: colMap ? NC - 1 : Math.min(NC - 1, left + fillW - 1) };
    draw(); sheet.focus();
  };

  // ---- 伝票CSVの読み込み ----
  function parseCSV(text: string) {
    return text.replace(/\r/g, "").split("\n").map((line) => {
      const out: string[] = [];
      let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
      }
      out.push(cur);
      return out;
    });
  }
  function loadSlip(text: string, fileName: string) {
    const rows = parseCSV(text);
    const get = (k: string) => (rows.find((r) => r[0] === k) || [])[1] || "";
    const date = get("開催日"), hall = get("会場");
    const hi = rows.findIndex((r, i) => r.includes("商品名") && r.includes("小計") && (rows[i - 1] || [])[0] === "請求明細");
    if (hi < 0) {
      $("slipInfo").innerHTML = `<span style="color:var(--red)"><b>${esc(fileName)}</b> の形式はまだ読み取れません。スプレッドシートに開いて、表に貼り付けてください（初めての形式の伝票は、列を選べるようにする予定です）。</span>`;
      return;
    }
    const H = rows[hi], ix = (k: string) => H.indexOf(k), lines: string[][] = [];
    // 原価は「小計」（単価＋税＋落札手数料＋税）。オークションの商品IDは取り込まない
    for (let i = hi + 1; i < rows.length && rows[i].length > 1; i++) { const r = rows[i]; lines.push(["", "", r[ix("商品名")], "", "", "", r[ix("小計")], r[ix("数量")], ""]); }
    $<HTMLInputElement>("slipSupplier").value = hall ? `オークション（${hall}）` : "";
    $<HTMLInputElement>("slipDate").value = date;
    const extra = rows.find((r) => r[0] === "入場料");
    $("slipInfo").innerHTML = `<b>${esc(fileName)}</b> を読み込みました：商品 ${lines.length}件` + (extra ? `／入場料 ¥${(+extra[3]).toLocaleString()} は商品の原価に入れず、経費として別に記録します（経費の記録はこれから作ります）` : "");
    grid = []; autoCells.clear(); lines.forEach((l, i) => (grid[i] = l)); ensureRows(Math.max(12, lines.length + 4));
    sel = { r1: 0, c1: 0, r2: 0, c2: 0 }; draw();
  }
  async function readFile(f: File) {
    const buf = await f.arrayBuffer();
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("shift_jis").decode(buf); } // 文字コードを自動で判定
    loadSlip(text, f.name);
  }
  const drop = $("drop");
  $<HTMLInputElement>("slipFile").addEventListener("change", (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) readFile(f); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer?.files[0]; if (f) readFile(f); });
  $("sampleSlip").addEventListener("click", () => loadSlip(SAMPLE_SLIP, "見本の伝票.csv"));
  ["slipSupplier", "slipDate"].forEach((id) => $(id).addEventListener("input", draw));

  // ---- 確認（直すところは赤、自動で入れたマスは青、一覧にないジャンルはオレンジ） ----
  function recalc() {
    const errs: string[] = [], warns: string[] = [], seen = new Map<string, number>();
    let count = 0, yama = 0;
    sheet.querySelectorAll<HTMLTableCellElement>("td.cell").forEach((td) => { td.classList.remove("err", "auto", "warn"); td.title = ""; });
    const mark = (r: number, c: number, msg: string) => { const td = cellEl(r, c); if (td) { td.classList.add("err"); td.title = msg; } errs.push(`${r + 1}行目「${COLS[c][0]}」：${msg}`); };
    grid.forEach((row, r) => {
      if (!row[0]) return;
      count++;
      if (row[0] === "山") yama++;
      if (opts.existing.has(row[1])) mark(r, 1, "すでに登録されています");
      else if (seen.has(row[1])) mark(r, 1, `${seen.get(row[1])! + 1}行目と重複しています`);
      else if (row[0] === "山" && !/^\d+-0$/.test(row[1])) mark(r, 1, "山の番号は 0353-0 のように -0 で終わる形にしてください");
      else if (row[0] === "単品" && /-0$/.test(row[1])) mark(r, 1, "-0 で終わる番号は山に使います");
      seen.set(row[1], r);
      if (!row[2]) mark(r, 2, "商品名がありません");
      if (!row[5]) mark(r, 5, "仕入日がありません（上の「仕入日」に入れると全部の行に入ります）");
      else if (!isDate(row[5])) mark(r, 5, "2026/11/04 の形で、ある日付を入れてください");
      if (num(row[6]) == null) mark(r, 6, "原価がありません（0円なら 0）");
      NUMCOL.forEach((c) => { const v = num(row[c]); if (Number.isNaN(v)) mark(r, c, "数字を入れてください"); else if (v != null && (v < 0 || !Number.isInteger(v))) mark(r, c, "0以上の整数を入れてください"); });
      if (num(row[7]) === 0) mark(r, 7, "個数は1以上にしてください");
      if (row[GENRE_COL] && !GENRES.includes(row[GENRE_COL])) {
        const td = cellEl(r, GENRE_COL);
        if (td) { td.classList.add("warn"); td.title = "一覧にないジャンルです"; }
        warns.push(`${r + 1}行目「ジャンル」：「${esc(row[GENRE_COL])}」は一覧にありません。登録すると一覧に追加されます`);
      }
    });
    autoCells.forEach((k) => {
      const [r, c] = k.split(":").map(Number);
      const td = cellEl(r, c);
      if (td && !td.classList.contains("err")) { td.classList.add("auto"); if (c === GENRE_COL) td.title = "商品名から推測しました。違っていたら ▾ で選び直してください"; }
    });
    $("warnlist").innerHTML = warns.slice(0, 5).map((e) => `<li>${e}</li>`).join("");
    const s = $("summary");
    s.textContent = count ? (errs.length ? `${count}件のうち、直すところが${errs.length}か所あります` : `${count}件（単品 ${count - yama}・山 ${yama}）、すべて登録できます`) : "まだ何も入っていません";
    s.style.color = count ? (errs.length ? "var(--red)" : "var(--green)") : "";
    $("errlist").innerHTML = errs.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join("") + (errs.length > 8 ? `<li>ほか${errs.length - 8}か所</li>` : "");
    $<HTMLButtonElement>("doReg").disabled = busy || !count || errs.length > 0;
  }

  const clearAll = () => { grid = []; autoCells.clear(); ensureRows(12); sel = { r1: 0, c1: 2, r2: 0, c2: 2 }; $("slipInfo").textContent = ""; draw(); };
  $("addRows").addEventListener("click", () => { ensureRows(grid.length + 10); draw(); });
  $("clear").addEventListener("click", clearAll);
  $("doReg").addEventListener("click", async () => {
    const rows: RegisterRow[] = grid.filter((r) => r[0]).map((r) => ({
      kind: r[0] === "山" ? "山" : "単品", code: r[1], name: r[2], genre: r[3], supplier: r[4], date: r[5],
      cost: num(r[6]) ?? 0, qty: num(r[7]) ?? 1, exp: num(r[8]), kids: [],
    }));
    busy = true; recalc();
    const ok = await opts.onRegister(rows);
    busy = false;
    if (ok) clearAll(); else recalc();
  });

  /** 登録できたあとに、番号の続きと登録済みの番号を新しくする */
  function update(next: { existing: Set<string>; nextNo: number }) { opts.existing = next.existing; opts.nextNo = next.nextNo; draw(); }

  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCut);
  document.addEventListener("paste", onPaste);
  ensureRows(12);
  draw();
  return {
    update,
    destroy() {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      editing?.dd?.remove();
    },
  };
}

// 見本の伝票（実際の伝票の形をまねたもの）
const SAMPLE_SLIP = `"開催日","2026/11/04"
"会場","関東"

"請求明細"
"レーン","商品ID","商品名","数量","単価","税","落札手数料","税","小計"
"レーンB","5807165","Apple MacBookAir A2941","1","67500","6750","6750","675","81675"
"レーンC","5806536","【ジャンク】メガネグッズまとめ他小物まとめ","1","43250","4325","4325","433","52333"
"レーンC","5806632","BAKUNE Dry TENTIAL ロングスリーブTシャツ/ロングパンツセット　SIZE M ネイビー","1","12000","1200","1200","120","14520"
"レーンC","5806657","ボトムまとめ 山売り","1","7750","775","775","78","9378"
""
"請求","金額","消費税","合計金額"
"入場料","2000","200","2200"`;
