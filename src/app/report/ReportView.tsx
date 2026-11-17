"use client";
// 月次レポートの画面（画面イメージ docs/mockup/index.html の「月次レポート」と同じ見た目・操作）
// - 月の一覧（今月は途中経過、終わった月は下書き → 確定済み）
// - 振込の確認（画面だけ。PDFには入らない）：仮の送料の確定、実際の振込額、差額、販路ごとのPDF・CSV、確定して保存
// - レポート本体（PDFになる部分）
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { savePaid, fixReport } from "@/lib/report-actions";
import { fixShipping } from "@/lib/sale-actions";
import type { ReportData, ReportLine, ReportChannel } from "@/lib/report";
import { toast, esc } from "@/lib/toast";
import { ask } from "@/lib/ask";
import { PageHead } from "@/components/PageHead";

export type MonthRow = {
  month: string; state: "open" | "draft" | "fixed"; version: number; fixedAt: string; changed: boolean;
  versions: { version: number; fixedAt: string }[];
};

const fmtY = (v: number) => (v < 0 ? "−" : "") + "¥" + Math.abs(Math.round(v)).toLocaleString();
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");
const label = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const mon = (m: string) => `${Number(m.slice(5))}月`;
const SIGN: Record<string, string> = { EUR: "€", USD: "$" };
const CUR_NAME: Record<string, string> = { EUR: "ユーロ", USD: "ドル" };
/** 締め切り（翌月10日） */
const due = (m: string) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo, 10)); return `${d.getUTCMonth() + 1}/10`; };

export function ReportView({ list, month, version, fixedAt, data, paid, changed }: {
  list: MonthRow[]; month: string; version: number; fixedAt: string; data: ReportData; paid: Record<string, number>; changed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // PDF：印刷の画面を開く（「PDFに保存」を選ぶ）。ch があれば、その販路だけのレポートにしてから印刷する
  const [printReq, setPrintReq] = useState<{ ch: string | null } | null>(null);
  const only = printReq?.ch ?? null;
  const row = list.find((x) => x.month === month)!;
  const isOpen = row.state === "open";
  const isDraft = !isOpen && version === 0;
  const go = (m: string, v?: number | "draft") => router.push(`/report?m=${m}${v != null ? `&v=${v}` : ""}`);

  const printPdf = (ch: string | null) => setPrintReq({ ch });
  useEffect(() => {
    if (!printReq) return;
    const old = document.title;
    const ver = version ? `第${version}版` : isOpen ? "途中経過" : "下書き";
    document.title = `JOYNT_月次販売レポート_${month}${printReq.ch ? "_" + printReq.ch : ""}_${ver}`; // ファイル名になる
    const t = setTimeout(() => { window.print(); document.title = old; setPrintReq(null); }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printReq]);

  const csv = (chs: ReportChannel[]) => {
    const [y, mm] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const date = `${y}-${String(mm).padStart(2, "0")}-${last}`;
    const out = [["発生日", "取引先", "勘定科目", "税区分", "金額", "備考"]];
    for (const f of chs) {
      if (!f.sales && !f.fee && !f.ship) continue; // その月に振込が動かない販路（売れてすぐ返品など）は出さない
      const tax = f.currency !== "JPY" ? "（税理士に確認）" : null;
      out.push([date, f.name, "売上高", tax || "課税売上10%", String(f.sales), `${f.name}　${mon(month)}売上`]);
      if (f.fee) out.push([date, f.name, "販売手数料", tax || "課対仕入10%", String(-f.fee), `${f.name}　${mon(month)}販売手数料`]);
      if (f.ship) out.push([date, f.name, "荷造運賃", "課対仕入10%", String(-f.ship), `${f.name}　${mon(month)}送料`]);
    }
    const text = "﻿" + out.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `JOYNT_freee取込_${month}${chs.length === 1 ? "_" + chs[0].name : ""}${version ? `_第${version}版` : ""}.csv`;
    a.click();
    toast(`freee取込用のCSVを作りました（${chs.length === 1 ? esc(chs[0].name) : "全販路"}・${out.length - 1}行）`);
  };

  const onPaid = (ch: string, v: string) => {
    const t = v.normalize("NFKC").replace(/[¥,円\s]/g, "");
    const n = t === "" ? null : Number(t);
    if (n != null && !Number.isInteger(n)) { toast("振込額は整数で入れてください"); return; }
    if ((paid[ch] ?? null) === n) return;
    start(async () => { const r = await savePaid(month, ch, n); if (!r.ok) toast(esc(r.error ?? "")); router.refresh(); });
  };
  const onFixShip = (l: ReportLine, v: string) => {
    const n = Number(v.normalize("NFKC").replace(/[¥,円\s]/g, ""));
    if (v.trim() === "" || !Number.isInteger(n) || n < 0) { toast("本当の送料を0以上の整数で入れてください"); return; }
    start(async () => { const r = await fixShipping(l.saleId, n); if (!r.ok) { toast(esc(r.error ?? "")); return; } router.refresh(); toast(`${esc(l.codes)} の送料を ${fmtY(n)} で確定しました`); });
  };
  const onFix = () => start(async () => {
    const left = data.channels.filter((f) => paid[f.name] == null);
    if (left.length) { toast(`まだ振込額が入っていない販路があります（${left.map((f) => esc(f.name)).join("・")}）`); return; }
    const diff = data.channels.filter((f) => paid[f.name] !== f.expect);
    const next = (row.version || 0) + 1;
    const msg = diff.length
      ? `差額がある販路があります（${diff.map((f) => f.name).join("・")}）。\nこのまま確定しますか？差額はPDFにそのまま残ります。`
      : `${label(month)}のレポートを確定して、第${next}版として保存しますか？`;
    if (!(await ask(msg, "確定して保存"))) return;
    const r = await fixReport(month);
    if (!r.ok) { toast(esc(r.error)); return; }
    router.push(`/report?m=${month}`);
    router.refresh();
    toast(`${label(month)}を確定して保存しました（第${r.version}版）`);
  });

  const tmps = data.lines.filter((l) => l.tentative);
  const left = data.channels.filter((f) => paid[f.name] == null).length;

  const firstDraft = list.find((m) => m.state === "draft")?.month; // いちばん新しい下書き（いま確定する月）
  return (
    <section id="report">
      <PageHead
        title="月次レポート"
        help={[
          <>月が終わると、その月の販売を販路ごとにまとめた<b>下書き</b>ができます。</>,
          <><b>翌月10日までに</b>、仮の送料を確定し、通帳の振込額を入れて「確定して保存」します。freeeに貼る根拠のPDFになります。</>,
          <>販路ごとのPDFと、freeeに取り込むCSVも出せます。</>,
        ]}
      />

      <div className="replist">
        {/* 青いボタンは、いま確定する月（いちばん新しい下書き）だけ */}
        {list.slice(0, 6).map((m) => (
          <div key={m.month} className={`reprow${m.month === month ? " on" : ""}`}>
            <span className="m">{label(m.month)}</span>
            {m.state === "open" ? (
              <><span className="info">集計中。月が終わると下書きになります（為替は仮のレート）。</span>
                <button className="btn" onClick={() => go(m.month)}>途中経過を見る</button></>
            ) : m.state === "draft" ? (
              <><span className="info"><span className="tag t-warn">下書き</span>　<b>{due(m.month)}までに</b>振込額を入れて確定してください</span>
                <button className={`btn${m.month === firstDraft ? " primary" : ""}`} onClick={() => go(m.month)}>振込を確認する</button></>
            ) : (
              <><span className="info"><span className="tag t-sold">確定済み</span>　確定 {m.fixedAt}（第{m.version}版）{m.changed && <> <span className="tag t-temp">確定後に変更あり</span></>}</span>
                <button className="btn" onClick={() => go(m.month)}>見る</button></>
            )}
          </div>
        ))}
        {list.length > 6 && (
          <select className="inp" value="" onChange={(e) => e.target.value && go(e.target.value)} style={{ justifySelf: "start" }}>
            <option value="">もっと前の月を見る…</option>
            {list.slice(6).map((m) => <option key={m.month} value={m.month}>{label(m.month)}（{m.state === "fixed" ? `確定・第${m.version}版` : "下書き"}）</option>)}
          </select>
        )}
      </div>

      <div className="card repview" id="repView">
        <div className="repbar">
          <b>{label(month)}のレポート（{isOpen ? "途中経過" : version ? `第${version}版` : "下書き"}）</b>
          {row.versions.length > 0 && (
            <select className="inp" value={version || "draft"} onChange={(e) => go(month, e.target.value === "draft" ? "draft" : Number(e.target.value))}>
              {row.versions.map((v) => <option key={v.version} value={v.version}>第{v.version}版（{v.fixedAt}）</option>)}
              <option value="draft">今の数字（作り直し前）</option>
            </select>
          )}
          <span className="repbtns"><button className="btn" onClick={() => printPdf(null)}>⬇ 全販路のPDF</button></span>
        </div>

        {changed && (
          <div className="recon" style={{ background: "#fff8e1" }}>
            <b>確定したあとに、この月の数字が変わっています</b>（送料の確定・返品・販売の取り消しなど）。
            <span className="muted"> 作り直すと第{row.version + 1}版として保存します。前の版は消えません。</span>
            <div style={{ marginTop: 8 }}><button className="btn" onClick={() => go(month, "draft")}>今の数字を見て作り直す</button></div>
          </div>
        )}

        {!isOpen && (
          <div className="recon">
            <div className="rc-head">
              <b>{isDraft ? "振込を確認して確定する" : `振込の確認（第${version}版で確定済み）`}</b>
              <span className="muted">販路ごとに、PDFとfreeeの取込ファイルを出せます。振込のあった取引に、その販路のPDFを貼ってください。</span>
            </div>
            {isDraft && data.fxPending > 0 && (
              <div className="rc-warn">為替がまだ仮の販売が <b>{data.fxPending}件</b> あります。<Link href="/sales?tab=fx">販売を記録 →「為替レート」</Link>で{label(month)}を確定してください。</div>
            )}
            {isDraft && tmps.length > 0 && (
              <div className="rc-warn">送料が仮のままの販売が <b>{tmps.length}件</b> あります。本当の送料を入れてください。
                {tmps.map((l) => (
                  <div key={l.saleId} className="rc-tmp">
                    {l.codes} {l.name}（{l.channel}）仮 {fmtY(l.real)} →
                    <input className="n" inputMode="numeric" placeholder="本当の送料" id={`real${l.saleId}`}
                      onKeyDown={(e) => { if (e.key === "Enter") onFixShip(l, (e.target as HTMLInputElement).value); }} />
                    <button className="btn" disabled={pending} onClick={() => onFixShip(l, (document.getElementById(`real${l.saleId}`) as HTMLInputElement).value)}>確定</button>
                  </div>
                ))}
              </div>
            )}
            {!data.channels.length ? <p className="muted">この月の販売はありません。</p> : (
              <div className="tablewrap">
                <table className="rc-t">
                  <thead><tr><th>販路</th><th className="n">振込予定額</th><th className="n">実際の振込額</th><th className="n">差額</th><th></th></tr></thead>
                  <tbody>
                    {data.channels.map((f) => {
                      const p = paid[f.name], df = p == null ? null : p - f.expect;
                      return (
                        <tr key={f.name}>
                          <td>{f.name}{f.currency !== "JPY" && <> <span className="fxq" title="税区分・為替の差の扱いは税理士に確認中">外貨・確認中</span></>}
                            <div className="muted" style={{ fontSize: 11 }}>売上 {fmtY(f.sales)} − 手数料 {fmtY(f.fee)}{f.shipDeduct && <> − 送料 {fmtY(f.ship)}{f.tentative > 0 && <> <span className="tmp">仮</span></>}</>}</div></td>
                          <td className="n"><b>{fmtY(f.expect)}</b></td>
                          <td className="n">{isDraft
                            ? <input key={`${f.name}-${p}`} className="n" inputMode="numeric" defaultValue={p ?? ""} placeholder="通帳の金額" onBlur={(e) => onPaid(f.name, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                            : p == null ? "—" : fmtY(p)}</td>
                          <td className="n">{df == null ? <span className="muted">未入力</span> : df === 0 ? <span className="ok">✓ 一致</span> : <span className="neg">{df > 0 ? "+" : ""}{fmtY(df)}</span>}</td>
                          <td className="nowrap"><button className="btn mini" onClick={() => printPdf(f.name)}>⬇ PDF</button> <button className="btn mini" onClick={() => csv([f])}>⬇ CSV</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="rc-foot">
              {data.channels.length > 0 && <button className="btn" onClick={() => csv(data.channels)}>⬇ freee取込用CSV（全販路）</button>}
              {isDraft && data.channels.length > 0 && (
                <>
                  <button className="btn primary" disabled={pending} onClick={onFix}>確定して保存（第{row.version + 1}版）</button>
                  <span className="muted">{data.fxPending ? "為替の確定が必要です" : left ? `あと ${left}販路 の振込額が未入力です` : tmps.length ? `仮の送料が ${tmps.length}件 残っています` : "確定できます"}</span>
                </>
              )}
            </div>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, margin: "-4px 0 10px" }}>
          ※ PDFのボタンを押すと印刷の画面が開きます。「送信先」を「PDFに保存」にすると、PDFとして保存できます（ファイル名は自動で付きます）。
        </div>
        <div className="repdoc" id="repDoc">
          <ReportDoc data={data} paid={paid} only={only} month={month} version={version} fixedAt={fixedAt} state={isOpen ? "open" : isDraft ? "draft" : "fixed"} />
        </div>
      </div>
    </section>
  );
}

/** レポート本体（PDFになる部分） */
function ReportDoc({ data, paid, only, month, version, fixedAt, state }: {
  data: ReportData; paid: Record<string, number>; only: string | null; month: string; version: number; fixedAt: string; state: "open" | "draft" | "fixed";
}) {
  const lines = only ? data.lines.filter((l) => l.channel === only) : data.lines;
  const chs = only ? data.channels.filter((c) => c.name === only) : data.channels;
  const sales = lines.filter((l) => l.kind === "sale");
  const tot = (ls: ReportLine[]) => ({
    n: ls.filter((l) => l.kind === "sale").length,
    price: ls.reduce((a, l) => a + l.price, 0), ship: ls.reduce((a, l) => a + l.ship, 0), real: ls.reduce((a, l) => a + l.real, 0),
    fee: ls.reduce((a, l) => a + l.fee, 0), cost: ls.reduce((a, l) => a + l.cost, 0), profit: ls.reduce((a, l) => a + l.profit, 0),
  });
  const all = tot(lines);
  const sum = (k: "sales" | "fee" | "ship" | "expect") => chs.reduce((a, f) => a + f[k], 0);
  const paidSum = chs.reduce((a, f) => a + (paid[f.name] ?? 0), 0);
  const tmpN = lines.filter((l) => l.tentative).length;
  const rateText = data.rates.length
    ? data.rates.map((r) => `1${SIGN[r.currency]} = ${r.rate.toFixed(2)}円`).join(" / ") + (data.rates.every((r) => r.final) ? `（${mon(month)}の平均TTM・確定）` : "（仮のレート）")
    : "外貨の販売なし";
  const [y, mm] = month.split("-");
  const SumRow = ({ name, t, cls = "" }: { name: string; t: ReturnType<typeof tot>; cls?: string }) => (
    <tr className={cls}>
      <td>{name}</td><td className="n">{t.n}</td><td className="n">{fmtY(t.price)}</td><td className="n">{fmtY(t.ship)}</td><td className="n">{fmtY(t.real)}</td>
      <td className="n">{fmtY(t.fee)}</td><td className="n">{fmtY(t.cost)}</td><td className={`n${t.profit < 0 ? " neg" : ""}`}>{fmtY(t.profit)}</td><td className="n">{pct(t.profit, t.price + t.ship)}</td>
    </tr>
  );

  return (
    <>
      {state !== "fixed" && <div className="wmark">{state === "open" ? "途中経過（月の途中・為替は仮のレート）" : "下書き（まだ確定していません）"}</div>}
      <div className="rhead">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/joynt-logo.png" alt="JOYNT" />
          <h2>月次販売レポート　{label(month)}{only ? `　${only}` : ""}</h2>
        </div>
        <div className="rmeta">
          対象：{y}/{mm}/01 〜 末日に売れた商品と、この月の返品・返金<br />
          為替：{rateText}<br />
          作成：{data.made}{state === "fixed" ? `　確定：${fixedAt}（第${version}版）` : "　（下書き）"}
        </div>
      </div>

      <h3>振込との突き合わせ（freee登録用）</h3>
      {!chs.length ? <p>この月の販売はありません。</p> : (
        <table>
          <thead><tr><th>販路</th><th className="n">売上高</th><th className="n">販売手数料</th><th className="n">荷造運賃（振込から引かれる送料）</th><th className="n">振込予定額</th><th className="n">実際の振込額</th><th className="n">差額</th></tr></thead>
          <tbody>
            {chs.map((f) => {
              const p = paid[f.name], d = p == null ? null : p - f.expect;
              return (
                <tr key={f.name}>
                  <td>{f.name}{f.currency !== "JPY" && <> <span className="fxq">外貨</span></>}</td>
                  <td className="n">{fmtY(f.sales)}</td><td className="n">{fmtY(f.fee)}</td>
                  <td className="n">{f.shipDeduct ? fmtY(f.ship) : "—"}{f.tentative > 0 && <> <span className="tmp">仮</span></>}</td>
                  <td className="n"><b>{fmtY(f.expect)}</b></td>
                  <td className="n">{p == null ? "未入力" : fmtY(p)}</td>
                  <td className={`n${d ? " neg" : ""}`}>{d == null ? "—" : d === 0 ? "0（一致）" : (d > 0 ? "+" : "") + fmtY(d)}</td>
                </tr>
              );
            })}
            {chs.length > 1 && (
              <tr className="tot"><td>合計</td><td className="n">{fmtY(sum("sales"))}</td><td className="n">{fmtY(sum("fee"))}</td><td className="n">{fmtY(sum("ship"))}</td><td className="n">{fmtY(sum("expect"))}</td><td className="n">{fmtY(paidSum)}</td><td className="n"></td></tr>
            )}
          </tbody>
        </table>
      )}

      <h3>為替レート（{mon(month)}の月中平均TTM・三菱UFJ銀行）</h3>
      {data.monthRates?.length ? (
        <table>
          <thead><tr><th>通貨</th><th className="n">月中平均TTM</th><th>使い方</th></tr></thead>
          <tbody>
            {data.monthRates.map((r) => (
              <tr key={r.currency}>
                <td>{CUR_NAME[r.currency] ?? r.currency}（1{SIGN[r.currency] ?? ""}）{r.source === "manual" && <> <span className="tmp">手入力</span></>}</td>
                <td className="n"><b>{r.ttm.toFixed(2)}円</b></td>
                <td>{data.channels.filter((c) => c.currency === r.currency).map((c) => c.name).join("・") || "この月はこの通貨の販売なし"}{data.channels.some((c) => c.currency === r.currency) ? " の売値・設定送料・手数料を円に換算" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>{state === "open" ? "月中平均は月末に決まります（今は月初のTTMで仮に計算しています）。" : "まだ取り込んでいません。「販売を記録」→「為替レート」の「最新のレートを取り込む」を押してください。"}</p>
      )}

      <div className="kp">
        <div><span>売上（売値＋設定送料）</span><b>{fmtY(all.price + all.ship)}</b></div>
        <div><span>粗利</span><b>{fmtY(all.profit)}</b></div>
        <div><span>粗利率</span><b>{pct(all.profit, all.price + all.ship)}</b></div>
        <div><span>販売件数</span><b>{sales.length}件</b></div>
      </div>

      {!only && chs.length > 0 && (
        <>
          <h3>販路ごとのまとめ</h3>
          <table>
            <thead><tr><th>販路</th><th className="n">件数</th><th className="n">売値（円）</th><th className="n">設定送料</th><th className="n">実送料</th><th className="n">手数料</th><th className="n">原価</th><th className="n">粗利</th><th className="n">粗利率</th></tr></thead>
            <tbody>
              {chs.map((f) => <SumRow key={f.name} name={f.name} t={tot(lines.filter((l) => l.channel === f.name))} />)}
              <SumRow name="合計" t={all} cls="tot" />
            </tbody>
          </table>
        </>
      )}

      {chs.map((f) => {
        const ls = lines.filter((l) => l.channel === f.name);
        const t = tot(ls);
        const fx = f.currency !== "JPY";
        const r = data.rates.find((x) => x.currency === f.currency);
        return (
          <div key={f.name}>
            <h3>{f.name}<small>{t.n}件・粗利 {fmtY(t.profit)}{fx && r ? `・${CUR_NAME[f.currency]}は ${r.rate.toFixed(2)}円で換算` : ""}</small></h3>
            <table>
              <thead><tr><th>日付</th><th>管理番号</th><th>商品名</th>{fx && <th className="n">売値（{SIGN[f.currency]}）</th>}<th className="n">売値（円）</th><th className="n">設定送料</th><th className="n">実送料</th><th className="n">手数料</th><th className="n">原価</th><th className="n">粗利</th></tr></thead>
              <tbody>
                {ls.map((l, i) => (
                  <tr key={i} className={l.kind !== "sale" ? "adj" : ""}>
                    <td>{l.date}</td><td>{l.codes}</td>
                    <td>{l.kind !== "sale" && <b>{l.kind === "return" ? "【返品】" : "【返金】"}</b>}{l.name}{l.note && <div className="lnote">{l.note}</div>}</td>
                    {fx && <td className="n">{l.priceForeign == null ? "—" : `${SIGN[f.currency]}${l.priceForeign.toFixed(2)}`}</td>}
                    <td className="n">{fmtY(l.price)}</td><td className="n">{f.currency === "JPY" && !l.ship ? "—" : fmtY(l.ship)}</td>
                    <td className="n">{fmtY(l.real)}{l.tentative && <> <span className="tmp">仮</span></>}</td>
                    <td className="n">{fmtY(l.fee)}</td><td className="n">{fmtY(l.cost)}</td>
                    <td className={`n${l.profit < 0 ? " neg" : ""}`}>{fmtY(l.profit)}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td colSpan={fx ? 4 : 3}>{f.name} 合計</td><td className="n">{fmtY(t.price)}</td><td className="n">{fmtY(t.ship)}</td><td className="n">{fmtY(t.real)}</td>
                  <td className="n">{fmtY(t.fee)}</td><td className="n">{fmtY(t.cost)}</td><td className="n">{fmtY(t.profit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="rnote">
        売上高 ＝ 売値（円）＋ 設定送料（円）。振込予定額 ＝ 売上高 − 販売手数料 − 振込から引かれる送料（販路の設定で「販路の振込から引かれる」にした販路）。原価は仕入先の請求書で登録済みのため、振込の計算には入れません。<br />
        粗利 ＝ 売値（円）＋ 設定送料（円）− 実送料 − 手数料（円）− 原価。外貨の販路は{data.rates.every((r) => r.final) ? `${mon(month)}の平均TTM` : "仮のレート"}で円に換算しています。<br />
        返品は、売れた月の行はそのまま残し、返品した月にマイナスの行で載せます（手数料は運営から返されます）。一部返金で法人口座から振り込んだものは、振込の突き合わせとfreee取込用CSVには入れず、粗利だけから引きます。<br />
        {tmpN > 0 && <><span className="tmp">仮</span> の印は、送料がまだ仮の金額の販売です（{tmpN}件）。<br /></>}
        廃棄・備品にした商品は売上に入れていません。
      </div>
    </>
  );
}
