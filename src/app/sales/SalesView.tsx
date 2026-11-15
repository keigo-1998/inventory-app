"use client";
// 販売を記録（画面イメージ docs/mockup/index.html の「販売を記録」と同じ見た目・操作）
// 1件ずつ（スマホ向け）・まとめて入力（パソコン向け）・送料未定（本当の送料を入れて確定）・販路の設定
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordSales, cancelSales, fixShipping, unfixShipping, type SaleDone } from "@/lib/sale-actions";
import { calcSale, toNum, CUR_SIGN, type ChannelRule } from "@/lib/sale-calc";
import { yen } from "@/lib/format";
import { toast, esc } from "@/lib/toast";
import { ChannelSettings, type ChannelSetting } from "./ChannelSettings";
import { FxPanel, type FxMonth } from "./FxPanel";

export type StockItem = { id: number; code: string; name: string; unitCost: number; quantity: number; left: number; channels: string[] };
export type TodaySale = { id: number; label: string; channel: string; qty: number; priceJpy: number; profit: number | null; tentative: boolean; others: string[] };
export type TbdSale = { id: number; date: string; channel: string; label: string; real: number; profit: number; base: number };

const SPECIAL: Record<string, string> = { 廃棄: "捨てた（原価を損失として記録）", 備品にした: "会社で使う（売上に入れない）" };
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "");

/** 商品名か管理番号の一部で探す（在庫だけ）。スペースで区切ると複数の言葉で絞り込む */
function search(items: StockItem[], q: string) {
  const k = norm(q);
  if (!k) return [];
  const words = q.normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean).map(norm);
  return items
    .map((r) => {
      const name = norm(r.name), no = norm(r.code);
      let score = no.startsWith(k) ? 3 : name.startsWith(k) ? 2 : name.includes(k) || no.includes(k) ? 1 : 0;
      if (!score && words.length > 1 && words.every((w) => name.includes(w) || no.includes(w))) score = 1;
      return [score, r] as const;
    })
    .filter((x) => x[0])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 8)
    .map((x) => x[1]);
}

const delistText = (done: SaleDone[]) => {
  const l = done.filter((d) => d.others.length);
  return l.length ? `<br><span class="delist">⚠ ほかに出品中：${l.map((d) => `${esc(d.code)} → <b>${d.others.map(esc).join("・")}</b>`).join("、")} の出品を取り下げてください</span>` : "";
};

export function SalesView({ items, channels, rates, today, todayList, tbdList, settings, initialTab, fxMonths }: {
  items: StockItem[]; channels: ChannelRule[]; rates: { EUR: number | null; USD: number | null }; today: string; todayList: TodaySale[]; tbdList: TbdSale[];
  settings: ChannelSetting[]; initialTab?: string; fxMonths: FxMonth[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"one" | "many" | "tbd" | "ch" | "fx">(initialTab === "ch" || initialTab === "tbd" || initialTab === "many" || initialTab === "fx" ? initialTab : "one");
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [selId, setSelId] = useState<number | null>(null);
  const [ch, setCh] = useState(channels[0]?.name ?? "メルカリ");
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [ship, setShip] = useState("");
  const [fee, setFee] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [real, setReal] = useState("");
  const [tentative, setTentative] = useState(false);
  const [shipped, setShipped] = useState(false);
  const [tbdIn, setTbdIn] = useState<Record<number, string>>({});
  const qRef = useRef<HTMLInputElement>(null);
  const realRef = useRef<HTMLInputElement>(null);

  const sel = items.find((i) => i.id === selId) ?? null;
  const cands = useMemo(() => search(items, q), [items, q]);
  const special = SPECIAL[ch];
  const c = channels.find((x) => x.name === ch);
  const rate = !c ? 1 : c.currency === "JPY" ? 1 : rates[c.currency as "EUR" | "USD"] ?? 0;
  const sign = c ? CUR_SIGN[c.currency] : "円";
  const fx = !!c && c.currency !== "JPY";
  const multi = !!sel && sel.quantity > 1;
  const n = multi ? Math.max(1, Math.min(sel!.left, Math.floor(toNum(qty) || 1))) : 1;
  const cost = sel ? sel.unitCost * n : 0;
  const r = c ? calcSale(c, rate, { price: toNum(price), ship: toNum(ship), fee: toNum(fee), feeTouched, real: toNum(real), cost }) : null;
  const feeShown = r && r.feeAuto ? (c!.feeMode === "none" ? "0" : r.feeIn ? String(+r.feeIn.toFixed(2)) : "") : fee;
  const bad = [price, ship, fee, real].some((v) => Number.isNaN(toNum(v)));

  const pick = (it: StockItem | null) => { setSelId(it?.id ?? null); setQ(""); setHi(0); setQty("1"); if (!it) setTimeout(() => qRef.current?.focus(), 0); };
  const chooseCh = (name: string) => { setCh(name); setFeeTouched(false); setFee(""); };
  const resetForm = () => { setPrice(""); setShip(""); setFee(""); setReal(""); setFeeTouched(false); setTentative(false); setShipped(false); setQty("1"); setSelId(null); };

  const save = () => {
    if (!sel) { toast("売れた商品を選んでください"); qRef.current?.focus(); return; }
    if (bad) { toast("数字でないところがあります"); return; }
    start(async () => {
      const res = await recordSales([{
        itemId: sel.id, channel: ch, date, qty: n, price: toNum(price), ship: toNum(ship), fee: toNum(fee), feeTouched,
        real: toNum(real) == null ? null : Math.round(toNum(real)!), tentative: !special && tentative, shipped,
      }]);
      if (!res.ok) { toast(`<span style="color:#fca5a5">記録できませんでした</span>：${esc(res.error)}`); return; }
      const d = res.done[0];
      resetForm();
      router.refresh();
      const msg = d.left != null && d.left > 0
        ? `${esc(d.code)} ${esc(d.name)} を ${d.qty}個 記録しました。在庫は 残り${d.left}個 です（出品はそのまま）`
        : `${esc(d.code)} ${esc(d.name)} を記録しました。商品一覧で「${special ? (ch === "廃棄" ? "廃棄" : "備品") : multi ? "売り切れ（売却済み）" : "売却済み"}」になりました${delistText(res.done)}`;
      toast(msg, async () => { await cancelSales([d.saleId], "販売の記録を元に戻す"); router.refresh(); return "取り消しました。商品は元の状態（在庫・出品中）に戻りました"; });
    });
  };

  const cancelOne = (h: TodaySale) => {
    if (!confirm(`${h.label} の「${h.channel}」の記録を取り消しますか？\n商品は元の状態に戻ります。`)) return;
    start(async () => { const res = await cancelSales([h.id]); router.refresh(); toast(res.ok ? `${esc(h.label.split(" ")[0])} の記録を取り消しました` : esc(res.error ?? "取り消せませんでした")); });
  };

  const fix = (s: TbdSale) => {
    const v = toNum(tbdIn[s.id] ?? String(s.real));
    if (v == null || Number.isNaN(v) || v < 0) { toast("送料を0以上の数字で入れてください"); return; }
    start(async () => {
      const res = await fixShipping(s.id, Math.round(v));
      if (!res.ok) { toast(esc(res.error ?? "確定できませんでした")); return; }
      router.refresh();
      toast(`${esc(s.label.split(" ")[0])} の送料を ${yen(v)} で確定しました。粗利 ${yen(s.base - v)}`, async () => { await unfixShipping(s.id, res.before!); router.refresh(); return "取り消しました。仮の送料に戻しました"; });
    });
  };

  const line = (l: string, v: number, raw: number | null) => (
    <tr><td>{l}{fx && raw != null && <><br /><small className="muted">{sign}{raw} × {rate}円</small></>}</td><td className="n">{yen(v)}</td></tr>
  );

  return (
    <section>
      <h1>販売を記録</h1>
      <p className="lead">
        売れた商品の売値・手数料・送料を入れると、粗利が自動で出ます。為替レート：<b>1€ = {rates.EUR ?? "—"}円</b>、<b>1$ = {rates.USD?.toFixed(2) ?? "—"}円</b>{" "}
        <span className="tag t-temp">今月・仮</span> <span className="muted">（月初のTTM。月末に平均TTMで確定）</span>
      </p>
      <div className="pills">
        <button className={`pill${tab === "one" ? " on" : ""}`} onClick={() => setTab("one")}>1件ずつ（スマホ向け）</button>
        <button className={`pill${tab === "many" ? " on" : ""}`} onClick={() => setTab("many")}>まとめて入力（パソコン向け）</button>
        <button className={`pill${tab === "tbd" ? " on" : ""}`} onClick={() => setTab("tbd")}>送料未定 <span className="countbadge">{tbdList.length}</span></button>
        <button className={`pill${tab === "fx" ? " on" : ""}`} onClick={() => setTab("fx")}>為替レート{fxMonths.some((m) => m.ended && m.finalCount < m.sales) && <> <span className="countbadge">!</span></>}</button>
        <button className={`pill${tab === "ch" ? " on" : ""}`} onClick={() => setTab("ch")}>販路の設定</button>
      </div>

      {tab === "one" && (
        <div className="grid two">
          <div className="card form">
            <label className="f" style={{ position: "relative" }}>
              <span>売れた商品</span>
              {!sel && (
                <input
                  ref={qRef}
                  value={q}
                  placeholder="商品名か管理番号で探す（例：オリンパス）"
                  autoComplete="off"
                  onChange={(e) => { setQ(e.target.value); setHi(0); }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(cands.length - 1, h + 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
                    else if (e.key === "Enter" && cands[hi]) { e.preventDefault(); pick(cands[hi]); }
                  }}
                />
              )}
              {!sel && q.trim() && (
                <div className="sugg" style={{ display: "block", position: "absolute", top: "100%", left: 0, right: 0 }}>
                  {cands.length ? cands.map((it, i) => (
                    <div key={it.id} className={`sg${i === hi ? " on" : ""}`} data-i={i} onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
                      <span className="muted">{it.code}</span> {it.name}
                      <br /><small className="muted">原価 {yen(it.unitCost)}{it.quantity > 1 ? `・残り${it.left}個` : ""}{it.channels.length ? `・${it.channels.join("・")}` : ""}</small>
                    </div>
                  )) : <div className="sg none">在庫に当てはまる商品がありません</div>}
                </div>
              )}
            </label>
            <div className={`itembox${sel ? " picked" : " muted"}`}>
              {sel ? (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <span className="muted">{sel.code}</span><br /><b>{sel.name}</b><br />
                    原価 {yen(sel.unitCost)}{multi && <>（1個あたり）・<b>在庫 残り{sel.left}個</b>／{sel.quantity}個</>}{sel.channels.length ? `・出品先 ${sel.channels.join("・")}` : ""}
                  </div>
                  <button className="linkbtn" onClick={() => pick(null)}>変更</button>
                </div>
              ) : "商品名か管理番号の一部を入れると、候補が出ます"}
            </div>

            <div className="f"><span>売り先</span>
              <div className="chips">
                {channels.map((x) => <button key={x.name} className={`chipbtn${x.name === ch ? " on" : ""}`} onClick={() => chooseCh(x.name)}>{x.name}{x.undecided && <small> 未定</small>}</button>)}
                {Object.keys(SPECIAL).map((k) => <button key={k} className={`chipbtn sp${k === ch ? " on" : ""}`} onClick={() => chooseCh(k)}>{k}</button>)}
              </div>
            </div>

            <label className="f"><span>売却日</span><input value={date} onChange={(e) => setDate(e.target.value)} /></label>
            {!special && c && (
              <>
                {multi && <label className="f"><span>個数 <small className="muted">（在庫 残り{sel!.left}個）</small></span><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
                <label className="f"><span>{multi && n > 1 ? `売値（${n}個の合計）` : "売値"} <b className="cur">（{sign}）</b></span><input inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
                {c.usesShippingFee && <label className="f"><span>設定送料（お客様からもらう送料） <b className="cur">（{sign}）</b></span><input inputMode="decimal" placeholder="0" value={ship} onChange={(e) => setShip(e.target.value)} /></label>}
                <label className="f">
                  <span>手数料 <b className="cur">（{sign}）</b></span>
                  <input inputMode="decimal" placeholder="0" value={feeShown} readOnly={c.feeMode === "none"} className={r?.feeAuto ? "auto-in" : ""} onChange={(e) => { setFee(e.target.value); setFeeTouched(e.target.value !== ""); }} />
                  <small className="hint">
                    {r?.warn ? <span className="down">⚠ {r.warn}</span>
                      : c.feeMode === "auto" ? `売値の${+((c.feeRate ?? 0) * 100).toFixed(2)}%で自動で入れました（手で直せます）`
                      : c.feeMode === "none" ? "この販路は手数料なし"
                      : c.undecided ? `${c.name}の手数料の決まりはまだ決めていません`
                      : c.feeHintRate ? `毎回入力。目安：いつもは売値の約${(c.feeHintRate * 100).toFixed(1)}%${toNum(price) ? `（${sign}${((toNum(price) || 0) * c.feeHintRate).toFixed(fx ? 2 : 0)}前後）` : ""}` : "毎回入力"}
                  </small>
                </label>
                <div className="f">
                  <span>{tentative ? "実送料（仮の金額・円）" : "実送料（実際にかかった送料・円）"}</span>
                  <div className="realrow">
                    <input ref={realRef} inputMode="numeric" placeholder={tentative ? "仮の送料（だいたいの金額）" : "0"} className={tentative ? "tmp-in" : ""} value={real} onChange={(e) => setReal(e.target.value)} />
                    <button type="button" className={`chipbtn tbdbtn${tentative ? " on" : ""}`} onClick={() => { setTentative((t) => !t); realRef.current?.focus(); }}>{tentative ? "✓ 未定" : "未定"}</button>
                  </div>
                  <small className="hint">{tentative ? "だいたいの送料を仮に入れておくと、その金額で粗利を計算します。本当の送料が分かったら「送料未定」タブで直します" : "まだ分からないときは「未定」を押して、仮の金額を入れます。あとで「送料未定」タブで直せます"}</small>
                </div>
                <label className="chk"><input type="checkbox" checked={shipped} onChange={(e) => setShipped(e.target.checked)} /> 発送済み</label>
              </>
            )}
            <button className="btn primary big" disabled={pending} onClick={save}>{special ? `「${ch}」として記録する` : "記録する"}</button>
          </div>

          <div>
            <div className="card">
              <h2>計算の内訳</h2>
              <table className="calc">
                <tbody>
                  {special ? (
                    <>
                      <tr><td>原価</td><td className="n">{yen(cost)}</td></tr>
                      <tr className="tot"><td>{ch === "廃棄" ? "損失" : "売上・粗利"}</td><td className={`n ${ch === "廃棄" ? "down" : ""}`}>{ch === "廃棄" ? "−" + yen(cost) : "集計に入れません"}</td></tr>
                    </>
                  ) : r && c ? (
                    <>
                      {line("売値（円）", r.priceY, toNum(price) || 0)}
                      {c.usesShippingFee && line("＋ 設定送料（円）", r.shipY, toNum(ship) || 0)}
                      <tr><td>− 実送料{tentative && <> <span className="tag t-temp">仮</span></>}</td><td className="n">{yen(r.realY)}</td></tr>
                      {line("− 手数料（円）", r.feeY, +(+r.feeIn).toFixed(2))}
                      <tr><td>− 原価{n > 1 && <><br /><small className="muted">{yen(sel!.unitCost)} × {n}個</small></>}</td><td className="n">{yen(cost)}</td></tr>
                      <tr className="tot"><td>粗利</td><td className={`n ${r.profit >= 0 ? "up" : "down"}`}>{yen(r.profit)}</td></tr>
                    </>
                  ) : null}
                </tbody>
              </table>
              <p className="muted" style={{ margin: "8px 0 0" }}>{special ? SPECIAL[ch] : fx ? "為替は今月の仮レートです。月末に平均TTMで計算し直します（月末の確定はこれから作ります）。" : ""}</p>
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h2>今日記録した販売</h2>
              <ul className="list">
                {todayList.length ? todayList.map((h) => (
                  <li key={h.id}>
                    <span>
                      {h.label}<br />
                      <span className="muted">{h.channel}{h.qty > 1 ? `・${h.qty}個` : ""}{h.profit != null && h.channel !== "廃棄" ? `・売値 ${yen(h.priceJpy)}` : ""}{h.tentative ? "・送料は仮" : ""}</span>
                      {h.others.length > 0 && <><br /><span className="delist">⚠ {h.others.join("・")} の出品を取り下げてください</span></>}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      {h.profit != null && <><span className={`n ${h.profit >= 0 ? "up" : "down"}`}>{yen(h.profit)}</span><br /></>}
                      <button className="linkbtn" disabled={pending} onClick={() => cancelOne(h)}>取り消す</button>
                    </span>
                  </li>
                )) : <li className="muted">まだありません</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {tab === "ch" && <ChannelSettings list={settings} />}
      {tab === "fx" && <FxPanel months={fxMonths} />}
      {tab === "many" && <BatchEntry items={items} channels={channels} rates={rates} today={today} />}

      {tab === "tbd" && (
        <div>
          <p className="muted" style={{ margin: "0 0 10px" }}>「送料未定」で記録した販売の一覧です。今は仮の送料で粗利を計算しています。本当の送料が分かったら、ここで入れて「確定」を押してください。粗利が計算し直され、一覧から消えます。</p>
          {tbdList.length ? (
            <div className="card tablewrap" style={{ padding: "4px 8px" }}>
              <table>
                <thead><tr><th>売却日</th><th>商品</th><th>販路</th><th className="n">仮の送料</th><th className="n">仮の粗利</th><th>本当の送料（円）</th><th></th></tr></thead>
                <tbody>
                  {tbdList.map((s) => {
                    const v = toNum(tbdIn[s.id] ?? "");
                    return (
                      <tr key={s.id}>
                        <td>{s.date}</td><td>{s.label}</td><td>{s.channel}</td>
                        <td className="n">{yen(s.real)} <span className="tag t-temp">仮</span></td>
                        <td className={`n ${s.profit >= 0 ? "up" : "down"}`}>{yen(s.profit)}{v != null && !Number.isNaN(v) && <><br /><span className="auto-txt">→ {yen(s.base - v)}</span></>}</td>
                        <td><input className="n" style={{ width: 110, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", font: "inherit" }} inputMode="numeric" placeholder={String(s.real)} value={tbdIn[s.id] ?? ""} onChange={(e) => setTbdIn((m) => ({ ...m, [s.id]: e.target.value }))} /></td>
                        <td><button className="btn primary" disabled={pending} onClick={() => fix(s)}>確定</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">送料が仮のままの販売はありません。</p>}
        </div>
      )}
    </section>
  );
}

// ---------- まとめて入力（パソコン向け）：通知を見ながら1行に1件ずつ入れて、まとめて記録する ----------
type MRow = { key: number; itemId: number | null; q: string; ch: string; date: string; price: string; ship: string; fee: string; ft: boolean; real: string; tbd: boolean };
let mKey = 1;
const newRow = (today: string, ch = "メルカリ"): MRow => ({ key: mKey++, itemId: null, q: "", ch, date: today, price: "", ship: "", fee: "", ft: false, real: "", tbd: false });

function BatchEntry({ items, channels, rates, today }: { items: StockItem[]; channels: ChannelRule[]; rates: { EUR: number | null; USD: number | null }; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<MRow[]>(() => Array.from({ length: 6 }, () => newRow(today)));
  const [focus, setFocus] = useState<{ key: number; hi: number } | null>(null);
  const set = (key: number, patch: Partial<MRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rateOf = (c: ChannelRule) => (c.currency === "JPY" ? 1 : rates[c.currency as "EUR" | "USD"] ?? 0);

  const calc = (m: MRow) => {
    const it = items.find((i) => i.id === m.itemId);
    const c = channels.find((x) => x.name === m.ch)!;
    const r = calcSale(c, rateOf(c), { price: toNum(m.price), ship: toNum(m.ship), fee: toNum(m.fee), feeTouched: m.ft, real: toNum(m.real), cost: it ? it.unitCost : 0 });
    return { it, c, r };
  };
  const valid = rows.filter((m) => m.itemId && toNum(m.price) != null && !Number.isNaN(toNum(m.price)) && ![m.ship, m.fee, m.real].some((v) => Number.isNaN(toNum(v))));
  const total = valid.reduce((a, m) => a + calc(m).r.profit, 0);

  const save = () => {
    if (!valid.length) { toast("記録できる行がありません（商品と売値を入れてください）"); return; }
    start(async () => {
      const res = await recordSales(valid.map((m) => ({
        itemId: m.itemId!, channel: m.ch, date: m.date, qty: 1, price: toNum(m.price), ship: toNum(m.ship), fee: toNum(m.fee), feeTouched: m.ft,
        real: toNum(m.real) == null ? null : Math.round(toNum(m.real)!), tentative: m.tbd, shipped: false,
      })), "販売を記録（まとめて入力）");
      if (!res.ok) { toast(`<span style="color:#fca5a5">記録できませんでした</span>：${esc(res.error)}`); return; }
      const keys = new Set(valid.map((m) => m.key));
      setRows((rs) => { const left = rs.filter((r) => !keys.has(r.key)); while (left.length < 6) left.push(newRow(today)); return left; });
      router.refresh();
      const ids = res.done.map((d) => d.saleId);
      toast(`${res.done.length}件を記録しました。商品一覧で「売却済み」になりました${delistText(res.done)}`, async () => { await cancelSales(ids, "まとめて入力を元に戻す"); router.refresh(); return "取り消しました。商品は元の状態（在庫・出品中）に戻りました"; });
    });
  };

  const inp = (style?: React.CSSProperties) => ({ style: { width: "100%", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px", font: "inherit", ...style } });

  return (
    <div>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        通知を見ながら1行ずつ入れていきます。商品名の一部（例：「オリン」）や管理番号で探せます。実送料がまだ分からないときは「未定」を押して仮の金額を入れます（「未定 800」「仮 800」と打ってもOK）。あとで「送料未定」タブで直せます。
      </p>
      <div className="card tablewrap" style={{ padding: "4px 8px" }}>
        <table>
          <thead><tr><th style={{ width: 28 }}></th><th style={{ minWidth: 280 }}>商品（商品名・管理番号で探す）</th><th>売り先</th><th>売却日</th><th className="n">売値</th><th className="n">設定送料</th><th className="n">手数料</th><th className="n">実送料（円）</th><th className="n">粗利（円）</th></tr></thead>
          <tbody>
            {rows.map((m, i) => {
              const { it, c, r } = calc(m);
              const sign = CUR_SIGN[c.currency];
              const cands = focus?.key === m.key ? search(items.filter((x) => !rows.some((o) => o.key !== m.key && o.itemId === x.id)), m.q) : [];
              const feeVal = r.feeAuto ? (c.feeMode === "none" ? "0" : r.feeIn ? String(+r.feeIn.toFixed(2)) : "") : m.fee;
              return (
                <tr key={m.key}>
                  <td className="muted">{i + 1}</td>
                  <td style={{ position: "relative" }}>
                    {it ? (
                      <div className="picked-cell"><span className="muted">{it.code}</span> {it.name}<button className="linkbtn" onClick={() => set(m.key, { itemId: null })}>変更</button></div>
                    ) : (
                      <>
                        <input {...inp()} value={m.q} placeholder="例：オリンパス、0120"
                          onFocus={() => setFocus({ key: m.key, hi: 0 })} onBlur={() => setTimeout(() => setFocus((f) => (f?.key === m.key ? null : f)), 150)}
                          onChange={(e) => { set(m.key, { q: e.target.value }); setFocus({ key: m.key, hi: 0 }); }}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || !focus) return;
                            if (e.key === "ArrowDown") { e.preventDefault(); setFocus({ key: m.key, hi: Math.min(cands.length - 1, focus.hi + 1) }); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setFocus({ key: m.key, hi: Math.max(0, focus.hi - 1) }); }
                            else if (e.key === "Enter" && cands[focus.hi]) { e.preventDefault(); set(m.key, { itemId: cands[focus.hi].id, q: "" }); setFocus(null); }
                          }} />
                        {m.q.trim() && focus?.key === m.key && (
                          <div className="sugg" style={{ display: "block", position: "absolute", top: "100%", left: 0, minWidth: 320 }}>
                            {cands.length ? cands.map((x, k) => (
                              <div key={x.id} className={`sg${k === focus.hi ? " on" : ""}`} data-i={k} onMouseDown={(e) => { e.preventDefault(); set(m.key, { itemId: x.id, q: "" }); setFocus(null); }}>
                                <span className="muted">{x.code}</span> {x.name}<br /><small className="muted">原価 {yen(x.unitCost)}{x.channels.length ? `・${x.channels.join("・")}` : ""}</small>
                              </div>
                            )) : <div className="sg none">在庫に当てはまる商品がありません</div>}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td><select {...inp({ width: 110 })} value={m.ch} onChange={(e) => set(m.key, { ch: e.target.value, ft: false, fee: "" })}>{channels.map((x) => <option key={x.name}>{x.name}</option>)}</select></td>
                  <td><input {...inp({ width: 100 })} value={m.date} onChange={(e) => set(m.key, { date: e.target.value })} /></td>
                  <td><div className="cin"><input {...inp({ width: 90, textAlign: "right" })} value={m.price} onChange={(e) => set(m.key, { price: e.target.value })} /><i>{sign}</i></div></td>
                  <td>{c.usesShippingFee ? <div className="cin"><input {...inp({ width: 80, textAlign: "right" })} value={m.ship} onChange={(e) => set(m.key, { ship: e.target.value })} /><i>{sign}</i></div> : <span className="muted" style={{ padding: "0 8px" }}>なし</span>}</td>
                  <td className={r.warn ? "warn2" : ""} title={r.warn}><div className="cin"><input {...inp({ width: 80, textAlign: "right" })} className={r.feeAuto ? "auto-in" : ""} value={feeVal} onChange={(e) => set(m.key, { fee: e.target.value, ft: e.target.value !== "" })} /><i>{sign}</i></div></td>
                  <td>
                    <div className="tbdcell">
                      {m.tbd && <span className="tag t-temp" title="送料未定。仮の金額で計算します">仮</span>}
                      <input {...inp({ width: 90, textAlign: "right" })} className={m.tbd ? "tmp-in" : ""} value={m.real} placeholder={m.tbd ? "仮の金額" : "0"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^\s*(未定|仮)/.test(v)) set(m.key, { tbd: true, real: v.replace(/^\s*(未定|仮)[\s:：]*/, "") }); // 「未定」と打っても（貼り付けても）未定にする
                          else set(m.key, { real: v });
                        }} />
                      <button className="mini" title={m.tbd ? "未定をやめる（この金額で確定）" : "送料がまだ分からない"} onClick={() => set(m.key, { tbd: !m.tbd })}>{m.tbd ? "確定" : "未定"}</button>
                    </div>
                  </td>
                  <td className={`n ${r.profit >= 0 ? "up" : "down"}`} style={{ padding: "0 8px", fontWeight: 600 }}>{it && m.price ? yen(r.profit) : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sheet-tools">
        <button className="btn" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 5 }, () => newRow(today))])}>＋ 5行追加</button>
        <span className="legend2"><i className="sw auto"></i>自動で入ったマス　<i className="sw warn2"></i>いつもと違う手数料</span>
      </div>
      <div className="card regbar">
        <b>{valid.length}件　粗利の合計 <span className={total >= 0 ? "up" : "down"}>{yen(total)}</span></b>
        <button className="btn primary" disabled={pending || !valid.length} onClick={save}>まとめて記録する</button>
      </div>
    </div>
  );
}
