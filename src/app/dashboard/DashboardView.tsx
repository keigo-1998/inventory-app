"use client";
// ダッシュボード（ECの売上・粗利・売上目標、在庫、山の回収）
// グラフの色：売上＝青、粗利＝オレンジ（色の見分けにくい人でも区別できる組み合わせを確かめ済み）。目標は点線
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setTarget, type TargetKind } from "@/lib/target-actions";
import { toast, esc } from "@/lib/toast";

type Month = { month: string; sales: number; profit: number; n: number; target: number | null; profitTarget: number | null };
type Day = { day: number; sales: number; profit: number; n: number };
export type DashData = {
  now: string; today: string;
  monthly: Month[];
  daily: Day[];
  channels: { name: string; sales: number; profit: number; n: number }[];
  genres: { name: string; sales: number; profit: number; n: number }[];
  inventory: { n: number; value: number; exp: number; listed: number; aging: { label: string; n: number; value: number }[] };
  lots: { code: string; name: string; cost: number; sold: number; rate: number; branches: number; soldBranches: number; days: number }[];
  alerts: { tbd: number; fxPending: number; reportDraft: string | null };
  futureTargets: { month: string; target: number | null; profitTarget: number | null }[];
};

const SALES = "#2a78d6", PROFIT = "#eb6834", INK = "#1d2330";
const yen = (v: number) => (v < 0 ? "−" : "") + "¥" + Math.abs(Math.round(v)).toLocaleString();
const man = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(Math.abs(v) >= 1000000 ? 0 : 1)}万` : Math.round(v).toLocaleString());
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const label = (m: string) => `${Number(m.slice(5))}月`;
const fullLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

/** 目標の進み具合（棒・今日までの目安の線・あといくら） */
function Progress({ value, target, pace, color, name }: { value: number; target: number | null; pace: number | null; color: string; name: string }) {
  if (!target) return null;
  return (
    <>
      <div className="dash-prog" title={`${name}目標 ${yen(target)}`}>
        <i style={{ width: `${Math.max(0, Math.min(100, (value / target) * 100))}%`, background: color }} />
        {pace != null && <b style={{ left: `${Math.min(100, (pace / target) * 100)}%` }} title="今日までの目安" />}
      </div>
      <div className="d">{name}目標 {yen(target)} の <b>{pct(value, target)}</b>
        {pace != null && <span className="muted">（今日までの目安 {yen(pace)} に{value >= pace ? <b className="up"> 届いています</b> : <b className="down"> あと {yen(pace - value)}</b>}）</span>}</div>
    </>
  );
}

export function DashboardView({ data }: { data: DashData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editTargets, setEditTargets] = useState(false);
  const [view, setView] = useState<"month" | "year">("month"); // グラフ：今月（日ごと）がはじめ
  const cur = data.monthly[data.monthly.length - 1];
  const days = data.daily.length;
  const day = Number(data.today.slice(8));
  const forecast = day ? (cur.sales / day) * days : 0; // 着地見込み（今のペースで月末まで売れた場合）
  const forecastP = day ? (cur.profit / day) * days : 0;
  const pace = cur.target ? (cur.target * day) / days : null; // 今日までの目安
  const paceP = cur.profitTarget ? (cur.profitTarget * day) / days : null;

  const saveTarget = (month: string, kind: TargetKind, v: string) => {
    const t = v.normalize("NFKC").replace(/[¥,円\s]/g, "");
    const n = t === "" ? null : t.endsWith("万") ? Math.round(Number(t.slice(0, -1)) * 10000) : Number(t);
    if (n != null && (!Number.isInteger(n) || n < 0)) { toast("目標は円の整数で入れてください（例：3000000 または 300万）"); return; }
    const row = data.futureTargets.find((x) => x.month === month);
    const old = (kind === "sales" ? row?.target : row?.profitTarget) ?? null;
    if (old === n) return;
    const name = kind === "sales" ? "売上目標" : "粗利目標";
    start(async () => {
      const r = await setTarget(month, kind, n);
      if (!r.ok) { toast(esc(r.error ?? "")); return; }
      router.refresh();
      toast(`${fullLabel(month)}の${name}を${n == null ? "消しました" : `${yen(n)}にしました`}`, async () => { await setTarget(month, kind, r.before ?? null); router.refresh(); return "元に戻しました"; });
    });
  };

  const alerts = [
    data.alerts.reportDraft && { href: `/report?m=${data.alerts.reportDraft}`, text: `${fullLabel(data.alerts.reportDraft)}の月次レポートがまだ確定していません（翌月10日まで）` },
    data.alerts.tbd > 0 && { href: "/sales?tab=tbd", text: `送料が仮のままの販売が ${data.alerts.tbd}件 あります` },
    data.alerts.fxPending > 0 && { href: "/sales?tab=fx", text: `為替がまだ仮の販売が ${data.alerts.fxPending}件 あります（終わった月）` },
  ].filter(Boolean) as { href: string; text: string }[];
  const noTarget = !cur.target && !cur.profitTarget;

  return (
    <section>
      <h1>ダッシュボード</h1>
      <p className="lead">ECの売上・粗利と、目標の進み具合です。売上 ＝ 売値＋設定送料（月次レポートと同じ計算。返品・返金はあった日に引きます）。経費・固定費はfreeeで見ます。</p>

      {alerts.length > 0 && (
        <div className="dash-alerts">
          {alerts.map((a) => <Link key={a.href} href={a.href} className="dash-alert">⚠ {a.text} →</Link>)}
        </div>
      )}

      <div className="sec dash-sechead">
        <span>{fullLabel(data.now)}（{day}日まで・あと{days - day}日）</span>
        <button className="linkbtn" onClick={() => setEditTargets(!editTargets)}>{editTargets ? "閉じる" : "目標を入れる・直す"}</button>
      </div>
      {editTargets && (
        <div className="card dash-targets">
          <span className="muted">ECの売上目標（売値＋設定送料）と粗利目標（円）。「300万」のようにも入れられます。空にすると消えます。</span>
          <div className="dash-tgrid">
            {data.futureTargets.map((t) => (
              <div key={t.month} className="dash-tcell">
                <b>{fullLabel(t.month)}</b>
                <label className="f">売上目標
                  <input className="inp n" inputMode="numeric" key={`s-${t.month}-${t.target}`} defaultValue={t.target ?? ""} placeholder="例：300万" disabled={pending}
                    onBlur={(e) => saveTarget(t.month, "sales", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                </label>
                <label className="f">粗利目標
                  <input className="inp n" inputMode="numeric" key={`p-${t.month}-${t.profitTarget}`} defaultValue={t.profitTarget ?? ""} placeholder="例：80万" disabled={pending}
                    onBlur={(e) => saveTarget(t.month, "profit", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid dash-kpis">
        <div className="kpi">
          <div className="l">売上</div>
          <div className="v">{yen(cur.sales)}</div>
          {cur.target ? <Progress value={cur.sales} target={cur.target} pace={pace} color={SALES} name="売上" />
            : <div className="d muted">売上目標はまだありません <button className="linkbtn" onClick={() => setEditTargets(true)}>目標を入れる</button></div>}
        </div>
        <div className="kpi">
          <div className="l">粗利 <span className="muted">（粗利率 {pct(cur.profit, cur.sales)}）</span></div>
          <div className="v">{yen(cur.profit)}</div>
          {cur.profitTarget ? <Progress value={cur.profit} target={cur.profitTarget} pace={paceP} color={PROFIT} name="粗利" />
            : <div className="d muted">粗利目標はまだありません <button className="linkbtn" onClick={() => setEditTargets(true)}>目標を入れる</button></div>}
        </div>
        <div className="kpi"><div className="l">着地見込み（今のペースで月末まで）</div>
          <div className="dash-fc"><span>売上</span><b>{yen(forecast)}</b>{cur.target ? <em>目標の {pct(forecast, cur.target)}</em> : null}</div>
          <div className="dash-fc"><span>粗利</span><b>{yen(forecastP)}</b>{cur.profitTarget ? <em>目標の {pct(forecastP, cur.profitTarget)}</em> : null}</div>
        </div>
        <div className="kpi"><div className="l">販売件数</div><div className="v">{cur.n}件</div><div className="d muted">1件あたり粗利 {cur.n ? yen(cur.profit / cur.n) : "—"}</div></div>
      </div>

      <div className="sec dash-sechead" style={{ marginTop: 18 }}>
        <span>売上・粗利のグラフ</span>
        <div className="seg dash-seg">
          <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>今月（日ごと）</button>
          <button className={view === "year" ? "on" : ""} onClick={() => setView("year")}>12か月</button>
        </div>
      </div>
      {view === "month" ? (
        <div className="grid dash-two">
          <div className="card"><ProgressChart daily={data.daily} today={day} target={cur.target} profitTarget={cur.profitTarget} noTarget={noTarget} /></div>
          <div className="card"><DailyChart daily={data.daily} today={day} /></div>
        </div>
      ) : (
        <div className="card"><MonthlyChart months={data.monthly} /></div>
      )}

      <div className="grid two" style={{ marginTop: 12 }}>
        <div>
          <div className="sec">販路ごと（{label(data.now)}）</div>
          <div className="card tablewrap" style={{ padding: "4px 8px" }}>
            <ShareTable rows={data.channels} empty="今月の販売はまだありません" />
          </div>
        </div>
        <div>
          <div className="sec">ジャンルごと（{label(data.now)}・返品された分は除く）</div>
          <div className="card tablewrap" style={{ padding: "4px 8px" }}>
            <ShareTable rows={data.genres} empty="今月の販売はまだありません" />
          </div>
        </div>
      </div>

      <div className="sec">在庫（いま）</div>
      <div className="grid dash-kpis">
        <div className="kpi"><div className="l">在庫の点数</div><div className="v">{data.inventory.n.toLocaleString()}点</div><div className="d muted">出品中 {data.inventory.listed}点・未出品 {data.inventory.n - data.inventory.listed}点</div></div>
        <div className="kpi"><div className="l">出品率</div><div className="v">{pct(data.inventory.listed, data.inventory.n)}</div><div className="d muted">在庫のうち、どこかに出品している割合</div></div>
        <div className="kpi"><div className="l">在庫の金額（原価）</div><div className="v">{yen(data.inventory.value)}</div><div className="d muted">予想売価の合計 {yen(data.inventory.exp)}</div></div>
        <div className="kpi"><div className="l">滞留（181日以上）</div><div className="v">{data.inventory.aging[3].n}点</div><div className="d muted">原価 {yen(data.inventory.aging[3].value)}</div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>仕入れてからの日数ごとの在庫（原価の金額）</div>
        {data.inventory.aging.map((a) => {
          const max = Math.max(...data.inventory.aging.map((x) => x.value), 1);
          return (
            <div key={a.label} className="dash-hbar" title={`${a.label}：${a.n}点・${yen(a.value)}`}>
              <span className="k">{a.label}</span>
              <span className="track"><i style={{ width: `${(a.value / max) * 100}%`, background: SALES }} /></span>
              <span className="v">{yen(a.value)}<small className="muted">（{a.n}点）</small></span>
            </div>
          );
        })}
      </div>

      <div className="sec">山の回収（仕入額のうち、売れて戻ってきた金額）</div>
      <div className="card tablewrap" style={{ padding: "4px 8px" }}>
        {!data.lots.length ? <p className="muted">山はまだありません。</p> : (
          <table>
            <thead><tr><th>山</th><th className="n">仕入額</th><th className="n">売れた金額</th><th style={{ width: "30%" }}>回収</th><th className="n">枝番</th><th className="n">仕入れから</th></tr></thead>
            <tbody>
              {data.lots.map((l) => (
                <tr key={l.code} className="clickable" onClick={() => router.push(`/lots/${l.code}`)}>
                  <td>{l.code} <span className="muted">{l.name}</span></td>
                  <td className="n">{yen(l.cost)}</td><td className="n">{yen(l.sold)}</td>
                  <td>
                    <div className="dash-recov"><span className="track"><i style={{ width: `${Math.min(100, l.rate * 100)}%`, background: l.rate >= 1 ? "var(--green)" : SALES }} /></span>
                      <span>{l.rate >= 1 ? <b className="up">✓ 回収済み {pct(l.sold, l.cost)}</b> : pct(l.sold, l.cost)}</span></div>
                  </td>
                  <td className="n">{l.soldBranches}/{l.branches}</td>
                  <td className="n">{l.days}日</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/** 販路ごと・ジャンルごとの表（売上の割合を細い棒で） */
function ShareTable({ rows, empty }: { rows: { name: string; sales: number; profit: number; n: number }[]; empty: string }) {
  if (!rows.length) return <p className="muted" style={{ padding: 8 }}>{empty}</p>;
  const total = rows.reduce((a, r) => a + r.sales, 0);
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <table>
      <thead><tr><th></th><th className="n">件数</th><th className="n">売上</th><th className="n">粗利</th><th className="n">粗利率</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}<div className="dash-mini" title={`売上の ${pct(r.sales, total)}`}><i style={{ width: `${Math.max(0, (r.sales / max) * 100)}%`, background: SALES }} /></div></td>
            <td className="n">{r.n}</td><td className="n">{yen(r.sales)}</td>
            <td className={`n ${r.profit < 0 ? "down" : ""}`}>{yen(r.profit)}</td><td className="n">{pct(r.profit, r.sales)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 月ごとの売上（青）と粗利（オレンジ）の棒グラフ。目標は点線。棒にマウスをのせると数字が出る */
function MonthlyChart({ months }: { months: Month[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // 画面の幅に合わせて描き直す（文字の大きさが変わらないように）
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const H = 240, padL = 48, padR = 8, padT = 12, padB = 26;
  const vals = months.flatMap((m) => [m.sales, m.profit, m.target ?? 0, m.profitTarget ?? 0]);
  const maxV = Math.max(...vals, 1), minV = Math.min(...vals, 0);
  // 目盛りをきりのいい数字に
  const stepRaw = (maxV - minV) / 4;
  const mag = 10 ** Math.floor(Math.log10(stepRaw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= stepRaw) ?? stepRaw;
  const top = Math.ceil(maxV / step) * step, bot = Math.floor(minV / step) * step;
  const yOf = (v: number) => padT + ((top - v) / (top - bot || 1)) * (H - padT - padB);
  const band = (W - padL - padR) / months.length;
  const bw = Math.min(20, band * 0.3);
  const ticks: number[] = [];
  for (let v = bot; v <= top + 1e-6; v += step) ticks.push(v);
  const h = hover != null ? months[hover] : null;

  return (
    <div className="dash-chart">
      <div className="dash-legend">
        <span><i style={{ background: SALES }} />売上</span>
        <span><i style={{ background: PROFIT }} />粗利</span>
        <span><i className="dash-dash" style={{ borderTopColor: SALES }} />売上目標</span>
        <span><i className="dash-dash" style={{ borderTopColor: PROFIT }} />粗利目標</span>
        <button className="linkbtn" style={{ marginLeft: "auto" }} onClick={() => setTable(!table)}>{table ? "グラフで見る" : "表で見る"}</button>
      </div>
      {table ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>月</th><th className="n">売上</th><th className="n">粗利</th><th className="n">粗利率</th><th className="n">件数</th><th className="n">売上目標</th><th className="n">達成率</th><th className="n">粗利目標</th><th className="n">達成率</th></tr></thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month}><td>{fullLabel(m.month)}</td><td className="n">{yen(m.sales)}</td><td className="n">{yen(m.profit)}</td><td className="n">{pct(m.profit, m.sales)}</td><td className="n">{m.n}</td>
                  <td className="n">{m.target ? yen(m.target) : "—"}</td><td className="n">{m.target ? pct(m.sales, m.target) : "—"}</td>
                  <td className="n">{m.profitTarget ? yen(m.profitTarget) : "—"}</td><td className="n">{m.profitTarget ? pct(m.profit, m.profitTarget) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
 <div style={{ position: "relative" }} ref={box}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="月ごとの売上と粗利の棒グラフ" onMouseLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={padL} x2={W - padR} y1={yOf(v)} y2={yOf(v)} stroke={v === 0 ? "#9ca3af" : "#eceef1"} strokeWidth={1} />
                <text x={padL - 6} y={yOf(v) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{man(v)}</text>
              </g>
            ))}
            {months.map((m, i) => {
              const cx = padL + band * i + band / 2;
              const bar = (v: number, x: number, color: string) => {
                const y0 = yOf(0), y1 = yOf(v), hgt = Math.abs(y0 - y1);
                if (hgt < 0.5) return null;
                const up = v >= 0, r = Math.min(4, hgt);
                const top = up ? y1 : y0, bottom = up ? y0 : y1;
                // 先だけ丸く、根元は四角
                const d = up
                  ? `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${bottom} Z`
                  : `M${x},${top} V${bottom - r} Q${x},${bottom} ${x + r},${bottom} H${x + bw - r} Q${x + bw},${bottom} ${x + bw},${bottom - r} V${top} Z`;
                return <path d={d} fill={color} opacity={hover == null || hover === i ? 1 : 0.45} />;
              };
              return (
                <g key={m.month}>
                  {bar(m.sales, cx - bw - 1, SALES)}
                  {bar(m.profit, cx + 1, PROFIT)}
                  {m.target != null && <line x1={cx - bw - 4} x2={cx} y1={yOf(m.target)} y2={yOf(m.target)} stroke={SALES} strokeWidth={2} strokeDasharray="3 2" />}
                  {m.profitTarget != null && <line x1={cx} x2={cx + bw + 4} y1={yOf(m.profitTarget)} y2={yOf(m.profitTarget)} stroke={PROFIT} strokeWidth={2} strokeDasharray="3 2" />}
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={hover === i ? "#1d2330" : "#6b7280"} fontWeight={hover === i ? 700 : 400}>{label(m.month)}</text>
                  <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB + 20} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {h && hover != null && (
            <div className="dash-tip" style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%` }}>
              <b>{fullLabel(h.month)}</b>
              <div><i style={{ background: SALES }} />売上 {yen(h.sales)}</div>
              <div><i style={{ background: PROFIT }} />粗利 {yen(h.profit)}（{pct(h.profit, h.sales)}）</div>
              <div className="muted">{h.n}件{h.target ? `・売上目標の ${pct(h.sales, h.target)}` : ""}{h.profitTarget ? `・粗利目標の ${pct(h.profit, h.profitTarget)}` : ""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- グラフの共通の部品 ----
/** 入れ物の幅に合わせて描く（文字の大きさが変わらないように） */
function useWidth(init = 300) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(init);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
/** きりのいい目盛り */
function niceScale(vals: number[]) {
  const maxV = Math.max(...vals, 1), minV = Math.min(...vals, 0);
  const raw = (maxV - minV) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(maxV / step) * step, bot = Math.floor(minV / step) * step;
  const ticks: number[] = [];
  for (let v = bot; v <= top + 1e-6; v += step) ticks.push(v);
  return { top, bot, ticks };
}
function Legend({ items, right }: { items: { name: string; color: string; dashed?: boolean }[]; right?: React.ReactNode }) {
  return (
    <div className="dash-legend">
      {items.map((x) => (
        <span key={x.name}><i className={x.dashed ? "dash-dash" : ""} style={x.dashed ? { borderTopColor: x.color } : { background: x.color }} />{x.name}</span>
      ))}
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

/** 今月の累計（折れ線）と、目標のペース（点線）。今日より先は線を描かない */
function ProgressChart({ daily, today, target, profitTarget, noTarget }: { daily: Day[]; today: number; target: number | null; profitTarget: number | null; noTarget: boolean }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, padL = 48, padR = 12, padT = 12, padB = 24;
  const n = daily.length;
  let cs = 0, cp = 0;
  const cum = daily.map((d) => ({ day: d.day, sales: (cs += d.sales), profit: (cp += d.profit) }));
  const shown = cum.slice(0, today);
  const { top, bot, ticks } = niceScale([...shown.flatMap((c) => [c.sales, c.profit]), target ?? 0, profitTarget ?? 0]);
  const x = (d: number) => padL + ((d - 1) / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + ((top - v) / (top - bot || 1)) * (H - padT - padB);
  const path = (k: "sales" | "profit") => shown.map((c, i) => `${i ? "L" : "M"}${x(c.day)},${y(c[k])}`).join(" ");
  const paceLine = (t: number) => `M${x(1)},${y(t / n)} L${x(n)},${y(t)}`;
  const h = hover != null ? cum[hover] : null;
  const labels = [1, 5, 10, 15, 20, 25, n].filter((d, i, a) => a.indexOf(d) === i && d <= n);
  return (
    <div className="dash-chart" ref={ref}>
      <div className="dash-ctitle">累計の進み具合（目標のペースと比べる）</div>
      <Legend items={[
        { name: "売上の累計", color: SALES }, { name: "粗利の累計", color: PROFIT },
        ...(target ? [{ name: "売上目標のペース", color: SALES, dashed: true }] : []),
        ...(profitTarget ? [{ name: "粗利目標のペース", color: PROFIT, dashed: true }] : []),
      ]} />
      <div style={{ position: "relative" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="今月の売上と粗利の累計の折れ線グラフ" onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#9ca3af" : "#eceef1"} />
              <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{man(v)}</text>
            </g>
          ))}
          {target ? <path d={paceLine(target)} stroke={SALES} strokeWidth={1.5} strokeDasharray="5 4" fill="none" opacity={0.8} /> : null}
          {profitTarget ? <path d={paceLine(profitTarget)} stroke={PROFIT} strokeWidth={1.5} strokeDasharray="5 4" fill="none" opacity={0.8} /> : null}
          <line x1={x(today)} x2={x(today)} y1={padT} y2={H - padB} stroke="#cbd0d8" strokeDasharray="2 3" />
          <text x={x(today)} y={padT + 8} textAnchor="middle" fontSize="10" fill="#6b7280">今日</text>
          <path d={path("sales")} stroke={SALES} strokeWidth={2} fill="none" strokeLinejoin="round" />
          <path d={path("profit")} stroke={PROFIT} strokeWidth={2} fill="none" strokeLinejoin="round" />
          {shown.length > 0 && (
            <>
              <circle cx={x(today)} cy={y(shown[shown.length - 1].sales)} r={4} fill={SALES} stroke="#fff" strokeWidth={2} />
              <circle cx={x(today)} cy={y(shown[shown.length - 1].profit)} r={4} fill={PROFIT} stroke="#fff" strokeWidth={2} />
            </>
          )}
          {labels.map((d) => <text key={d} x={x(d)} y={H - 6} textAnchor="middle" fontSize="10" fill="#6b7280">{d}日</text>)}
          {h && <line x1={x(h.day)} x2={x(h.day)} y1={padT} y2={H - padB} stroke={INK} strokeWidth={1} opacity={0.4} />}
          {cum.map((c, i) => (
            <rect key={c.day} x={x(c.day) - (W - padL - padR) / n / 2} y={padT} width={(W - padL - padR) / n} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {h && hover != null && (
          <div className="dash-tip" style={{ left: `${(x(h.day) / W) * 100}%` }}>
            <b>{h.day}日{h.day > today ? "（まだ先）" : "まで"}</b>
            {h.day <= today ? (
              <>
                <div><i style={{ background: SALES }} />売上の累計 {yen(h.sales)}{target ? `（目安 ${yen((target * h.day) / n)}）` : ""}</div>
                <div><i style={{ background: PROFIT }} />粗利の累計 {yen(h.profit)}{profitTarget ? `（目安 ${yen((profitTarget * h.day) / n)}）` : ""}</div>
                <div className="muted">この日：売上 {yen(daily[hover].sales)}・粗利 {yen(daily[hover].profit)}・{daily[hover].n}件</div>
              </>
            ) : (
              <>
                {target ? <div><i style={{ background: SALES }} />売上目標の目安 {yen((target * h.day) / n)}</div> : null}
                {profitTarget ? <div><i style={{ background: PROFIT }} />粗利目標の目安 {yen((profitTarget * h.day) / n)}</div> : null}
              </>
            )}
          </div>
        )}
      </div>
      {noTarget && <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>目標を入れると、目標のペース（点線）が出ます。</p>}
    </div>
  );
}

/** 今月の日ごとの売上（青）・粗利（オレンジ）の棒グラフ */
function DailyChart({ daily, today }: { daily: Day[]; today: number }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, padL = 48, padR = 8, padT = 12, padB = 24;
  const { top, bot, ticks } = niceScale(daily.flatMap((d) => [d.sales, d.profit]));
  const y = (v: number) => padT + ((top - v) / (top - bot || 1)) * (H - padT - padB);
  const band = (W - padL - padR) / daily.length;
  const bw = Math.max(2, Math.min(10, band * 0.38));
  const h = hover != null ? daily[hover] : null;
  const bar = (v: number, bx: number, color: string, dim: boolean) => {
    const y0 = y(0), y1 = y(v), hgt = Math.abs(y0 - y1);
    if (hgt < 0.5) return null;
    const r = Math.min(3, hgt, bw / 2);
    const up = v >= 0, t = up ? y1 : y0, b = up ? y0 : y1;
    const d = up
      ? `M${bx},${b} V${t + r} Q${bx},${t} ${bx + r},${t} H${bx + bw - r} Q${bx + bw},${t} ${bx + bw},${t + r} V${b} Z`
      : `M${bx},${t} V${b - r} Q${bx},${b} ${bx + r},${b} H${bx + bw - r} Q${bx + bw},${b} ${bx + bw},${b - r} V${t} Z`;
    return <path d={d} fill={color} opacity={dim ? 0.45 : 1} />;
  };
  const labels = [1, 5, 10, 15, 20, 25, daily.length].filter((d, i, a) => a.indexOf(d) === i);
  return (
    <div className="dash-chart" ref={ref}>
      <div className="dash-ctitle">日ごとの売上・粗利</div>
      <Legend items={[{ name: "売上", color: SALES }, { name: "粗利", color: PROFIT }]} />
      <div style={{ position: "relative" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="今月の日ごとの売上と粗利の棒グラフ" onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#9ca3af" : "#eceef1"} />
              <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{man(v)}</text>
            </g>
          ))}
          {daily.map((d, i) => {
            const cx = padL + band * i + band / 2;
            const dim = hover != null && hover !== i;
            return (
              <g key={d.day}>
                {bar(d.sales, cx - bw - 1, SALES, dim)}
                {bar(d.profit, cx + 1, PROFIT, dim)}
                <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              </g>
            );
          })}
          {labels.map((d) => <text key={d} x={padL + band * (d - 1) + band / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={d === today ? INK : "#6b7280"} fontWeight={d === today ? 700 : 400}>{d}日</text>)}
        </svg>
        {h && (
          <div className="dash-tip" style={{ left: `${((padL + band * (h.day - 1) + band / 2) / W) * 100}%` }}>
            <b>{h.day}日</b>
            <div><i style={{ background: SALES }} />売上 {yen(h.sales)}</div>
            <div><i style={{ background: PROFIT }} />粗利 {yen(h.profit)}</div>
            <div className="muted">{h.n}件</div>
          </div>
        )}
      </div>
    </div>
  );
}
