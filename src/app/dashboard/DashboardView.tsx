"use client";
// ダッシュボード（ECの売上・粗利・売上目標、在庫、山の回収）
// グラフの色：売上＝青、粗利＝オレンジ（色の見分けにくい人でも区別できる組み合わせを確かめ済み）。目標は点線
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setTarget } from "@/lib/target-actions";
import { toast, esc } from "@/lib/toast";

type Month = { month: string; sales: number; profit: number; n: number; target: number | null };
export type DashData = {
  now: string; today: string;
  monthly: Month[];
  channels: { name: string; sales: number; profit: number; n: number }[];
  genres: { name: string; sales: number; profit: number; n: number }[];
  inventory: { n: number; value: number; exp: number; listed: number; aging: { label: string; n: number; value: number }[] };
  lots: { code: string; name: string; cost: number; sold: number; rate: number; branches: number; soldBranches: number; days: number }[];
  alerts: { tbd: number; fxPending: number; reportDraft: string | null };
  futureTargets: { month: string; target: number | null }[];
};

const SALES = "#2a78d6", PROFIT = "#eb6834";
const yen = (v: number) => (v < 0 ? "−" : "") + "¥" + Math.abs(Math.round(v)).toLocaleString();
const man = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(Math.abs(v) >= 1000000 ? 0 : 1)}万` : Math.round(v).toLocaleString());
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const label = (m: string) => `${Number(m.slice(5))}月`;
const fullLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

export function DashboardView({ data }: { data: DashData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editTargets, setEditTargets] = useState(false);
  const cur = data.monthly[data.monthly.length - 1];
  const [y, m] = data.now.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(data.today.slice(8));
  const forecast = day ? (cur.sales / day) * days : 0; // 着地見込み（今のペースで月末まで売れた場合）
  const pace = cur.target ? (cur.target * day) / days : null; // 今日までの目安
  const achieve = cur.target ? cur.sales / cur.target : null;

  const saveTarget = (month: string, v: string) => {
    const t = v.normalize("NFKC").replace(/[¥,円\s]/g, "");
    const n = t === "" ? null : t.endsWith("万") ? Math.round(Number(t.slice(0, -1)) * 10000) : Number(t);
    if (n != null && (!Number.isInteger(n) || n < 0)) { toast("目標は円の整数で入れてください（例：3000000 または 300万）"); return; }
    const old = data.futureTargets.find((x) => x.month === month)?.target ?? null;
    if (old === n) return;
    start(async () => {
      const r = await setTarget(month, n);
      if (!r.ok) { toast(esc(r.error ?? "")); return; }
      router.refresh();
      toast(`${fullLabel(month)}の売上目標を${n == null ? "消しました" : `${yen(n)}にしました`}`, async () => { await setTarget(month, r.before ?? null); router.refresh(); return "元に戻しました"; });
    });
  };

  const alerts = [
    data.alerts.reportDraft && { href: `/report?m=${data.alerts.reportDraft}`, text: `${fullLabel(data.alerts.reportDraft)}の月次レポートがまだ確定していません（翌月10日まで）` },
    data.alerts.tbd > 0 && { href: "/sales?tab=tbd", text: `送料が仮のままの販売が ${data.alerts.tbd}件 あります` },
    data.alerts.fxPending > 0 && { href: "/sales?tab=fx", text: `為替がまだ仮の販売が ${data.alerts.fxPending}件 あります（終わった月）` },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <section>
      <h1>ダッシュボード</h1>
      <p className="lead">ECの売上・粗利と、売上目標の達成状況です。売上 ＝ 売値＋設定送料（月次レポートと同じ計算。返品・返金はあった月に引きます）。経費・固定費はfreeeで見ます。</p>

      {alerts.length > 0 && (
        <div className="dash-alerts">
          {alerts.map((a) => <Link key={a.href} href={a.href} className="dash-alert">⚠ {a.text} →</Link>)}
        </div>
      )}

      <div className="sec">{fullLabel(data.now)}（{day}日まで）</div>
      <div className="grid dash-kpis">
        <div className="kpi">
          <div className="l">売上</div>
          <div className="v">{yen(cur.sales)}</div>
          {cur.target ? (
            <>
              <div className="dash-prog" title={`目標 ${yen(cur.target)}`}>
                <i style={{ width: `${Math.min(100, (achieve ?? 0) * 100)}%` }} />
                {pace != null && <b style={{ left: `${Math.min(100, (pace / cur.target) * 100)}%` }} title="今日までの目安" />}
              </div>
              <div className="d">目標 {yen(cur.target)} の <b>{pct(cur.sales, cur.target)}</b>
                {pace != null && <span className="muted">（今日までの目安 {yen(pace)} に{cur.sales >= pace ? <b className="up"> 届いています</b> : <b className="down"> あと {yen(pace - cur.sales)}</b>}）</span>}</div>
            </>
          ) : <div className="d muted">目標はまだありません <button className="linkbtn" onClick={() => setEditTargets(true)}>目標を入れる</button></div>}
        </div>
        <div className="kpi"><div className="l">粗利</div><div className="v">{yen(cur.profit)}</div><div className="d muted">粗利率 {pct(cur.profit, cur.sales)}</div></div>
        <div className="kpi"><div className="l">着地見込み（今のペース）</div><div className="v">{yen(forecast)}</div>
          <div className="d muted">{cur.target ? <>目標に対して <b>{pct(forecast, cur.target)}</b></> : `1日あたり ${yen(day ? cur.sales / day : 0)}`}</div></div>
        <div className="kpi"><div className="l">販売件数</div><div className="v">{cur.n}件</div><div className="d muted">1件あたり粗利 {cur.n ? yen(cur.profit / cur.n) : "—"}</div></div>
      </div>

      <div className="sec dash-sechead">
        <span>月ごとの売上・粗利（12か月）</span>
        <button className="linkbtn" onClick={() => setEditTargets(!editTargets)}>{editTargets ? "閉じる" : "売上目標を入れる・直す"}</button>
      </div>
      {editTargets && (
        <div className="card dash-targets">
          <span className="muted">ECの売上目標（売値＋設定送料・円）。「300万」のようにも入れられます。空にすると消えます。</span>
          <div className="dash-tgrid">
            {data.futureTargets.map((t) => (
              <label key={t.month} className="f">{fullLabel(t.month)}
                <input className="inp n" inputMode="numeric" key={`${t.month}-${t.target}`} defaultValue={t.target ?? ""} placeholder="例：300万" disabled={pending}
                  onBlur={(e) => saveTarget(t.month, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="card"><MonthlyChart months={data.monthly} /></div>

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
  const vals = months.flatMap((m) => [m.sales, m.profit, m.target ?? 0]);
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
        <span><i className="dash-dash" />売上目標</span>
        <button className="linkbtn" style={{ marginLeft: "auto" }} onClick={() => setTable(!table)}>{table ? "グラフで見る" : "表で見る"}</button>
      </div>
      {table ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>月</th><th className="n">売上</th><th className="n">粗利</th><th className="n">粗利率</th><th className="n">件数</th><th className="n">目標</th><th className="n">達成率</th></tr></thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month}><td>{fullLabel(m.month)}</td><td className="n">{yen(m.sales)}</td><td className="n">{yen(m.profit)}</td><td className="n">{pct(m.profit, m.sales)}</td><td className="n">{m.n}</td>
                  <td className="n">{m.target ? yen(m.target) : "—"}</td><td className="n">{m.target ? pct(m.sales, m.target) : "—"}</td></tr>
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
                  {m.target != null && <line x1={cx - bw - 6} x2={cx + bw + 6} y1={yOf(m.target)} y2={yOf(m.target)} stroke="#1d2330" strokeWidth={2} strokeDasharray="4 3" />}
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
              <div className="muted">{h.n}件{h.target ? `・目標 ${yen(h.target)}（${pct(h.sales, h.target)}）` : ""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
