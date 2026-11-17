"use client";
// 商品一覧の画面（画面イメージ docs/mockup/index.html の「商品一覧」と同じ見た目・操作）
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { changeListings, undoListings, type ListingUndo } from "@/lib/listing-actions";
import { recordBundle, recordSales, cancelSales } from "@/lib/sale-actions";
import { recordReturn, recordRefund, cancelAdjustment } from "@/lib/adjust-actions";
import { removeItem, undoRemove, restoreItem, updateItem, type ItemPatch } from "@/lib/item-actions";
import { todayJst } from "@/lib/format";
import { yen } from "@/lib/format";
import { ask } from "@/lib/ask";
import { markChanged, recentChanged, clearChanged, RECENT_MIN } from "@/lib/recent";

export type Refund = { id: number; date: string; amount: number; via: string };
export type SaleInfo = {
  saleId: number; refundVia: string; returnShippingBack: boolean; refunds: Refund[];
  date: string; channel: string; currency: string; fxRate: number | null; fxRateFinal: boolean;
  priceForeign: number | null; shippingForeign: number | null; feeForeign: number | null;
  priceJpy: number; shippingFeeJpy: number; actualShippingJpy: number; shippingTentative: boolean; feeJpy: number;
  costJpy: number; lineCount: number;
};
export type ItemRow = {
  id: number; code: string; name: string; genre: string; supplier: string; purchasedAt: string;
  unitCost: number; expectedPrice: number | null; quantity: number; left: number;
  status: string; channels: string[]; soldChannels: string[]; days: number | null;
  lotCode: string | null; lotCostMode: string | null; sale: SaleInfo | null;
  returns: { adjId: number; date: string; channel: string; loss: number }[];
};
export type ChannelInfo = {
  id: number; name: string; currency: string; feeMode: string; feeRate: number | null; feeHintRate: number | null;
  usesShippingFee: boolean; undecided: boolean;
};
export type LotInfo = { code: string; name: string; totalCost: number };
/** 消した商品（山ごと消したときは -0 だけ。withBranches は一緒に消した枝番の数） */
export type RemovedItem = { id: number; code: string; name: string; deletedAt: string; withBranches: number };

const ST: Record<string, [string, string]> = {
  stock: ["未出品", "t-stock"], list: ["出品中", "t-list"], sold: ["売却済み", "t-sold"], disposed: ["廃棄", "t-warn"], fixture: ["備品", "t-stock"], closed: ["売り切り", "t-stock"],
};
const inStock = (r: ItemRow) => r.status === "stock" || r.status === "list";
const isLotHead = (r: ItemRow) => !!r.lotCode && r.code.endsWith("-0");
/** 縦積在庫（個数で持つ在庫）：管理番号が L で始まるか、個数が2個以上 */
const isStack = (r: ItemRow) => /^L/i.test(r.code) || r.quantity > 1;

// ひらがな・カタカナ、全角・半角、大文字・小文字、空白の違いを気にせずに探す
const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "");

// 絞り込み（docs/data-design.md「商品一覧の絞り込みと状態」）。「在庫」は未出品＋出品中
// 縦積在庫は「縦積」を押したときだけ出す（検索したときは、どれでも出す）
const FILTERS: [string, string, (r: ItemRow) => boolean][] = [
  ["now", "在庫", inStock],
  ["all", "すべて", () => true],
  ["stock", "未出品", (r) => r.status === "stock"],
  ["list", "出品中", (r) => r.status === "list"],
  ["sold", "売却済み", (r) => !inStock(r)],
  ["lot", "山", isLotHead],
  ["old", "90日以上", (r) => inStock(r) && (r.days ?? 0) >= 90],
  ["stack", "縦積", isStack],
];

// 並び順（いくつでも重ねられる。①で並べて、同じものは②で…。選んだものは次に開いたときも覚えておく）
type SortKey = "added" | "code" | "name" | "genre" | "supplier" | "date" | "cost" | "exp" | "status" | "channel" | "days";
type Sort = { key: SortKey; desc: boolean };
/** 並べられる項目：名前・はじめの向き（true＝大きい順・新しい順）・向きの言い方 */
const SORT_KEYS: Record<SortKey, [string, boolean, [string, string]]> = {
  added: ["登録した順", true, ["古い順", "新しい順"]],
  code: ["管理番号", false, ["小さい順", "大きい順"]],
  name: ["商品名", false, ["あいうえお順", "逆順"]],
  genre: ["ジャンル", false, ["あいうえお順", "逆順"]],
  supplier: ["仕入先", false, ["あいうえお順", "逆順"]],
  date: ["仕入日", true, ["古い順", "新しい順"]],
  cost: ["原価", true, ["安い順", "高い順"]],
  exp: ["予想売価", true, ["安い順", "高い順"]],
  status: ["状態", false, ["未出品→出品中→売却済み", "逆順"]],
  channel: ["出品先", false, ["あいうえお順", "逆順"]],
  days: ["滞留", true, ["短い順", "長い順"]],
};
const SORT_DEFAULT: Sort[] = [{ key: "added", desc: true }];
const SORT_STORE = "items-sort";
const STATUS_ORDER = ["stock", "list", "sold", "closed", "disposed", "fixture"];
const loadSort = (): Sort[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_STORE) ?? "null");
    const arr = (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x && x.key in SORT_KEYS);
    if (arr.length) return arr;
  } catch {}
  return SORT_DEFAULT;
};
// 表の列（幅を変えられる。変えた幅は覚えておく）
type ColKey = "pick" | "code" | "name" | "genre" | "date" | "cost" | "exp" | "status" | "channel" | "days";
const COLS: { k: ColKey; label: string; sort?: SortKey; n?: boolean }[] = [
  { k: "pick", label: "" },
  { k: "code", label: "管理番号", sort: "code" },
  { k: "name", label: "商品名", sort: "name" },
  { k: "genre", label: "ジャンル", sort: "genre" },
  { k: "date", label: "仕入日", sort: "date" },
  { k: "cost", label: "原価", sort: "cost", n: true },
  { k: "exp", label: "予想売価", sort: "exp", n: true },
  { k: "status", label: "状態", sort: "status" },
  { k: "channel", label: "出品先", sort: "channel" },
  { k: "days", label: "滞留", sort: "days", n: true },
];
const COLW_STORE = "items-colw";
const loadColW = (): Record<string, number> | null => {
  try { const v = JSON.parse(localStorage.getItem(COLW_STORE) ?? "null"); if (v && typeof v === "object" && COLS.every((c) => typeof v[c.k] === "number")) return v; } catch {}
  return null;
};

function Chips({ r }: { r: ItemRow }) {
  if (!r.channels.length && !r.soldChannels.length) return <span className="muted">未出品</span>;
  return (
    <>
      {r.soldChannels.map((c) => <span key={"s" + c} className="chip sold">{c}</span>)}
      {r.channels.map((c) => <span key={c} className="chip">{c}</span>)}
    </>
  );
}
/** 表の見出し：押すと並び替わる（Shift を押しながらだと「次の並び順」に足す）。右のふちをドラッグすると幅が変わる */
function ColTh({ c, sorts, onSort, onResize }: { c: (typeof COLS)[number]; sorts: Sort[]; onSort: (k: SortKey, add: boolean) => void; onResize: (k: ColKey, e: React.MouseEvent) => void }) {
  const idx = c.sort ? sorts.findIndex((x) => x.key === c.sort) : -1;
  const on = idx >= 0;
  const grip = c.k === "pick" ? null : (
    <span className="colgrip" title="ドラッグで幅を変える（ダブルクリックで元に戻す）" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onResize(c.k, e); }} onClick={(e) => e.stopPropagation()} />
  );
  if (!c.sort) return <th className={c.n ? "n" : ""} style={c.k === "pick" ? { width: 28 } : undefined}>{c.label}{grip}</th>;
  const s = on ? sorts[idx] : null;
  return (
    <th
      className={`sortth${c.n ? " n" : ""}${on ? " on" : ""}`}
      onClick={(e) => onSort(c.sort!, e.shiftKey)}
      title={`押すと、${c.label}の順に並び替えます（もう一度押すと逆の順）。Shift を押しながら押すと、今の並び順に「次の並び順」として足します`}
      aria-sort={s ? (s.desc ? "descending" : "ascending") : "none"}
    >
      {c.label}<span className="sortmark">{s ? (s.desc ? " ▼" : " ▲") : " ↕"}{s && sorts.length > 1 && <sup>{idx + 1}</sup>}</span>{grip}
    </th>
  );
}
const Days = ({ d }: { d: number | null }) => (d == null ? <span className="muted">—</span> : d >= 90 ? <span className="days-old" title="90日以上たっています">{d}日</span> : <>{d}日</>);

type Toast = { msg: React.ReactNode; undo?: () => Promise<void> } | null;
/** 返品・返金の記録の入力 */
export type AdjInput =
  | { kind: "cancel" }
  | { kind: "return"; date: string; returnShipping: number; lostFee: number; outboundBack: boolean }
  | { kind: "refund"; date: string; amount: number; via: string };

export function ItemsView({ rows, channels, lots, genres, suppliers, removed }: { rows: ItemRow[]; channels: ChannelInfo[]; lots: LotInfo[]; genres: string[]; suppliers: string[]; removed: RemovedItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [invF, setInvF] = useState("now");
  const [qInput, setQInput] = useState("");
  const q = useDeferredValue(qInput); // 打ったそばから絞り込む（打つのが重くならないように少し遅らせる）
  const [sorts, setSortsState] = useState<Sort[]>(SORT_DEFAULT);
  useEffect(() => { setSortsState(loadSort()); setColW(loadColW()); }, []);
  const setSorts = (s: Sort[]) => { const v = s.length ? s : SORT_DEFAULT; setSortsState(v); try { localStorage.setItem(SORT_STORE, JSON.stringify(v)); } catch {} };
  /** 表の見出しを押したとき：①と同じ見出しなら向きを逆に、違う見出しならその見出しだけで並べる。add（Shift）なら次の並び順に足す */
  const sortBy = (key: SortKey, add: boolean) => {
    const i = sorts.findIndex((x) => x.key === key);
    if (add) setSorts(i >= 0 ? sorts.map((x, j) => (j === i ? { ...x, desc: !x.desc } : x)) : [...sorts, { key, desc: SORT_KEYS[key][1] }]);
    else setSorts(i === 0 ? [{ ...sorts[0], desc: !sorts[0].desc }, ...sorts.slice(1)] : [{ key, desc: SORT_KEYS[key][1] }]);
  };
  const [help, setHelp] = useState(false);
  // 並び順のパネル（外を押すと閉じる）
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sortOpen) return;
    const close = (e: MouseEvent) => { if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortOpen]);
  // 列の幅（null ＝ 中身に合わせる）
  const [colW, setColWState] = useState<Record<string, number> | null>(null);
  const setColW = (w: Record<string, number> | null) => { setColWState(w); try { if (w) localStorage.setItem(COLW_STORE, JSON.stringify(w)); else localStorage.removeItem(COLW_STORE); } catch {} };
  const headRef = useRef<HTMLTableRowElement>(null);
  const startResize = (k: ColKey, e: React.MouseEvent) => {
    if (e.detail >= 2) { setColW(null); return; } // ダブルクリックで元に戻す
    // はじめて変えるときは、今の幅を測って、そこから変える
    const base = colW ?? Object.fromEntries(COLS.map((c, i) => [c.k, (headRef.current?.children[i] as HTMLElement | undefined)?.offsetWidth ?? 80]));
    const x0 = e.clientX, w0 = base[k];
    let cur = base;
    const move = (ev: MouseEvent) => { cur = { ...base, [k]: Math.max(40, Math.round(w0 + ev.clientX - x0)) }; setColWState(cur); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.classList.remove("colresizing"); setColW(cur); };
    document.body.classList.add("colresizing");
    setColWState(base);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const [genre, setGenre] = useState("");
  const [chFilter, setChFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [toastKey, setToastKey] = useState(0);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  // さっき変えた商品（10分間は色を付けたまま。ほかの画面で変えた分も）
  const [recent, setRecent] = useState<Record<string, number>>({});
  useEffect(() => {
    const read = () => setRecent(recentChanged());
    read();
    window.addEventListener("recent-changed", read);
    const id = setInterval(read, 30000); // 10分たったものを外す
    return () => { window.removeEventListener("recent-changed", read); clearInterval(id); };
  }, []);
  const [error, setError] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);

  const lotOf = (r: ItemRow) => (r.lotCode && rows.some((x) => x.code === `${r.lotCode}-0`) ? r.lotCode : null);
  const lotHasBranches = (code: string) => rows.some((x) => x.lotCode === code && !x.code.endsWith("-0"));
  const listChannels = channels.filter((c) => !c.undecided);

  // 山（-0）の行のすぐ下に、その山の枝番を並べる。山の行は、枝番のどれかが当てはまれば見出しとして出す
  // 並べ替えは「1件」または「山ひとまとまり」を単位にする（山の中は枝番の順のまま）
  const build = (fk: string) => {
    const f = FILTERS.find((x) => x[0] === fk)![2];
    const k = norm(q);
    const stackOk = (r: ItemRow) => fk === "stack" || !!k || !isStack(r);
    const kw = (r: ItemRow) => stackOk(r) && (!k || norm(r.code + r.name).includes(k)) && (!genre || r.genre === genre) && (!chFilter || r.channels.includes(chFilter) || r.soldChannels.includes(chFilter));
    const bn = (code: string) => (code.endsWith("-0") ? -1 : Number(code.split("-")[1]));
    const units: ItemRow[][] = [];
    const done = new Set<string>();
    for (const r of rows) {
      const p = lotOf(r);
      if (!p) { if (fk !== "lot" && f(r) && kw(r)) units.push([r]); continue; }
      if (done.has(p)) continue;
      done.add(p);
      const grp = rows.filter((x) => lotOf(x) === p).sort((a, b) => bn(a.code) - bn(b.code));
      const [head, ...kids] = grp;
      if (fk === "lot") { if (grp.some(kw)) units.push(grp); continue; }
      const hk = kids.filter((x) => f(x) && kw(x));
      if ((f(head) && kw(head)) || hk.length) units.push([head, ...hk]);
    }
    return units;
  };
  const list = useMemo(() => {
    const units = build(invF);
    const val = (u: ItemRow[], key: SortKey): number | string => {
      const h = u[0];
      const sum = (g: (r: ItemRow) => number) => u.reduce((a, r) => a + g(r), 0);
      switch (key) {
        case "added": return Math.min(...u.map((r) => r.id)); // 山は、中でいちばん先に登録した商品で並べる
        case "code": return h.code;
        case "name": return norm(h.name);
        case "genre": return h.genre || "\uffff"; // 空いているものは最後
        case "supplier": return h.supplier || "\uffff";
        case "date": return h.purchasedAt;
        case "cost": return sum((r) => r.unitCost);
        case "exp": return sum((r) => r.expectedPrice ?? 0);
        case "status": return STATUS_ORDER.indexOf(h.status);
        case "channel": return h.soldChannels[0] ?? h.channels[0] ?? "\uffff";
        case "days": return Math.max(-1, ...u.map((r) => r.days ?? -1));
      }
    };
    const keyed = units.map((u) => ({ u, v: sorts.map((x) => val(u, x.key)) }));
    const cmp = (a: number | string, b: number | string) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ja"));
    keyed.sort((a, b) => {
      for (let i = 0; i < sorts.length; i++) { const c = cmp(a.v[i], b.v[i]) * (sorts[i].desc ? -1 : 1); if (c) return c; }
      return a.u[0].code.localeCompare(b.u[0].code) || a.u[0].id - b.u[0].id;
    });
    return keyed.flatMap((x) => x.u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, invF, q, genre, chFilter, sorts]);
  // 検索して見つからないとき、「すべて」なら何件あるか
  const elsewhere = useMemo(() => (q && invF !== "all" && !list.length ? build("all").flat().length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, invF, q, genre, chFilter, list.length]);
  const pillCount = useMemo(() => Object.fromEntries(FILTERS.map(([k, , f]) => [k, rows.filter((r) => f(r) && (k === "stack" || !isStack(r))).length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]);

  const rowCls = (r: ItemRow) => {
    const p = lotOf(r);
    return [p ? (r.code.endsWith("-0") ? "lotrow" : "brrow") : "", flash.has(r.code) ? "flash" : "", recent[r.code] ? "changed" : ""].join(" ");
  };
  const QtyTag = ({ r }: { r: ItemRow }) => (
    <>
      {isLotHead(r) && <> <span className="tag t-yama">山{lotHasBranches(r.lotCode!) ? "の残り" : ""} ▸</span></>}
      {r.quantity > 1 && <> <span className="tag t-list">残り{r.left}／{r.quantity}個</span></>}
    </>
  );

  const togglePick = (code: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(code); else n.delete(code); return n; });
  useEffect(() => { document.body.classList.toggle("picking", picked.size > 0); }, [picked]);
  // 売れたなどで在庫でなくなった商品は、選択から外す
  useEffect(() => { setPicked((s) => new Set([...s].filter((c) => rows.some((r) => r.code === c && inStock(r))))); }, [rows]);

  const showToast = (t: Toast) => { setToast(t); setToastKey((k) => k + 1); };
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 10000); return () => clearTimeout(id); }, [toast, toastKey]);
  const flashCodes = (codes: string[]) => { markChanged(codes); setFlash(new Set(codes)); setTimeout(() => setFlash(new Set()), 2500); };
  const recentCount = rows.filter((r) => recent[r.code]).length;

  /** 出品先を変える（1点でも、まとめてでも同じ処理） */
  const runChange = (targets: ItemRow[], channel: ChannelInfo, on: boolean) => {
    setError("");
    startTransition(async () => {
      const res = await changeListings({ itemIds: targets.map((t) => t.id), channelId: channel.id, on });
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
      flashCodes(targets.map((t) => t.code));
      const one = targets.length === 1 ? targets[0].code : null;
      const msg = on
        ? <>{one ?? `${res.changed}点`} を <b>{channel.name}</b> に出品中にしました</>
        : <>{one ?? `${res.changed}点`} の <b>{channel.name}</b> を取り下げにしました{res.toStock ? `（${one ? "" : res.toStock + "点は"}出品先がなくなったので未出品）` : ""}</>;
      const undo: ListingUndo = res.undo;
      showToast({
        msg,
        undo: async () => {
          await undoListings(undo);
          router.refresh();
          flashCodes(targets.map((t) => t.code));
          showToast({ msg: "取り消しました。出品先は元に戻りました" });
        },
      });
    });
  };

  /** 返品・返金・発送前のキャンセルを記録する */
  const runAdjust = (r: ItemRow, a: AdjInput) => {
    if (!r.sale) return;
    const saleId = r.sale.saleId;
    setError("");
    startTransition(async () => {
      if (a.kind === "cancel") {
        const res = await cancelSales([saleId], "発送前のキャンセル");
        if (!res.ok) { showToast({ msg: res.error }); return; }
        router.refresh();
        flashCodes([r.code]);
        showToast({ msg: <>{r.code} の販売を取り消しました（発送前のキャンセル）。商品は元の状態に戻りました</> });
        return;
      }
      const res = a.kind === "return"
        ? await recordReturn({ saleId, date: a.date, returnShipping: a.returnShipping, lostFee: a.lostFee, outboundBack: a.outboundBack })
        : await recordRefund({ saleId, date: a.date, amount: a.amount, via: a.via });
      if (!res.ok) { showToast({ msg: res.error }); return; }
      router.refresh();
      flashCodes(res.codes);
      const who = res.codes.length > 1 ? `${res.codes.join("・")}（まとめて売った分）` : r.code;
      showToast({
        msg: a.kind === "return"
          ? <>{who} を返品として記録しました。在庫に戻りました（損 {yen(res.loss ?? 0)}）。売り直すときは出品先を押します</>
          : <>{r.code} の一部返金 {yen(a.amount)} を記録しました</>,
        undo: async () => {
          const u = await cancelAdjustment(res.adjId);
          router.refresh();
          showToast({ msg: u.ok ? (a.kind === "return" ? `取り消しました。${r.code} は売却済みに戻りました` : `取り消しました。${r.code} の返金はなくなりました`) : u.error });
        },
      });
    });
  };
  const undoAdj = (r: ItemRow, adjId: number, what: string) => {
    startTransition(async () => {
      if (!(await ask(`${r.code} の${what}の記録を取り消しますか？`, "取り消す"))) return;
      const u = await cancelAdjustment(adjId);
      router.refresh();
      showToast({ msg: u.ok ? `${r.code} の${what}の記録を取り消しました` : u.error });
    });
  };

  /** 商品を取り消す（消した印を付けるだけ） */
  const runRemove = (r: ItemRow) => {
    const head = isLotHead(r);
    const msg = head
      ? `山${r.lotCode}（${r.name}）を取り消しますか？\n枝番もまとめて取り消します。消した商品の一覧から戻せます。`
      : `${r.code} ${r.name} を取り消しますか？\n消した商品の一覧から戻せます。${r.lotCostMode === "alloc" ? "\nこの枝番の原価は、残りの枝番で分け直します。" : ""}`;
    startTransition(async () => {
      if (!(await ask(msg, "取り消す"))) return;
      const res = await removeItem(r.id);
      if (!res.ok) { showToast({ msg: res.error }); return; }
      setOpenCode(null);
      router.refresh();
      const undo = res.undo;
      showToast({
        msg: <>{res.codes.length > 1 ? `${res.codes[0]} ほか${res.codes.length - 1}点` : res.codes[0]} を取り消しました{undo.costs.length > 0 && "（山の原価を分け直しました）"}</>,
        undo: async () => { const u = await undoRemove(undo); router.refresh(); flashCodes(res.codes); showToast({ msg: u.ok ? "元に戻しました" : u.error ?? "" }); },
      });
    });
  };
  /** 廃棄にする（売る予定だったが捨てた。原価を損失として記録し、在庫から外す。販売の記録の「廃棄」と同じ） */
  const runDispose = (r: ItemRow, date: string, qty: number, done: () => void) => {
    startTransition(async () => {
      const res = await recordSales([{ itemId: r.id, channel: "廃棄", date, qty, price: null, ship: null, fee: null, feeTouched: false, real: null }], "廃棄にする");
      if (!res.ok) { showToast({ msg: res.error }); return; }
      done();
      const d = res.done[0];
      markChanged([r.code]);
      router.refresh();
      const rest = d.left != null && d.left > 0;
      if (!rest) setOpenCode(null);
      showToast({
        msg: <>{r.code} {qty > 1 || r.quantity > 1 ? `を${qty}個` : "を"}廃棄にしました（損失 {yen(r.unitCost * qty)}）。{rest ? `残りは${d.left}個です` : "在庫から外れました"}</>,
        undo: async () => { const u = await cancelSales([d.saleId], "廃棄を元に戻す"); router.refresh(); flashCodes([r.code]); showToast({ msg: u.ok ? "元に戻しました。在庫に戻っています" : u.error ?? "" }); },
      });
    });
  };
  /** 商品を直す */
  const runEdit = (r: ItemRow, patch: ItemPatch, done: () => void) => {
    startTransition(async () => {
      const res = await updateItem(r.id, patch);
      if (!res.ok) { showToast({ msg: res.error }); return; }
      done();
      if (!res.changed.length) { showToast({ msg: "変わったところはありませんでした" }); return; }
      router.refresh();
      flashCodes([r.code]);
      const before = res.before;
      const LABEL: Record<string, string> = { name: "商品名", genre: "ジャンル", supplier: "仕入先", date: "仕入日", unitCost: "原価", quantity: "個数", expectedPrice: "予想売価" };
      showToast({
        msg: <>{r.code} の{res.changed.map((k) => LABEL[k]).join("・")}を直しました</>,
        undo: async () => { const u = await updateItem(r.id, before); router.refresh(); showToast({ msg: u.ok ? "元に戻しました" : u.error }); },
      });
    });
  };
  const runRestore = (x: RemovedItem) => {
    startTransition(async () => {
      const res = await restoreItem(x.id);
      if (!res.ok) { showToast({ msg: res.error }); return; }
      router.refresh();
      flashCodes(res.codes);
      showToast({ msg: <>{res.codes.length > 1 ? `${res.codes[0]} ほか${res.codes.length - 1}点` : res.codes[0]} を戻しました</> });
    });
  };

  // 山（-0）の行は山の画面を開く。ほかは商品の画面
  const openRowOf = (r: ItemRow) => { if (isLotHead(r)) router.push(`/lots/${r.lotCode}`); else setOpenCode(r.code); };
  const inStockCount = rows.filter(inStock).length;
  const openRow = rows.find((r) => r.code === openCode) ?? null;
  const pickedRows = rows.filter((r) => picked.has(r.code) && inStock(r));
  // お知らせ（「元に戻す」付き）。商品の画面を開いている間は、その画面の中に出す（後ろの画面は押せないため）
  const toastNode = toast && (
    <div id="toast" className="show" key={toastKey}>
      <span>{toast.msg}</span>
      {toast.undo && <button className="btn" onClick={() => { const u = toast.undo!; setToast(null); startTransition(u); }}>元に戻す</button>}
      <button className="x" onClick={() => setToast(null)}>×</button>
      <i className="bar" />
    </div>
  );

  const Empty = () => (
    <>当てはまる商品はありません{elsewhere > 0 && <>。<button className="linkbtn" onClick={() => setInvF("all")}>「すべて」にすると {elsewhere}点あります</button></>}</>
  );

  return (
    <section>
      <div className="pagehead">
        <h1>商品一覧 <span className="headcount">全 {rows.length.toLocaleString()} 点・在庫 {inStockCount.toLocaleString()} 点</span></h1>
        <button className="linkbtn" onClick={() => setHelp(!help)} aria-expanded={help}>{help ? "使い方を閉じる" : "？ 使い方"}</button>
      </div>
      {help && (
        <ul className="helpcard">
          <li><b>商品を押す</b>と、利益・出品先が見られます。直す・廃棄・取り消しもここから。</li>
          <li><b>出品先を変える・まとめて売る</b>：商品にチェックを入れて、下に出るボタンを押します。</li>
          <li><span className="tag t-yama">山 ▸</span> の行を押すと山の画面が開き、枝番を追加できます。縦積在庫は「縦積」で出ます。</li>
          <li><b>並び替え</b>：見出しを押す（もう一度で逆）。Shift を押しながら押すと「次の並び順」を足せます。右上の「並び順」からも。</li>
          <li><b>列の幅</b>：見出しの右のふちをドラッグ（ダブルクリックで元に戻す）。</li>
        </ul>
      )}
      {error && <p className="err">{error}</p>}
      <div className="filters">
        <span className="searchbox">
          <input
            type="search"
            placeholder="🔍 管理番号・商品名で探す（打つとすぐ絞り込み）"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQInput(""); }}
          />
          {qInput && <button className="linkbtn" onClick={() => setQInput("")} aria-label="検索を消す">✕</button>}
        </span>
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">ジャンル：すべて</option>
          {genres.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={chFilter} onChange={(e) => setChFilter(e.target.value)}>
          <option value="">出品先：すべて</option>
          {channels.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
      </div>
      {recentCount > 0 && (
        <p className="recentnote">
          <i className="sw changed" /> 色の付いた行は、さっき変えた商品です（{recentCount}点・{RECENT_MIN}分たつと消えます）
          <button className="linkbtn" onClick={clearChanged}>色を消す</button>
        </p>
      )}
      <div className="toolbar">
        <div className="pills">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={`pill${k === invF ? " on" : ""}`} onClick={() => setInvF(k)}>{l} <span className="pc-n">{pillCount[k]}</span></button>
          ))}
        </div>
        <div className="sortpop" ref={sortRef}>
          <button className={`btn small${sortOpen ? " on" : ""}`} onClick={() => setSortOpen(!sortOpen)} aria-expanded={sortOpen}>
            ⇅ {SORT_KEYS[sorts[0].key][0]}（{SORT_KEYS[sorts[0].key][2][sorts[0].desc ? 1 : 0]}）{sorts.length > 1 ? ` ほか${sorts.length - 1}つ` : ""} ▾
          </button>
          {sortOpen && (
            <div className="sortpanel">
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>上から順に並べます。項目を押すと逆の順になります。</div>
              {sorts.map((x, i) => (
                <div key={x.key} className="sortrow">
                  <b>{i + 1}</b>
                  <button className="linkbtn" onClick={() => setSorts(sorts.map((y, j) => (j === i ? { ...y, desc: !y.desc } : y)))} title="押すと逆の順になります">
                    {SORT_KEYS[x.key][0]}（{SORT_KEYS[x.key][2][x.desc ? 1 : 0]}）{x.desc ? "▼" : "▲"}
                  </button>
                  {sorts.length > 1 && <button className="x" onClick={() => setSorts(sorts.filter((_, j) => j !== i))} title="この並び順を外す" aria-label="外す">×</button>}
                </div>
              ))}
              {sorts.length < Object.keys(SORT_KEYS).length && (
                <select value="" onChange={(e) => { const k = e.target.value as SortKey; if (k) setSorts([...sorts, { key: k, desc: SORT_KEYS[k][1] }]); }} aria-label="並び順を足す">
                  <option value="">＋ 次の並び順を足す</option>
                  {(Object.keys(SORT_KEYS) as SortKey[]).filter((k) => !sorts.some((x) => x.key === k)).map((k) => <option key={k} value={k}>{SORT_KEYS[k][0]}</option>)}
                </select>
              )}
              <div className="sortfoot">
                {(sorts.length > 1 || sorts[0].key !== "added" || !sorts[0].desc) && <button className="linkbtn" onClick={() => setSorts(SORT_DEFAULT)}>新しく登録した順に戻す</button>}
                {colW && <button className="linkbtn pc-only" onClick={() => setColW(null)}>列の幅を元に戻す</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card tablewrap pc" style={{ padding: "4px 8px" }}>
        <table className={colW ? "fixedw" : ""} style={colW ? { width: COLS.reduce((a, c) => a + colW[c.k], 0) } : undefined}>
          {colW && <colgroup>{COLS.map((c) => <col key={c.k} style={{ width: colW[c.k] }} />)}</colgroup>}
          <thead>
            <tr ref={headRef}>
              {COLS.map((c) => <ColTh key={c.k} c={c} sorts={sorts} onSort={sortBy} onResize={startResize} />)}
            </tr>
          </thead>
          <tbody id="itemrows">
            {!list.length && <tr><td colSpan={10} className="muted" style={{ padding: 16 }}><Empty /></td></tr>}
            {list.map((r) => (
              <tr key={r.id} className={`clickable ${rowCls(r)}`} onClick={() => openRowOf(r)}>
                <td onClick={(e) => e.stopPropagation()}>
                  {inStock(r) && <input type="checkbox" checked={picked.has(r.code)} onChange={(e) => togglePick(r.code, e.target.checked)} />}
                </td>
                <td>{r.code}</td>
                <td title={r.name}><span className="nm">{r.name}</span><QtyTag r={r} /></td>
                <td>{r.genre}</td>
                <td>{r.purchasedAt}</td>
                <td className="n">{yen(r.unitCost)}</td>
                <td className="n">{r.expectedPrice != null ? yen(r.expectedPrice) : "—"}</td>
                <td><span className={`tag ${ST[r.status][1]}`}>{ST[r.status][0]}</span></td>
                <td><Chips r={r} /></td>
                <td className="n"><Days d={r.days} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mcards" id="itemcards">
        {!list.length && <p className="muted"><Empty /></p>}
        {list.map((r) => (
          <div key={r.id} className={`mc clickable ${rowCls(r)}`} onClick={() => openRowOf(r)}>
            <div className="top">
              <span className="muted">
                {inStock(r) && <input type="checkbox" checked={picked.has(r.code)} onClick={(e) => e.stopPropagation()} onChange={(e) => togglePick(r.code, e.target.checked)} />} {r.code}・{r.genre}
              </span>
              <span className={`tag ${ST[r.status][1]}`}>{ST[r.status][0]}</span>
            </div>
            <div className="name"><span className="nm">{r.name}</span><QtyTag r={r} /></div>
            <div className="meta">
              <span>原価 {yen(r.unitCost)} / 予想 {r.expectedPrice != null ? yen(r.expectedPrice) : "—"}</span>
              <span>{inStock(r) && r.days != null ? r.days + "日" : ""}</span>
            </div>
            <div style={{ marginTop: 6 }}><Chips r={r} /></div>
          </div>
        ))}
      </div>

      {removed.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="linkbtn" onClick={() => setShowRemoved(!showRemoved)}>{showRemoved ? "▾" : "▸"} 消した商品（{removed.length}件）</button>
          {showRemoved && (
            <div className="card tablewrap" style={{ padding: "4px 8px", marginTop: 6 }}>
              <table>
                <thead><tr><th>管理番号</th><th>商品名</th><th>消した日</th><th></th></tr></thead>
                <tbody>
                  {removed.map((x) => (
                    <tr key={x.id}>
                      <td>{x.code}</td>
                      <td>{x.name}{x.withBranches > 0 && <span className="muted">（枝番 {x.withBranches}点も一緒に）</span>}</td>
                      <td>{x.deletedAt}</td>
                      <td><button className="btn" disabled={pending} onClick={() => runRestore(x)}>戻す</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {picked.size > 0 && (
        <div className="pickbar" style={{ display: "flex" }}>
          <b>{picked.size}点を選んでいます</b>
          <button className="btn" onClick={() => setPicked(new Set())}>選択を外す</button>
          <button className="btn" onClick={() => setBulkOpen(true)}>出品先を変える</button>
          <button className="btn primary" onClick={() => setBundleOpen(true)}>まとめて売る</button>
        </div>
      )}

      {openRow && (
        <ItemDialog
          r={openRow}
          channels={channels}
          listChannels={listChannels}
          lot={openRow.lotCode ? lots.find((l) => l.code === openRow.lotCode) ?? null : null}
          pending={pending}
          toast={toastNode}
          onClose={() => setOpenCode(null)}
          onToggle={(ch, on) => runChange([openRow], ch, on)}
          onAdjust={(a) => runAdjust(openRow, a)}
          genres={genres}
          suppliers={suppliers}
          onEdit={(patch, done) => runEdit(openRow, patch, done)}
          onRemove={() => runRemove(openRow)}
          onDispose={(date, qty, done) => runDispose(openRow, date, qty, done)}
          onUndoAdj={(id, what) => undoAdj(openRow, id, what)}
        />
      )}
      {bulkOpen && pickedRows.length > 0 && (
        <BulkDialog
          rows={pickedRows}
          listChannels={listChannels}
          pending={pending}
          onClose={() => setBulkOpen(false)}
          onRun={(ch, on) => { setBulkOpen(false); runChange(pickedRows.filter((r) => r.channels.includes(ch.name) !== on), ch, on); }}
        />
      )}

      {bundleOpen && pickedRows.length > 0 && (
        <BundleDialog
          rows={pickedRows}
          all={rows}
          channels={listChannels}
          pending={pending}
          onClose={() => setBundleOpen(false)}
          onSave={(input) => startTransition(async () => {
            const res = await recordBundle(input);
            if (!res.ok) { setError(res.error); setBundleOpen(false); return; }
            setBundleOpen(false);
            setPicked(new Set());
            router.refresh();
            flashCodes(res.codes);
            showToast({
              msg: <>{res.codes.length}点を1件の販売として記録しました（粗利 {yen(res.profit)}）
                {res.others.length > 0 && <><br /><span className="delist">⚠ ほかに出品中：{res.others.map((o) => `${o.code} → ${o.channels.join("・")}`).join("、")} の出品を取り下げてください</span></>}</>,
              undo: async () => { await cancelSales([res.saleId], "まとめて売るを元に戻す"); router.refresh(); flashCodes(res.codes); showToast({ msg: "取り消しました。商品は元の状態（在庫・出品中）に戻りました" }); },
            });
          })}
        />
      )}
      {!openRow && toastNode}
    </section>
  );
}

/** <dialog> を開いた状態で出す（Escキーや背景で閉じられる） */
function Modal({ className, onClose, children }: { className?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} className={className} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {children}
    </dialog>
  );
}

function ItemDialog({ r, channels, listChannels, lot, pending, toast, onClose, onToggle, onAdjust, onUndoAdj, genres, suppliers, onEdit, onRemove, onDispose }: {
  r: ItemRow; channels: ChannelInfo[]; listChannels: ChannelInfo[]; lot: LotInfo | null; pending: boolean; toast: React.ReactNode;
  onClose: () => void; onToggle: (ch: ChannelInfo, on: boolean) => void; onAdjust: (a: AdjInput) => void; onUndoAdj: (adjId: number, what: string) => void;
  genres: string[]; suppliers: string[]; onEdit: (p: ItemPatch, done: () => void) => void; onRemove: () => void;
  onDispose: (date: string, qty: number, done: () => void) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [dispOpen, setDispOpen] = useState(false);
  useEffect(() => { setEditOpen(false); setDispOpen(false); }, [r.id]);
  const st = ST[r.status];
  const [retOpen, setRetOpen] = useState(false);
  useEffect(() => setRetOpen(false), [r.status, r.sale?.saleId, r.sale?.refunds.length]);
  let body: React.ReactNode;
  if (r.status === "sold" && r.sale) {
    const s = r.sale;
    const refund = s.refunds.reduce((a, x) => a + x.amount, 0);
    const profit = s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - s.costJpy - refund; // docs/profit-formulas.md
    const fx = s.currency !== "JPY";
    const sign = s.currency === "EUR" ? "€" : "$";
    const sub = (v: number | null) => (fx && v != null ? <><br /><small className="muted">{sign}{(v / 100).toFixed(2)} × {s.fxRate}円</small></> : null);
    body = (
      <>
        <div className={`profitbig ${profit >= 0 ? "up" : "down"}`}>
          <span>粗利</span><b>{yen(profit)}</b><small>粗利率 {s.priceJpy ? Math.round((profit / s.priceJpy) * 100) : 0}%</small>
        </div>
        <p className="muted" style={{ margin: "0 0 6px" }}>
          {s.date} に <b>{s.channel}</b> で売れました{s.lineCount > 1 && `（${s.lineCount}点をまとめて）`}
          {fx && !s.fxRateFinal && <>　<span className="tag t-temp">為替 仮のレート</span></>}
        </p>
        <table className="calc">
          <tbody>
            <tr><td>売値（円）{sub(s.priceForeign)}</td><td className="n">{yen(s.priceJpy)}</td></tr>
            <tr><td>＋ 設定送料（円）{sub(s.shippingForeign)}</td><td className="n">{yen(s.shippingFeeJpy)}</td></tr>
            <tr><td>− 実送料{s.shippingTentative && <> <span className="tag t-temp">仮</span></>}</td><td className="n">{yen(s.actualShippingJpy)}</td></tr>
            <tr><td>− 手数料（円）{sub(s.feeForeign)}</td><td className="n">{yen(s.feeJpy)}</td></tr>
            <tr><td>− 原価</td><td className="n">{yen(s.costJpy)}</td></tr>
            {s.refunds.map((x) => (
              <tr key={x.id}>
                <td>− 一部返金 <span className="tag t-warn">{x.date.slice(5)}</span>
                  <br /><small className="muted">{x.via === "bank" ? "法人口座から振込（freeeのCSVには入れない）" : "販路の振込から引かれる"}</small>
                  <button className="linkbtn" disabled={pending} onClick={() => onUndoAdj(x.id, "一部返金")}>取り消す</button></td>
                <td className="n">{yen(x.amount)}</td>
              </tr>
            ))}
            <tr className="tot"><td>粗利</td><td className={`n ${profit >= 0 ? "up" : "down"}`}>{yen(profit)}</td></tr>
          </tbody>
        </table>
        {retOpen
          ? <ReturnBox s={s} profit={profit} pending={pending} onCancel={() => setRetOpen(false)} onSave={onAdjust} />
          : <div style={{ textAlign: "right", marginTop: 10 }}><button className="btn" onClick={() => setRetOpen(true)}>返品・返金があった</button></div>}
      </>
    );
  } else if (r.status === "sold") {
    body = <p className="muted">売れた記録の詳しい内訳はありません。</p>;
  } else if (r.status === "closed") {
    body = <div className="profitbig"><span>売り切り</span><b>—</b><small>{isLotHead(r) ? "山の残りはありません（-0 は山かどうかを分かるための行で、売り買いはしません）" : `スプレッドシートで売却済みだったが、売上の記録がない商品です（合わせ売りなど）。原価 ${yen(r.unitCost)} は損として数えます`}</small></div>;
  } else if (r.status === "disposed") {
    body = <div className="profitbig down"><span>損失</span><b>−{yen(r.unitCost * r.quantity)}</b><small>廃棄</small></div>;
  } else if (r.status === "fixture") {
    body = <div className="profitbig"><span>備品にした</span><b>—</b><small>売上・粗利に入れません</small></div>;
  } else {
    // まだ売れていない：予想の利益（出品先ごと。送料は含まない）
    const exp = r.expectedPrice ?? 0;
    const names = r.channels.length ? r.channels : ["メルカリ"];
    const calc = names.map((n) => {
      const c = channels.find((x) => x.name === n);
      const rate = !c ? 0.1 : c.feeMode === "auto" ? c.feeRate ?? 0 : c.feeMode === "none" ? 0 : c.feeHintRate ?? 0.1;
      const fee = exp * rate;
      return { n, rate, fee, profit: exp - fee - r.unitCost, auto: c?.feeMode === "auto" };
    });
    const best = calc.reduce((a, b) => (b.profit > a.profit ? b : a), calc[0]);
    body = (
      <>
        <div className={`profitbig ${best.profit >= 0 ? "up" : "down"}`}>
          <span>予想の粗利</span><b>{yen(best.profit)}</b><small>まだ売れていません（予想売価で計算）</small>
        </div>
        <table className="calc">
          <tbody>
            <tr><td>予想売価</td><td className="n">{yen(exp)}</td></tr>
            <tr><td>− 原価</td><td className="n">{yen(r.unitCost)}</td></tr>
            <tr className="tot"><td>手数料を引く前</td><td className="n">{yen(exp - r.unitCost)}</td></tr>
          </tbody>
        </table>
        <div className="sec" style={{ marginTop: 14 }}>{r.channels.length ? "出品先ごとの予想" : "メルカリで売った場合の予想"}（送料は含みません）</div>
        <table className="calc small">
          <tbody>
            {calc.map((x) => (
              <tr key={x.n}>
                <td>{x.n}<br /><small className="muted">手数料 {x.auto ? "" : "目安 "}{+(x.rate * 100).toFixed(1)}%</small></td>
                <td className="n">− {yen(x.fee)}</td>
                <td className={`n ${x.profit >= 0 ? "up" : "down"}`}><b>{yen(x.profit)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <Modal className="itemdlg" onClose={onClose}>
      <div className="dlghead">
        <div><div className="muted">{r.code}・{r.genre}</div><h2 style={{ margin: "2px 0 0" }}>{r.name}</h2></div>
        <button className="x" title="閉じる" onClick={onClose}>×</button>
      </div>
      <div className="infogrid">
        <div><span>状態</span><b><span className={`tag ${st[1]}`}>{st[0]}</span></b></div>
        <div><span>仕入日</span><b>{r.purchasedAt}</b></div>
        <div><span>原価{r.quantity > 1 ? "（1個）" : ""}</span><b>{yen(r.unitCost)}</b></div>
        {r.quantity > 1 && <div><span>在庫</span><b>残り{r.left}個／{r.quantity}個</b></div>}
        <div><span>{inStock(r) ? "滞留日数" : "出品先"}</span><b>{inStock(r) ? (r.days != null ? r.days + "日" : "—") : <Chips r={r} />}</b></div>
      </div>
      {r.returns.map((x) => (
        <div key={x.adjId} className="rethist">
          ↩ {x.date.slice(5)} に <b>{x.channel}</b> から返品で戻りました（同じ番号で売り直せます）。この返品の損：<b>{yen(x.loss)}</b>
          {inStock(r) && <button className="linkbtn" disabled={pending} onClick={() => onUndoAdj(x.adjId, "返品")}>取り消す</button>}
        </div>
      ))}
      {inStock(r) && (
        <div className="listbox">
          <b>出品先</b> <span className="muted">押すと出品中、もう一度押すと取り下げ。状態は自動で変わります</span>
          <div className="chips">
            {listChannels.map((c) => {
              const on = r.channels.includes(c.name);
              return (
                <button key={c.id} className={`chipbtn${on ? " on" : ""}`} disabled={pending} onClick={() => onToggle(c, !on)}>
                  {on ? "✓ " : ""}{c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {dispOpen && !editOpen && <DisposeBox r={r} pending={pending} onCancel={() => setDispOpen(false)} onSave={(d, q) => onDispose(d, q, () => setDispOpen(false))} />}
      {editOpen
        ? <EditBox r={r} genres={genres} suppliers={suppliers} pending={pending} onCancel={() => setEditOpen(false)} onSave={(p) => onEdit(p, () => setEditOpen(false))} />
        : body}
      {lot && (
        <div className="lotbox">
          <span className="muted">
            {isLotHead(r)
              ? <>山{lot.code}（{lot.name}）の残りです。仕入額 {yen(lot.totalCost)}。</>
              : <>この商品は山{lot.code}（{lot.name}・仕入額 {yen(lot.totalCost)}）の枝番です{r.lotCostMode === "zero" ? "（残りから0円で出した）" : ""}。山全体の利益は山の画面で見られます。</>}
          </span>
          <Link className="btn" href={`/lots/${lot.code}`}>山の画面へ</Link>
        </div>
      )}
      {!editOpen && !dispOpen && (
        <div className="itemfoot">
          <button className="btn" disabled={pending} onClick={() => setEditOpen(true)}>✎ 直す</button>
          {inStock(r) && !isLotHead(r) && <button className="btn" disabled={pending} onClick={() => setDispOpen(true)} title="売る予定だったが捨てたとき。原価を損失として記録します">🗑 廃棄にする</button>}
          {inStock(r) && <button className="btn danger" disabled={pending} onClick={onRemove}>{isLotHead(r) ? "山ごと取り消す" : "この商品を取り消す"}</button>}
        </div>
      )}
      {toast}
    </Modal>
  );
}

/** 商品を直す（商品名・ジャンル・仕入先・仕入日・原価・個数・予想売価） */
/** 廃棄にする：日付と（縦積なら）個数を選ぶ */
function DisposeBox({ r, pending, onCancel, onSave }: { r: ItemRow; pending: boolean; onCancel: () => void; onSave: (date: string, qty: number) => void }) {
  const [date, setDate] = useState(todayJst().replace(/-/g, "/"));
  const [qty, setQty] = useState(r.quantity > 1 ? 1 : r.left || 1);
  const multi = r.quantity > 1;
  return (
    <div className="retbox">
      <b>廃棄にする</b>
      <p className="muted" style={{ margin: "4px 0 8px" }}>売る予定だったけれど、壊れた・売れないなどで捨てたときに使います。原価を損失として記録し、在庫から外します（売上には入りません）。間違えたときは、あとから「元に戻す」で戻せます。</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label className="f">廃棄した日<input className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {multi && (
          <label className="f">個数（残り{r.left}個）
            <input className="inp" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(r.left, Number(e.target.value.normalize("NFKC")) || 1)))} style={{ width: 80 }} />
          </label>
        )}
        <div><span className="muted">損失</span> <b className="down">−{yen(r.unitCost * qty)}</b></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn danger" disabled={pending} onClick={() => onSave(date, qty)}>廃棄にする</button>
        <button className="btn" disabled={pending} onClick={onCancel}>やめる</button>
      </div>
    </div>
  );
}

function EditBox({ r, genres, suppliers, pending, onCancel, onSave }: {
  r: ItemRow; genres: string[]; suppliers: string[]; pending: boolean; onCancel: () => void; onSave: (p: ItemPatch) => void;
}) {
  const inLot = !!r.lotCode;
  const [f, setF] = useState({
    name: r.name, genre: r.genre, supplier: r.supplier, date: r.purchasedAt,
    unitCost: String(r.unitCost), quantity: String(r.quantity), exp: r.expectedPrice == null ? "" : String(r.expectedPrice),
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => { const t = v.normalize("NFKC").replace(/[¥,円\s]/g, ""); return t === "" ? null : Number.isInteger(+t) && +t >= 0 ? +t : NaN; };
  const save = () => {
    setErr("");
    const cost = n(f.unitCost), qty = n(f.quantity), exp = n(f.exp);
    if (!f.name.trim()) { setErr("商品名を入れてください"); return; }
    if (!inLot && (cost == null || Number.isNaN(cost))) { setErr("原価は0以上の整数で入れてください"); return; }
    if (!inLot && (qty == null || Number.isNaN(qty) || qty < 1)) { setErr("個数は1以上の整数で入れてください"); return; }
    if (exp != null && Number.isNaN(exp)) { setErr("予想売価は0以上の整数で入れてください"); return; }
    onSave({ name: f.name, genre: f.genre, supplier: f.supplier, date: f.date, unitCost: inLot ? null : cost, quantity: inLot ? null : qty, expectedPrice: exp });
  };
  return (
    <div className="retbox editbox">
      <b>商品を直す</b>
      <label className="f">商品名<input className="inp" value={f.name} onChange={set("name")} /></label>
      <div className="editgrid">
        <label className="f">ジャンル<input className="inp" list="eGenres" value={f.genre} onChange={set("genre")} />
          <datalist id="eGenres">{genres.map((g) => <option key={g} value={g} />)}</datalist></label>
        <label className="f">仕入先<input className="inp" list="eSuppliers" value={f.supplier} onChange={set("supplier")} />
          <datalist id="eSuppliers">{suppliers.map((g) => <option key={g} value={g} />)}</datalist></label>
        <label className="f">仕入日<input className="inp" value={f.date} onChange={set("date")} /></label>
        <label className="f">原価{r.quantity > 1 ? "（1個）" : ""}<input className="inp n" inputMode="numeric" value={f.unitCost} onChange={set("unitCost")} disabled={inLot} /></label>
        <label className="f">個数<input className="inp n" inputMode="numeric" value={f.quantity} onChange={set("quantity")} disabled={inLot} /></label>
        <label className="f">予想売価<input className="inp n" inputMode="numeric" value={f.exp} onChange={set("exp")} /></label>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {inLot ? "山の商品の原価は、山の画面の割り振りで決まります。ここでは直せません。予想売価を直しても、原価の割り振りはそのままです。" : "もう売れた分の粗利は変わりません（記録したときの原価のまま）。"}
        一覧にないジャンル・仕入先は、そのまま入れると一覧に追加されます。
      </p>
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>やめる</button>
        <button className="btn primary" disabled={pending} onClick={save}>保存する</button>
      </div>
    </div>
  );
}

/** 返品・返金の記録（売却済みの商品の画面の中に出す） */
function ReturnBox({ s, profit, pending, onCancel, onSave }: { s: SaleInfo; profit: number; pending: boolean; onCancel: () => void; onSave: (a: AdjInput) => void }) {
  const [kind, setKind] = useState<"cancel" | "return" | "refund">("return");
  const [date, setDate] = useState(todayJst().replace(/-/g, "/"));
  const [ship, setShip] = useState("");
  const [fee, setFee] = useState("0"); // 売買が成立しないので、手数料はふつう運営から返される
  const [amt, setAmt] = useState("");
  const [via, setVia] = useState(s.refundVia === "bank" ? "bank" : "payout");
  const [back, setBack] = useState(s.returnShippingBack); // 行きの送料が戻ってくるか（販路の設定がはじめの値）
  const [err, setErr] = useState("");
  const num = (v: string) => { const n = Number(v.normalize("NFKC").replace(/[¥,円\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN; };
  const shipN = num(ship || "0"), feeN = num(fee || "0"), amtN = num(amt || "0");
  const loss = (back ? 0 : s.actualShippingJpy) + (shipN || 0) + (feeN || 0);
  const save = () => {
    setErr("");
    if (kind === "cancel") {
      void ask("この販売の記録を取り消して、商品を売れる前の状態（在庫・出品中）に戻しますか？", "販売を取り消す").then((y) => { if (y) onSave({ kind: "cancel" }); });
      return;
    }
    if (kind === "return") {
      if (Number.isNaN(shipN) || Number.isNaN(feeN)) { setErr("金額は数字で入れてください"); return; }
      onSave({ kind: "return", date, returnShipping: shipN, lostFee: feeN, outboundBack: back });
      return;
    }
    if (Number.isNaN(amtN) || amtN <= 0) { setErr("返金した金額を入れてください"); return; }
    onSave({ kind: "refund", date, amount: amtN, via });
  };
  return (
    <div className="retbox">
      <b>返品・返金の記録</b>
      <div className="seg">
        {([["cancel", "発送前のキャンセル"], ["return", "返品（商品が戻る）"], ["refund", "一部だけ返金"]] as const).map(([k, l]) => (
          <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      {s.lineCount > 1 && kind !== "refund" && <p className="hint" style={{ margin: 0 }}>この販売は{s.lineCount}点をまとめて売った記録です。中身の{s.lineCount}点すべてが対象になります。</p>}
      {kind === "cancel" && <p className="hint" style={{ margin: 0 }}>お金も送料もまだ動いていないときです。販売の記録を取り消して、商品を元の状態（在庫・出品中）に戻します。</p>}
      {kind !== "cancel" && (
        <div className="f">{kind === "return" ? "返品の日" : "返金した日"}<input value={date} onChange={(e) => setDate(e.target.value)} style={{ textAlign: "left" }} /></div>
      )}
      {kind === "return" && (
        <>
          <div className="f">行きの送料（{yen(s.actualShippingJpy)}）
            <div className="seg">
              <button className={back ? "on" : ""} onClick={() => setBack(true)}>戻ってくる（損にしない）</button>
              <button className={!back ? "on" : ""} onClick={() => setBack(false)}>こちらの損</button>
            </div>
            <span className="hint">メルカリの返品は送料がかからないので「戻ってくる」。ヤフオクでこちらの都合で返品したときなどは「こちらの損」（はじめの値は販路の設定で決められます）</span></div>
          <div className="f">返品の送料（返送用封筒など・円）<input inputMode="numeric" placeholder="0" value={ship} onChange={(e) => setShip(e.target.value)} /><span className="hint">こちらで返送の送料を払ったときだけ入れます（自社で返送した、返送用封筒を送った など）</span></div>
          <div className="f">戻ってこない手数料（円）<input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} /><span className="hint">ふつうは 0 円です（売買が成立しないので、手数料は運営から返されます）。返されなかったときだけ入れます</span></div>
          <div className="sumline">この返品の損：行きの送料 {back ? "¥0（戻ってくる）" : yen(s.actualShippingJpy)} ＋ 返品の送料 {yen(shipN || 0)} ＋ 手数料 {yen(feeN || 0)} ＝ <b>{yen(loss)}</b>{loss === 0 && "（売上・粗利に影響しません）"}</div>
          <p className="hint" style={{ margin: 0 }}>売値は0円になり、商品は在庫に戻ります（同じ管理番号のまま）。確定済みの月のレポートは書き換えず、返品した月のレポートにマイナスの行として載せます。</p>
        </>
      )}
      {kind === "refund" && (
        <>
          <div className="f">返金した金額（円）<input inputMode="numeric" placeholder="例：1000" value={amt} onChange={(e) => setAmt(e.target.value)} /><span className="hint">傷があったので少し値引きした、などのとき。商品は売却済みのままです</span></div>
          <div className="f">返金のしかた
            <div className="seg">
              <button className={via === "payout" ? "on" : ""} onClick={() => setVia("payout")}>販路の振込から引かれる</button>
              <button className={via === "bank" ? "on" : ""} onClick={() => setVia("bank")}>法人口座から振り込む</button>
            </div>
            <span className="hint">{via === "payout" ? "freeeの取込用CSVに、返金としてマイナスで入れます" : "freeeでは銀行の明細から登録するので、取込用CSVには入れません（二重にならないように）"}</span>
          </div>
          <div className="sumline">粗利 {yen(profit)} → <b>{yen(profit - (amtN || 0))}</b>（−{yen(amtN || 0)}）</div>
        </>
      )}
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>やめる</button>
        <button className="btn primary" disabled={pending} onClick={save}>記録する</button>
      </div>
    </div>
  );
}

function BulkDialog({ rows, listChannels, pending, onClose, onRun }: {
  rows: ItemRow[]; listChannels: ChannelInfo[]; pending: boolean; onClose: () => void; onRun: (ch: ChannelInfo, on: boolean) => void;
}) {
  const [ch, setCh] = useState(listChannels.find((c) => c.name === "メルカリ") ?? listChannels[0]);
  const has = rows.filter((r) => r.channels.includes(ch.name)).length;
  return (
    <Modal onClose={onClose}>
      <div className="dlghead">
        <div><div className="muted">{rows.length}点を選んでいます</div><h2 style={{ margin: "2px 0 0" }}>出品先をまとめて変える</h2></div>
        <button className="x" title="閉じる" onClick={onClose}>×</button>
      </div>
      <div className="f">
        <span>販路</span>
        <div className="chips">
          {listChannels.map((c) => <button key={c.id} className={`chipbtn${c.id === ch.id ? " on" : ""}`} onClick={() => setCh(c)}>{c.name}</button>)}
        </div>
      </div>
      <p className="muted" style={{ margin: "10px 0" }}>選んだ{rows.length}点のうち、<b>{ch.name}</b> に出品中は {has}点、まだは {rows.length - has}点です。</p>
      <ul className="muted" style={{ margin: "0 0 12px", paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>
        {rows.map((r) => <li key={r.id}>{r.code} {r.name}（{r.channels.length ? r.channels.join("・") : "未出品"}）</li>)}
      </ul>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button className="btn" disabled={!has || pending} onClick={() => onRun(ch, false)}>{ch.name} を取り下げる</button>
        <button className="btn primary" disabled={has === rows.length || pending} onClick={() => onRun(ch, true)}>{ch.name} に出品した</button>
      </div>
    </Modal>
  );
}

/** まとめて売る（山売り・合わせ売り）。販売の記録は1件。売れた金額は予想売価の比率で中身に分ける（手で直せる） */
function BundleDialog({ rows, all, channels, pending, onClose, onSave }: {
  rows: ItemRow[]; all: ItemRow[]; channels: ChannelInfo[]; pending: boolean; onClose: () => void;
  onSave: (input: { channel: string; date: string; total: number; fee: number; real: number; parts: { itemId: number; amount: number }[] }) => void;
}) {
  const num = (s: string) => { const v = s.normalize("NFKC").replace(/[¥,円\s]/g, ""); return v === "" || Number.isNaN(+v) ? 0 : Math.max(0, Math.floor(+v)); };
  const [ch, setCh] = useState((channels.find((c) => c.name === "ヤフオク") ?? channels[0]).name);
  const [date, setDate] = useState(todayJst().replace(/-/g, "/"));
  const [total, setTotal] = useState("");
  const [fee, setFee] = useState("");
  const [real, setReal] = useState("");
  const [manual, setManual] = useState<Record<number, string>>({});
  // 選んだ枝番の山に、まだ山の残り（-0）があれば「一緒に入れる」を出す
  const lotHeads = [...new Set(rows.filter((r) => r.lotCode && !r.code.endsWith("-0")).map((r) => r.lotCode!))]
    .map((l) => all.find((x) => x.code === `${l}-0` && inStock(x)))
    .filter((x): x is ItemRow => !!x && !rows.some((r) => r.id === x.id));
  const [extra, setExtra] = useState<number[]>([]);
  const list = [...rows, ...lotHeads.filter((h) => extra.includes(h.id))];

  const t = num(total), f = num(fee), rl = num(real);
  const auto = list.filter((b) => manual[b.id] == null);
  const fixed = list.reduce((a, b) => a + (manual[b.id] != null ? num(manual[b.id]) : 0), 0);
  const rest = Math.max(0, t - fixed);
  const expOf = (b: ItemRow) => b.expectedPrice ?? 0;
  const expSum = auto.reduce((a, b) => a + expOf(b), 0);
  const share: Record<number, number> = {};
  let left = rest;
  for (const b of auto) { share[b.id] = expSum ? Math.floor((rest * expOf(b)) / expSum) : Math.floor(rest / auto.length); left -= share[b.id]; }
  if (auto.length) share[auto.reduce((m, b) => (expOf(b) > expOf(m) ? b : m), auto[0]).id] += left;
  const amt = (b: ItemRow) => (manual[b.id] != null ? num(manual[b.id]) : share[b.id] ?? 0);
  const sum = list.reduce((a, b) => a + amt(b), 0);
  const costOf = (b: ItemRow) => b.unitCost * b.left;
  const cost = list.reduce((a, b) => a + costOf(b), 0);
  const profit = t - f - rl - cost;
  const ok = sum === t && t > 0;

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: "0 0 4px" }}>まとめて売る（山売り・合わせ売り）</h2>
      <p className="muted" style={{ margin: "0 0 12px" }}>販売の記録は<b>1件（1行）</b>になります。中身の商品はすべて売却済みになります。<br />売れた金額は、山ごとの成績が分かるように、予想売価の比率で中身に分けます（予想売価がなければ均等。金額のマスは手で直せます）。金額は円で入れます。</p>
      <div className="filters">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>売り先
          <select value={ch} onChange={(e) => setCh(e.target.value)}>{channels.map((c) => <option key={c.id}>{c.name}</option>)}</select>
        </label>
        <input value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: "0 1 130px", minWidth: 120 }} />
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>売れた金額<input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="numeric" placeholder="0" style={{ width: 110 }} className="n" /></label>
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>手数料<input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="0" style={{ width: 90 }} className="n" /></label>
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>実送料<input value={real} onChange={(e) => setReal(e.target.value)} inputMode="numeric" placeholder="0" style={{ width: 90 }} className="n" /></label>
      </div>
      <div style={{ marginBottom: 10 }}>
        {lotHeads.map((h) => (
          <label key={h.id} className="chk">
            <input type="checkbox" checked={extra.includes(h.id)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, h.id] : x.filter((i) => i !== h.id)))} />
            山{h.lotCode}の残り（{h.code}・枝番にしていない物）も一緒に入れる
          </label>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>管理番号</th><th className="n">予想売価</th><th className="n">原価</th><th className="n">売上（分けた額）</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td>{b.code}{isLotHead(b) && <> <span className="tag t-yama">山の残り</span></>}<br /><span className="muted">{b.name}{b.left > 1 ? `（${b.left}個）` : ""}</span>{b.lotCode && <><br /><span className="muted">→ 山{b.lotCode}の売上に入ります</span></>}</td>
                <td className="n">{yen(expOf(b))}</td>
                <td className="n">{yen(costOf(b))}</td>
                <td className="n"><input className={`n${manual[b.id] == null ? " auto-in" : ""}`} style={{ width: 110 }} inputMode="numeric" value={manual[b.id] ?? String(amt(b))} onChange={(e) => setManual((m) => ({ ...m, [b.id]: e.target.value }))} /></td>
              </tr>
            ))}
            <tr className="tot"><td colSpan={2}><b>この販売（1件）</b></td><td className="n">{yen(cost)}</td><td className="n"><b>{yen(t)}</b></td></tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13 }}>
        {ok ? <span className="up">分けた額の合計 {yen(sum)} ＝ 売れた金額 {yen(t)}</span>
          : t ? <span className="down">分けた額の合計 {yen(sum)} が、売れた金額 {yen(t)} と合っていません</span>
          : <span className="muted">売れた金額を入れてください</span>}
        <br />粗利 ＝ 売れた金額 {yen(t)} − 手数料 {yen(f)}{rl ? ` − 実送料 ${yen(rl)}` : ""} − 原価 {yen(cost)} ＝ <b className={profit >= 0 ? "up" : "down"}>{yen(profit)}</b>
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button className="btn" onClick={() => setManual({})}>自動の割り振りに戻す</button>
        <button className="btn" onClick={onClose}>閉じる</button>
        <button className="btn primary" disabled={!ok || pending} onClick={() => onSave({ channel: ch, date, total: t, fee: f, real: rl, parts: list.map((b) => ({ itemId: b.id, amount: amt(b) })) })}>記録する</button>
      </div>
    </Modal>
  );
}
