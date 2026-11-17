"use client";
// 初めての形の伝票CSVを入れたときに、どの列が「商品名」「原価」などかを選んでもらう画面
// 「覚えて読み込む」で形式を保存すると、次からは同じ形の伝票を自動で読む
import { useEffect, useMemo, useRef, useState } from "react";
import { applyFormat, guessHeader, signatureOf, type SlipFormat, type SlipResult } from "@/lib/slip";
import { saveSlipFormat } from "@/lib/slip-actions";
import { yen } from "@/lib/format";

const colName = (i: number) => String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1); // A, B, C…
const find = (head: string[], re: RegExp) => { const i = head.findIndex((h) => re.test(h)); return i < 0 ? null : i; };

export function SlipMapDialog({ rows, fileName, onClose, onDone }: {
  rows: string[][]; fileName: string; onClose: () => void; onDone: (r: SlipResult, formatName: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);

  const [hi, setHi] = useState(() => guessHeader(rows));
  const head = rows[hi] ?? [];
  const width = Math.max(...rows.slice(hi, hi + 30).map((r) => r.length), 1);
  const guess = useMemo(() => {
    const h = (rows[hi] ?? []).map((c) => c.trim());
    const total = find(h, /小計|合計|総額/);
    return {
      nameCol: find(h, /商品名|品名|タイトル|品目|商品/),
      costCols: total != null ? [total] : (() => { const p = find(h, /落札|金額|価格|単価/); return p == null ? [] : [p]; })(),
      qtyCol: find(h, /数量|個数/),
      dateCol: find(h, /開催日|日付|購入日|落札日/),
    };
  }, [rows, hi]);
  const [nameCol, setNameCol] = useState<number | null>(guess.nameCol);
  const [costCols, setCostCols] = useState<number[]>(guess.costCols);
  const [qtyCol, setQtyCol] = useState<number | null>(guess.qtyCol);
  const [expCol, setExpCol] = useState<number | null>(null);
  const [dateCol, setDateCol] = useState<number | null>(guess.dateCol);
  const [supplier, setSupplier] = useState("");
  const [name, setName] = useState(fileName.replace(/\.csv$/i, ""));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // 見出しの行を変えたら、選び直す
  const changeHeader = (n: number) => {
    setHi(n);
    const h = (rows[n] ?? []).map((c) => c.trim());
    const total = find(h, /小計|合計|総額/);
    setNameCol(find(h, /商品名|品名|タイトル|品目|商品/));
    setCostCols(total != null ? [total] : (() => { const p = find(h, /落札|金額|価格|単価/); return p == null ? [] : [p]; })());
    setQtyCol(find(h, /数量|個数/));
    setDateCol(find(h, /開催日|日付|購入日|落札日/));
    setExpCol(null);
  };

  const fmt: SlipFormat | null = nameCol != null && costCols.length
    ? { name: name.trim(), signature: signatureOf(head), nameCol, costCols, qtyCol, expCol, dateCol, supplier: supplier.trim() || null }
    : null;
  const preview = fmt ? applyFormat(rows, fmt, hi) : null;
  const label = (i: number) => `${colName(i)}列${head[i]?.trim() ? `「${head[i].trim()}」` : ""}`;
  const opts = (
    <>
      <option value="">（使わない）</option>
      {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{label(i)}</option>)}
    </>
  );
  const pick = (v: string) => (v === "" ? null : Number(v));

  const go = async (remember: boolean) => {
    setErr("");
    if (!fmt || !preview) { setErr("「商品名」と「原価」の列を選んでください"); return; }
    if (!preview.lines.length) { setErr("商品の行が見つかりません。見出しの行を確かめてください"); return; }
    const r = { ...preview, supplier: fmt.supplier ?? "" };
    if (remember) {
      if (!fmt.name) { setErr("形式の名前を入れてください（例：〇〇オークション）"); return; }
      setBusy(true);
      const res = await saveSlipFormat(fmt);
      setBusy(false);
      if (!res.ok) { setErr(res.error); return; }
      onDone(r, fmt.name);
    } else onDone(r, null);
  };

  return (
    <dialog ref={ref} className="itemdlg" style={{ maxWidth: 980, width: "96vw" }} onClose={onClose}>
      <div className="dlghead">
        <div><div className="muted">{fileName}</div><h2 style={{ margin: "2px 0 0" }}>初めての形の伝票です。列を選んでください</h2></div>
        <button className="x" title="閉じる" onClick={onClose}>×</button>
      </div>
      <p className="muted" style={{ margin: "0 0 10px" }}>
        「覚えて読み込む」を押すと、この形を覚えて、次からは同じ形の伝票を自動で読みます。原価の列は、いくつか選ぶと足し算します（単価＋税＋手数料 など）。
      </p>

      <div className="mapgrid">
        <label>見出しの行
          <select value={hi} onChange={(e) => changeHeader(Number(e.target.value))}>
            {rows.slice(0, 40).map((r, i) => <option key={i} value={i}>{i + 1}行目：{r.filter((c) => c.trim()).slice(0, 4).join("・").slice(0, 40) || "（空）"}</option>)}
          </select>
        </label>
        <label>商品名 <b className="req">必須</b>
          <select value={nameCol ?? ""} onChange={(e) => setNameCol(pick(e.target.value))}>{opts}</select>
        </label>
        <label>個数<select value={qtyCol ?? ""} onChange={(e) => setQtyCol(pick(e.target.value))}>{opts}</select></label>
        <label>予想売価<select value={expCol ?? ""} onChange={(e) => setExpCol(pick(e.target.value))}>{opts}</select></label>
        <label>仕入日<select value={dateCol ?? ""} onChange={(e) => setDateCol(pick(e.target.value))}>{opts}</select></label>
        <label>仕入先（いつもの名前）<input className="inp" value={supplier} placeholder="例：〇〇オークション" onChange={(e) => setSupplier(e.target.value)} /></label>
      </div>
      <div style={{ margin: "10px 0" }}>
        <b>原価</b> <b className="req">必須</b> <span className="muted">（税・手数料込みの金額。複数選ぶと足し算）</span>
        <div className="chips" style={{ marginTop: 6 }}>
          {Array.from({ length: width }, (_, i) => {
            const on = costCols.includes(i);
            return (
              <button key={i} className={`chipbtn${on ? " on" : ""}`} onClick={() => setCostCols(on ? costCols.filter((c) => c !== i) : [...costCols, i].sort((a, b) => a - b))}>
                {on ? "✓ " : ""}{label(i)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sec" style={{ marginTop: 6 }}>CSVの中身（見出しの行から）</div>
      <div className="tablewrap" style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
        <table className="small">
          <thead><tr><th></th>{Array.from({ length: width }, (_, i) => <th key={i} style={{ background: i === nameCol ? "var(--blue-soft, #e8f0fe)" : costCols.includes(i) ? "var(--green-soft, #e7f6ec)" : undefined }}>{colName(i)}</th>)}</tr></thead>
          <tbody>
            {rows.slice(hi, hi + 12).map((r, ri) => (
              <tr key={ri} style={ri === 0 ? { fontWeight: 700 } : undefined}>
                <td className="muted">{hi + ri + 1}</td>
                {Array.from({ length: width }, (_, i) => <td key={i} style={{ whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r[i] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <>
          <div className="sec">読み込むとこうなります（{preview.lines.length}件）</div>
          <table className="calc small">
            <tbody>
              {preview.lines.slice(0, 5).map((l, i) => (
                <tr key={i}><td>{l[2]}{l[7] && l[7] !== "1" ? `　×${l[7]}` : ""}</td><td className="n">{/^\d+$/.test(l[6]) ? yen(Number(l[6])) : <span className="down">{l[6] || "原価なし"}</span>}</td></tr>
              ))}
              {preview.lines.length > 5 && <tr><td className="muted">ほか {preview.lines.length - 5}件</td><td></td></tr>}
            </tbody>
          </table>
        </>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>形式の名前<input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：〇〇オークション" /></label>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>やめる</button>
        <button className="btn" disabled={busy} onClick={() => go(false)}>今回だけ読み込む</button>
        <button className="btn primary" disabled={busy} onClick={() => go(true)}>覚えて読み込む</button>
      </div>
      {err && <p className="err" style={{ margin: "8px 0 0" }}>{err}</p>}
    </dialog>
  );
}
