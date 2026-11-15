"use client";
// 販路の設定（画面イメージ docs/mockup/index.html の「販路の設定」と同じ表）
// 選ぶとすぐ保存し、「元に戻す」で前の値に戻せる
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateChannel, addChannel, hideChannel, type ChannelField, type ChannelValue } from "@/lib/channel-actions";
import { toast, esc } from "@/lib/toast";

export type ChannelSetting = {
  id: number; name: string; currency: string; feeMode: string; feeRate: number | null; feeHintRate: number | null;
  usesShippingFee: boolean; shippingPaidBy: string; refundVia: string; undecided: boolean; hidden: boolean; used: number;
};

const CUR = { JPY: "円", EUR: "ユーロ", USD: "ドル" } as const;
const pct = (v: number | null) => (v == null ? "" : String(+(v * 100).toFixed(2)));

export function ChannelSettings({ list }: { list: ChannelSetting[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const save = (c: ChannelSetting, field: ChannelField, value: ChannelValue, label: string) =>
    start(async () => {
      const res = await updateChannel(c.id, field, value);
      if (!res.ok) { toast(esc(res.error)); router.refresh(); return; }
      router.refresh();
      const before = res.before;
      toast(`${esc(c.name)} の${label}を変えました`, async () => {
        await updateChannel(c.id, field, before);
        router.refresh();
        return `取り消しました。${esc(c.name)} の${label}は元に戻りました`;
      });
    });
  const rate = (c: ChannelSetting, field: "feeRate" | "feeHintRate", text: string) => {
    const t = text.normalize("NFKC").replace(/[%\s]/g, "");
    const v = t === "" ? null : Number(t) / 100;
    if (v != null && (Number.isNaN(v) || v < 0 || v > 1)) { toast("率は 0〜100 の数字で入れてください"); router.refresh(); return; }
    if (v === c[field]) return;
    save(c, field, v, field === "feeRate" ? "手数料率" : "手数料の目安");
  };
  const add = () =>
    start(async () => {
      const res = await addChannel(newName);
      if (!res.ok) { toast(esc(res.error)); return; }
      const n = newName;
      setNewName("");
      router.refresh();
      toast(`販路「${esc(n.trim())}」を追加しました。手数料などを選んでください`, async () => {
        await hideChannel(res.id, true);
        router.refresh();
        return "取り消しました";
      });
    });
  const hide = (c: ChannelSetting, h: boolean) =>
    start(async () => {
      const res = await hideChannel(c.id, h);
      if (!res.ok) { toast(esc(res.error ?? "")); return; }
      router.refresh();
      toast(h ? `${esc(c.name)} を一覧から外しました（記録した販売は残っています）` : `${esc(c.name)} を一覧に戻しました`, async () => {
        await hideChannel(c.id, !h);
        router.refresh();
        return "取り消しました";
      });
    });

  const rows = list.filter((c) => showHidden || !c.hidden);
  return (
    <div>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        販路ごとの計算方法です。ここを変えると、「1件ずつ」「まとめて入力」の計算もすぐ変わります（もう記録した販売の金額は変わりません）。粗利の式はすべての販路で共通です：
        <b>売値（円）＋ 設定送料（円）− 実送料 − 手数料（円）− 原価</b>
      </p>
      <div className="card tablewrap" style={{ padding: "4px 8px" }}>
        <table id="chTable">
          <thead>
            <tr>
              <th>販路</th><th>通貨</th><th>為替レート</th><th>手数料</th><th className="n">率</th><th>設定送料</th>
              <th>実送料の払い方</th><th>一部返金のふだんの返し方</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={c.hidden ? { opacity: 0.5 } : undefined}>
                <td>
                  <b>{c.name}</b>
                  {c.undecided && <> <span className="tag t-temp">未定</span></>}
                  {c.hidden && <> <span className="tag t-stock">外した</span></>}
                </td>
                <td>
                  <select value={c.currency} disabled={pending || c.hidden} onChange={(e) => save(c, "currency", e.target.value, "通貨")}>
                    {Object.entries(CUR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td className="muted">{c.currency === "JPY" ? "—" : `売れた月の平均TTM（${c.currency === "EUR" ? "ユーロ円" : "ドル円"}）`}</td>
                <td>
                  <select value={c.feeMode} disabled={pending || c.hidden} onChange={(e) => save(c, "feeMode", e.target.value, "手数料の出し方")}>
                    <option value="auto">売値の○%で自動</option>
                    <option value="manual">毎回入力</option>
                    <option value="none">なし</option>
                  </select>
                </td>
                <td className="n" style={{ whiteSpace: "nowrap" }}>
                  {c.feeMode === "none" ? <span className="muted">—</span> : (
                    <>
                      {c.feeMode === "manual" && <span className="muted">目安 </span>}
                      <input
                        key={`${c.id}-${c.feeMode}-${c.feeMode === "auto" ? c.feeRate : c.feeHintRate}`}
                        className="n" style={{ width: 60 }} disabled={pending || c.hidden}
                        defaultValue={pct(c.feeMode === "auto" ? c.feeRate : c.feeHintRate)}
                        placeholder={c.feeMode === "manual" ? "なし" : ""}
                        onBlur={(e) => rate(c, c.feeMode === "auto" ? "feeRate" : "feeHintRate", e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />%
                    </>
                  )}
                </td>
                <td>
                  <select value={c.usesShippingFee ? "1" : "0"} disabled={pending || c.hidden} onChange={(e) => save(c, "usesShippingFee", e.target.value === "1", "設定送料")}>
                    <option value="1">使う</option><option value="0">使わない</option>
                  </select>
                </td>
                <td>
                  <select value={c.shippingPaidBy} disabled={pending || c.hidden} onChange={(e) => save(c, "shippingPaidBy", e.target.value, "実送料の払い方")}>
                    <option value="payout">販路の振込から引かれる</option><option value="bank">法人口座から払う</option>
                  </select>
                </td>
                <td>
                  <select value={c.refundVia} disabled={pending || c.hidden} onChange={(e) => save(c, "refundVia", e.target.value, "一部返金の返し方")}>
                    <option value="payout">販路の振込から引かれる</option><option value="bank">法人口座から振り込む</option>
                  </select>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {c.hidden
                    ? <button className="linkbtn" disabled={pending} onClick={() => hide(c, false)}>戻す</button>
                    : <>
                        {c.undecided && <button className="linkbtn" disabled={pending} onClick={() => save(c, "undecided", false, "「未定」の印")}>決まった</button>}
                        <button className="linkbtn" disabled={pending} onClick={() => hide(c, true)} title={c.used ? `記録した販売 ${c.used}件はそのまま残ります` : ""}>外す</button>
                      </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <input placeholder="新しい販路の名前（例：ラクマ）" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }}
          style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, font: "inherit", minWidth: 220 }} />
        <button className="btn" disabled={pending || !newName.trim()} onClick={add}>＋ 販路を追加</button>
        {list.some((c) => c.hidden) && (
          <label className="muted" style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> 外した販路も見る
          </label>
        )}
      </div>
      <p className="muted">
        「毎回入力」の販路は、目安の率から大きく外れたときに知らせます（打ち間違い防止）。「未定」の印がある販路は、出品先の候補に出ません。<br />
        「実送料の払い方」「一部返金のふだんの返し方」は、月次レポートの振込予定額とfreeeの取込用CSVに使います。「法人口座から」にしたものは、freeeでは銀行の明細から登録するので、CSVには入れません（二重にならないように）。一部返金の返し方は、記録するときにその都度変えることもできます。
      </p>
    </div>
  );
}
