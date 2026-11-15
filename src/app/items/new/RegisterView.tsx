"use client";
// 商品を登録する画面。パソコンはスプレッドシート風の表、スマホは1件ずつの入力（画面の幅で切り替わる）
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registerItems, undoRegister, type RegisterRow } from "@/lib/register-actions";
import { nextNumber, padNo } from "@/lib/lot";
import { toast, esc } from "@/lib/toast";
import { initSheet } from "./sheet";
import { MobileForm } from "./MobileForm";
import { SlipMapDialog } from "./SlipMapDialog";
import { recordExpense, removeExpense } from "@/lib/expense-actions";
import { forgetSlipFormat } from "@/lib/slip-actions";
import type { SlipFormat } from "@/lib/slip";
import { yen } from "@/lib/format";

export function RegisterView({ codes, genres, formats }: { codes: string[]; genres: string[]; formats: SlipFormat[] }) {
  const [unknown, setUnknown] = useState<{ rows: string[][]; fileName: string } | null>(null);
  const [fee, setFee] = useState<{ amount: number; date: string; supplier: string; saved?: boolean } | null>(null);
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<ReturnType<typeof initSheet> | null>(null);
  const codesRef = useRef(codes);
  codesRef.current = codes;
  const nextNo = nextNumber(codes);

  /** 登録する。うまくいけば true（「元に戻す」付きのお知らせを出す） */
  const onRegister = async (rows: RegisterRow[]) => {
    const res = await registerItems(rows);
    if (!res.ok) {
      toast(`<span style="color:#fca5a5">登録できませんでした</span>：${res.errors.map(esc).join("／")}`);
      return false;
    }
    const all = [...codesRef.current, ...res.codes];
    sheetRef.current?.update({ existing: new Set(all), nextNo: nextNumber(all) });
    router.refresh();
    const range = res.codes.length > 1 ? `${res.codes[0]}〜${res.codes[res.codes.length - 1]}` : res.codes[0];
    toast(`${res.codes.length}件を登録しました（${range}）。<a href="/items" style="color:#93c5fd">商品一覧で見る</a>`, async () => {
      const u = await undoRegister(res.undo);
      router.refresh();
      return u.ok ? "登録を取り消しました（消した印を付けて、履歴に残しています）" : u.error;
    });
    return true;
  };
  const onRegisterRef = useRef(onRegister);
  onRegisterRef.current = onRegister;

  useEffect(() => {
    const s = initSheet(rootRef.current!, {
      existing: new Set(codesRef.current), nextNo: nextNumber(codesRef.current), genres, onRegister: (r) => onRegisterRef.current(r),
      formats, onUnknownSlip: (rows, fileName) => setUnknown({ rows, fileName }), onSlipFee: setFee,
    });
    sheetRef.current = s;
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { sheetRef.current?.setFormats(formats); }, [formats]);

  const saveFee = async () => {
    if (!fee) return;
    const res = await recordExpense({ date: fee.date, category: "入場料", amount: fee.amount, supplier: fee.supplier });
    if (!res.ok) { toast(esc(res.error)); return; }
    setFee({ ...fee, saved: true });
    toast(`入場料 ${yen(fee.amount)} を経費として記録しました。<a href="/expenses" style="color:#93c5fd">経費の一覧で見る</a>`, async () => {
      await removeExpense(res.id);
      setFee({ ...fee, saved: false });
      return "経費の記録を取り消しました";
    });
  };

  return (
    <section ref={rootRef}>
      <h1>商品を登録</h1>
      <MobileForm genres={genres} nextNo={nextNo} onRegister={onRegister} />

      <p className="lead pconly">
        伝票のCSVを入れるか、スプレッドシートからコピーして貼り付けます。山と単品が混ざっていて大丈夫です。山の行は「種類」のマスを押して切り替えます。
        <br />
        <b style={{ color: "var(--text)" }}>管理番号は空けておけば、今ある番号の続き（次は {padNo(nextNo)}）から自動で付きます。</b>
      </p>
      <div className="howto pconly">
        <span><b>ドラッグ</b> 複数のマスを選ぶ</span>
        <span><b>⌘+C / ⌘+V</b> コピー・貼り付け（スプレッドシートからもOK）</span>
        <span><b>右下の■をドラッグ</b> 下にコピー</span>
        <span><b>⌘+D</b> いちばん上の行を下にコピー</span>
        <span><b>Delete</b> まとめて消す</span>
        <span><b>ダブルクリック / 文字を打つ</b> マスを編集</span>
      </div>
      <div className="slipgrid pconly">
        <label className="drop" id="drop">
          <input type="file" id="slipFile" accept=".csv,text/csv" hidden />
          <b>伝票のCSVをここにドラッグ</b><span className="muted">またはクリックしてファイルを選ぶ</span>
        </label>
        <div className="card slipbar">
          <div className="muted" style={{ fontSize: 12 }}>伝票の共通の情報（全部の行に自動で入ります）</div>
          <label>仕入先<input id="slipSupplier" placeholder="例：オークション（関東）" /></label>
          <label>仕入日<input id="slipDate" placeholder="例：2026/11/04" /></label>
          <button className="btn" id="sampleSlip">見本の伝票CSVを入れてみる</button>
        </div>
      </div>
      <p id="slipInfo" className="muted pconly" style={{ margin: "8px 0 0" }}></p>
      {fee && (
        <div className="card pconly" style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>この伝票の<b>入場料 {yen(fee.amount)}</b>（{fee.date}・{fee.supplier || "仕入先なし"}）は、商品の原価に入れず経費として記録します。</span>
          {fee.saved ? <span className="tag t-sold">経費に記録しました</span> : <button className="btn primary" onClick={saveFee}>経費として記録する</button>}
        </div>
      )}
      {formats.length > 0 && (
        <details className="pconly" style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>覚えている伝票の形式（{formats.length}）</summary>
          <ul className="muted" style={{ margin: "4px 0", paddingLeft: 18 }}>
            {formats.map((f) => (
              <li key={f.id}>{f.name}{f.supplier ? `（仕入先：${f.supplier}）` : ""}{" "}
                <button className="linkbtn" onClick={async () => { if (!confirm(`伝票の形式「${f.name}」を忘れますか？次にこの形の伝票を入れたときに、もう一度列を選びます。`)) return; await forgetSlipFormat(f.id!); router.refresh(); toast(`「${esc(f.name)}」を忘れました`); }}>忘れる</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {unknown && (
        <SlipMapDialog
          rows={unknown.rows}
          fileName={unknown.fileName}
          onClose={() => setUnknown(null)}
          onDone={(r, name) => { setUnknown(null); sheetRef.current?.loadResult(r, unknown.fileName, name); setFee(null); router.refresh(); }}
        />
      )}
      <div className="sheet-wrap pconly">
        <table className="sheet" id="sheet" tabIndex={0}></table>
      </div>
      <div className="sheet-tools pconly">
        <button className="btn" id="addRows">＋ 10行追加</button>
        <button className="btn" id="clear">すべて消す</button>
        <span className="legend2">
          <b style={{ fontWeight: 600 }}>ジャンル</b>は商品名から推測して自動で入れます（▾ で選び直せます）　<span className="tag t-yama">山</span>/<span className="tag t-stock">単品</span> 押すと切り替え　<i className="sw auto"></i>自動で入れたマス　<i className="sw err"></i>直すところ
        </span>
      </div>
      <div className="card regbar pconly">
        <div><b id="summary">まだ何も入っていません</b><ul id="errlist"></ul><ul id="warnlist" className="warnlist"></ul></div>
        <button className="btn primary" id="doReg" disabled>この内容で登録する</button>
      </div>
    </section>
  );
}
