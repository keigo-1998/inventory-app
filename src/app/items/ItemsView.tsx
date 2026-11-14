"use client";
// 商品一覧の画面（画面イメージ docs/mockup/index.html の「商品一覧」と同じ見た目・操作）
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { changeListings, undoListings, type ListingUndo } from "@/lib/listing-actions";
import { yen } from "@/lib/format";

export type SaleInfo = {
  date: string; channel: string; currency: string; fxRate: number | null; fxRateFinal: boolean;
  priceForeign: number | null; shippingForeign: number | null; feeForeign: number | null;
  priceJpy: number; shippingFeeJpy: number; actualShippingJpy: number; shippingTentative: boolean; feeJpy: number;
  costJpy: number; lineCount: number;
};
export type ItemRow = {
  id: number; code: string; name: string; genre: string; purchasedAt: string;
  unitCost: number; expectedPrice: number | null; quantity: number; left: number;
  status: string; channels: string[]; soldChannels: string[]; days: number | null;
  lotCode: string | null; lotCostMode: string | null; sale: SaleInfo | null;
};
export type ChannelInfo = {
  id: number; name: string; currency: string; feeMode: string; feeRate: number | null; feeHintRate: number | null;
  usesShippingFee: boolean; undecided: boolean;
};
export type LotInfo = { code: string; name: string; totalCost: number };

const ST: Record<string, [string, string]> = {
  stock: ["未出品", "t-stock"], list: ["出品中", "t-list"], sold: ["売却済み", "t-sold"], disposed: ["廃棄", "t-warn"], fixture: ["備品", "t-stock"],
};
const inStock = (r: ItemRow) => r.status === "stock" || r.status === "list";
const isLotHead = (r: ItemRow) => !!r.lotCode && r.code.endsWith("-0");

// ひらがな・カタカナ、全角・半角、大文字・小文字、空白の違いを気にせずに探す
const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "");

// 絞り込み（docs/data-design.md「商品一覧の絞り込みと状態」）。「在庫」は未出品＋出品中
const FILTERS: [string, string, (r: ItemRow) => boolean][] = [
  ["all", "すべて", () => true],
  ["now", "在庫", inStock],
  ["stock", "未出品", (r) => r.status === "stock"],
  ["list", "出品中", (r) => r.status === "list"],
  ["sold", "売却済み", (r) => !inStock(r)],
  ["lot", "山", isLotHead],
  ["old", "90日以上", (r) => inStock(r) && (r.days ?? 0) >= 90],
];

function Chips({ r }: { r: ItemRow }) {
  if (!r.channels.length && !r.soldChannels.length) return <span className="muted">未出品</span>;
  return (
    <>
      {r.soldChannels.map((c) => <span key={"s" + c} className="chip sold">{c}</span>)}
      {r.channels.map((c) => <span key={c} className="chip">{c}</span>)}
    </>
  );
}
const Days = ({ d }: { d: number | null }) => (d == null ? <span className="muted">—</span> : d >= 90 ? <span className="tag t-warn">{d}日</span> : <>{d}日</>);

type Toast = { msg: React.ReactNode; undo?: () => Promise<void> } | null;

export function ItemsView({ rows, channels, lots, genres }: { rows: ItemRow[]; channels: ChannelInfo[]; lots: LotInfo[]; genres: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [invF, setInvF] = useState("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [chFilter, setChFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [toastKey, setToastKey] = useState(0);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const lotOf = (r: ItemRow) => (r.lotCode && rows.some((x) => x.code === `${r.lotCode}-0`) ? r.lotCode : null);
  const lotHasBranches = (code: string) => rows.some((x) => x.lotCode === code && !x.code.endsWith("-0"));
  const listChannels = channels.filter((c) => !c.undecided);

  // 山（-0）の行のすぐ下に、その山の枝番を並べる。山の行は、枝番のどれかが当てはまれば見出しとして出す
  const list = useMemo(() => {
    const f = FILTERS.find((x) => x[0] === invF)![2];
    const k = norm(q);
    const kw = (r: ItemRow) => (!k || norm(r.code + r.name).includes(k)) && (!genre || r.genre === genre) && (!chFilter || r.channels.includes(chFilter) || r.soldChannels.includes(chFilter));
    const bn = (code: string) => (code.endsWith("-0") ? -1 : Number(code.split("-")[1]));
    const out: ItemRow[] = [];
    const done = new Set<string>();
    for (const r of rows) {
      const p = lotOf(r);
      if (!p) { if (invF !== "lot" && f(r) && kw(r)) out.push(r); continue; }
      if (done.has(p)) continue;
      done.add(p);
      const grp = rows.filter((x) => lotOf(x) === p).sort((a, b) => bn(a.code) - bn(b.code));
      const [head, ...kids] = grp;
      if (invF === "lot") { if (grp.some(kw)) out.push(...grp); continue; }
      const hk = kids.filter((x) => f(x) && kw(x));
      if ((f(head) && kw(head)) || hk.length) out.push(head, ...hk);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, invF, q, genre, chFilter]);

  const rowCls = (r: ItemRow) => {
    const p = lotOf(r);
    return [p ? (r.code.endsWith("-0") ? "lotrow" : "brrow") : "", flash.has(r.code) ? "flash" : ""].join(" ");
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
  const flashCodes = (codes: string[]) => { setFlash(new Set(codes)); setTimeout(() => setFlash(new Set()), 2500); };

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

  return (
    <section>
      <h1>商品一覧</h1>
      <p className="lead">
        全 {rows.length.toLocaleString()} 点（在庫 {inStockCount.toLocaleString()} 点）。出品先を変えたいときは、商品にチェックを入れて「出品先を変える」を押します。
        <br />
        <span className="muted">商品を押すと、いくら利益が出ているかが見られます。<span className="tag t-yama">山 ▸</span> の行を押すと山の画面が開き、枝番を追加できます。まとめて売るは、これから作ります。</span>
      </p>
      {error && <p className="err">{error}</p>}
      <div className="filters">
        <input
          placeholder="管理番号・商品名で検索"
          value={qInput}
          onChange={(e) => { setQInput(e.target.value); if (!e.target.value) setQ(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) setQ(qInput); }}
          style={{ flex: 1 }}
        />
        <button className="btn primary" onClick={() => setQ(qInput)}>🔍 検索</button>
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">ジャンル：すべて</option>
          {genres.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={chFilter} onChange={(e) => setChFilter(e.target.value)}>
          <option value="">出品先：すべて</option>
          {channels.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="pills">
        {FILTERS.map(([k, l]) => (
          <button key={k} className={`pill${k === invF ? " on" : ""}`} onClick={() => setInvF(k)}>{l}</button>
        ))}
      </div>

      <div className="card tablewrap pc" style={{ padding: "4px 8px" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}></th><th>管理番号</th><th>商品名</th><th>ジャンル</th><th>仕入日</th>
              <th className="n">原価</th><th className="n">予想売価</th><th>状態</th><th>出品先</th><th className="n">滞留</th>
            </tr>
          </thead>
          <tbody id="itemrows">
            {!list.length && <tr><td colSpan={10} className="muted" style={{ padding: 16 }}>当てはまる商品はありません</td></tr>}
            {list.map((r) => (
              <tr key={r.id} className={`clickable ${rowCls(r)}`} onClick={() => openRowOf(r)}>
                <td onClick={(e) => e.stopPropagation()}>
                  {inStock(r) && <input type="checkbox" checked={picked.has(r.code)} onChange={(e) => togglePick(r.code, e.target.checked)} />}
                </td>
                <td>{r.code}</td>
                <td><span className="nm">{r.name}</span><QtyTag r={r} /></td>
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

      {picked.size > 0 && (
        <div className="pickbar" style={{ display: "flex" }}>
          <b>{picked.size}点を選んでいます</b>
          <button className="btn" onClick={() => setPicked(new Set())}>選択を外す</button>
          <button className="btn" onClick={() => setBulkOpen(true)}>出品先を変える</button>
          <button className="btn primary" disabled title="これから作ります">まとめて売る</button>
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

function ItemDialog({ r, channels, listChannels, lot, pending, toast, onClose, onToggle }: {
  r: ItemRow; channels: ChannelInfo[]; listChannels: ChannelInfo[]; lot: LotInfo | null; pending: boolean; toast: React.ReactNode;
  onClose: () => void; onToggle: (ch: ChannelInfo, on: boolean) => void;
}) {
  const st = ST[r.status];
  let body: React.ReactNode;
  if (r.status === "sold" && r.sale) {
    const s = r.sale;
    const profit = s.priceJpy + s.shippingFeeJpy - s.actualShippingJpy - s.feeJpy - s.costJpy; // docs/profit-formulas.md
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
            <tr className="tot"><td>粗利</td><td className={`n ${profit >= 0 ? "up" : "down"}`}>{yen(profit)}</td></tr>
          </tbody>
        </table>
      </>
    );
  } else if (r.status === "sold") {
    body = <p className="muted">売れた記録の詳しい内訳はありません。</p>;
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
      {body}
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
      {toast}
    </Modal>
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
