"use client";
// 為替レート（月初のTTMで仮に計算 → 月が終わったら月中平均のTTMで確定）
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncRates, finalizeMonth, unfinalizeMonth, saveRateByHand } from "@/lib/fx-actions";
import { toast, esc } from "@/lib/toast";
import { ask } from "@/lib/ask";

type Cur = "EUR" | "USD";
export type FxMonth = {
  month: string; // "2026-10"
  ended: boolean;
  first: Partial<Record<Cur, { date: string; ttm: number; source: string }>>; // 月初のTTM（仮）
  avg: Partial<Record<Cur, { ttm: number; source: string }>>; // 月中平均（確定に使う）
  sales: number; // 外貨の販売の件数
  finalCount: number; // そのうち確定した件数
};

const SIGN: Record<Cur, string> = { EUR: "€", USD: "$" };
const label = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

export function FxPanel({ months }: { months: FxMonth[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hand, setHand] = useState<{ kind: "day" | "month"; key: string; currency: Cur; ttm: string } | null>(null);

  const sync = () =>
    start(async () => {
      const r = await syncRates();
      router.refresh();
      toast(!r.ok ? esc(r.error) : r.added.length ? `取り込みました：${esc(r.added.join("、"))}` : "新しいレートはありませんでした（もう全部あります）");
    });
  const fix = (m: FxMonth) =>
    start(async () => {
      const r = await finalizeMonth(m.month);
      if (!r.ok) { toast(esc(r.error)); return; }
      router.refresh();
      const rs = Object.entries(r.rates).map(([c, v]) => `1${SIGN[c as Cur]} = ${v}円`).join("、");
      toast(`${label(m.month)}の外貨の販売 ${r.count}件を、月中平均（${rs}）で確定しました`, async () => {
        const u = await unfinalizeMonth(m.month);
        router.refresh();
        return u.ok ? `取り消しました。${label(m.month)}は月初のTTMの仮の計算に戻りました` : esc(u.error ?? "");
      });
    });
  const unfix = (m: FxMonth) => {
    start(async () => {
      if (!(await ask(`${label(m.month)}の確定を取り消して、月初のTTMの仮の計算に戻しますか？`, "確定を取り消す"))) return;
      const u = await unfinalizeMonth(m.month);
      router.refresh();
      toast(u.ok ? `${label(m.month)}の確定を取り消しました` : esc(u.error ?? ""));
    });
  };
  const saveHand = () => {
    if (!hand) return;
    const v = Number(hand.ttm.normalize("NFKC").replace(/[円\s,]/g, ""));
    if (!(v > 0)) { toast("レートは数字で入れてください（例：177.36）"); return; }
    start(async () => {
      const r = await saveRateByHand({ ...hand, ttm: v });
      if (!r.ok) { toast(esc(r.error ?? "")); return; }
      setHand(null);
      router.refresh();
      toast("レートを保存しました");
    });
  };

  const rateCell = (m: FxMonth, c: Cur, kind: "first" | "avg") => {
    const v = kind === "first" ? m.first[c] : m.avg[c];
    const key = kind === "first" ? m.first[c]?.date ?? `${m.month}-01` : m.month;
    return (
      <>
        {v ? <b>{v.ttm.toFixed(2)}円</b> : <span className="muted">—</span>}
        {kind === "first" && m.first[c] && <small className="muted">（{m.first[c]!.date.slice(5).replace("-", "/")}）</small>}
        {v?.source === "manual" && <> <span className="tag t-temp">手入力</span></>}
        {(kind === "first" || m.ended) && (
          <button className="linkbtn" disabled={pending} onClick={() => setHand({ kind: kind === "first" ? "day" : "month", key, currency: c, ttm: v ? String(v.ttm) : "" })}>
            {v ? "直す" : "手で入れる"}
          </button>
        )}
      </>
    );
  };

  return (
    <div>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        外貨（ユーロ・ドル）の販路は、売れた月の<b>平均TTM</b>（三菱UFJ銀行の月中平均）で円に換算します。月の途中は、その月の<b>月初のTTM</b>で仮に計算しておき（画面に「仮」と表示）、月が終わったら「確定する」で計算し直します。
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 10px" }}>
        <button className="btn primary" disabled={pending} onClick={sync}>最新のレートを取り込む</button>
        <span className="muted" style={{ alignSelf: "center" }}>三菱UFJリサーチ＆コンサルティングの「外国為替相場」のページから読み込みます</span>
      </div>
      <div className="card tablewrap" style={{ padding: "4px 8px" }}>
        <table id="fxTable">
          <thead>
            <tr>
              <th>月</th><th>€ 月初のTTM（仮）</th><th>$ 月初のTTM（仮）</th><th>€ 月中平均</th><th>$ 月中平均</th><th>外貨の販売</th><th></th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const allFinal = m.sales > 0 && m.finalCount === m.sales;
              return (
                <tr key={m.month}>
                  <td><b>{label(m.month)}</b>{!m.ended && <> <span className="tag t-list">今月</span></>}</td>
                  <td>{rateCell(m, "EUR", "first")}</td>
                  <td>{rateCell(m, "USD", "first")}</td>
                  <td>{m.ended ? rateCell(m, "EUR", "avg") : <span className="muted">月が終わってから</span>}</td>
                  <td>{m.ended ? rateCell(m, "USD", "avg") : <span className="muted">月が終わってから</span>}</td>
                  <td>
                    {m.sales === 0 ? <span className="muted">なし</span>
                      : allFinal ? <><span className="tag t-sold">確定</span> {m.sales}件</>
                      : <><span className="tag t-temp">仮</span> {m.sales - m.finalCount}件{m.finalCount > 0 && <span className="muted">（確定 {m.finalCount}件）</span>}</>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {m.ended && m.sales > 0 && !allFinal && <button className="btn primary" disabled={pending} onClick={() => fix(m)}>確定する</button>}
                    {m.ended && allFinal && <button className="linkbtn" disabled={pending} onClick={() => unfix(m)}>確定を取り消す</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hand && (
        <div className="card" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b>{hand.kind === "day" ? `${hand.key.replace(/-/g, "/")} のTTM` : `${label(hand.key)}の月中平均TTM`}（1{SIGN[hand.currency]}）</b>
          {hand.kind === "day" && (
            <input className="inp" value={hand.key} onChange={(e) => setHand({ ...hand, key: e.target.value })} style={{ width: 120 }} title="日付（2026-11-02 の形）" />
          )}
          <input className="inp" autoFocus inputMode="decimal" placeholder="例：177.36" value={hand.ttm} onChange={(e) => setHand({ ...hand, ttm: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") saveHand(); }} style={{ width: 110, textAlign: "right" }} />円
          <button className="btn primary" disabled={pending} onClick={saveHand}>保存</button>
          <button className="btn" onClick={() => setHand(null)}>やめる</button>
          <span className="muted" style={{ width: "100%" }}>TTMは、TTS（売る値段）とTTB（買う値段）のちょうど真ん中です。ふだんは「最新のレートを取り込む」で自動で入ります。</span>
        </div>
      )}
      <p className="muted">
        すでに確定した月の販売をあとから記録したときは、その月の月中平均で記録します。確定した月に「仮」の販売が残っているときは、もう一度「確定する」を押してください。
      </p>
    </div>
  );
}
