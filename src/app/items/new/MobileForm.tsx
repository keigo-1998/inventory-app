"use client";
// スマホでの登録（1件ずつ入れて、リストにためてからまとめて登録）。docs/data-design.md「スマホでの登録」
import { useMemo, useRef, useState } from "react";
import { guessGenre } from "@/lib/genre-guess";
import { allocateCost, padNo } from "@/lib/lot";
import { yen } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { RegisterRow } from "@/lib/register-actions";
import { num } from "./sheet";

const YAMA_WORDS = /まとめ|山売り|ロット|大量|詰め合わせ|\d+点/;
type Kid = { name: string; exp: string };
type Entry = { kind: "単品" | "山"; name: string; genre: string; cost: number; exp: number; qty: number; kids: { name: string; exp: number }[]; sup: string; date: string };

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

export function MobileForm({ genres, nextNo, onRegister }: { genres: string[]; nextNo: number; onRegister: (rows: RegisterRow[]) => Promise<boolean> }) {
  const [sup, setSup] = useState("");
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState<"単品" | "山">("単品");
  const [kindAuto, setKindAuto] = useState(true);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [genreAuto, setGenreAuto] = useState(true);
  const [cost, setCost] = useState("");
  const [exp, setExp] = useState("");
  const [qty, setQty] = useState(1);
  const [kids, setKids] = useState<Kid[]>([]);
  const [list, setList] = useState<Entry[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const no = (i: number) => padNo(nextNo + i);
  const al = useMemo(() => allocateCost(num(cost) || 0, kids.map((k) => num(k.exp) || 0)), [cost, kids]);
  const base = no(list.length);
  const hasKidExp = kids.some((k) => (num(k.exp) || 0) > 0);

  const changeKind = (k: "単品" | "山") => { setKind(k); if (k === "山" && !kids.length) setKids([{ name: "", exp: "" }]); };
  const onName = (v: string) => {
    setName(v);
    if (genreAuto) setGenre(guessGenre(v, genres));
    if (kindAuto) changeKind(YAMA_WORDS.test(v) ? "山" : "単品");
  };

  const add = () => {
    const c = num(cost), e = num(exp);
    const errs: string[] = [];
    if (!name.trim()) errs.push("商品名を入れてください");
    if (c == null || Number.isNaN(c)) errs.push("原価を数字で入れてください（0円でもOK）");
    if (e != null && Number.isNaN(e)) errs.push("予想売価は数字で入れてください");
    if (!date) errs.push("仕入日を入れてください");
    setErr(errs.join("　"));
    if (errs.length) return;
    const ks = kind === "山" ? kids.filter((k) => k.name.trim()).map((k) => ({ name: k.name.trim(), exp: num(k.exp) || 0 })) : [];
    setList((l) => [...l, { kind, name: name.trim(), genre, cost: c!, exp: e || 0, qty, kids: ks, sup: sup.trim(), date }]);
    const added = no(list.length) + (kind === "山" ? "-0" : "");
    setName(""); setCost(""); setExp(""); setKind("単品"); setKindAuto(true); setGenre(""); setGenreAuto(true); setQty(1); setKids([]);
    nameRef.current?.focus();
    toast(`${added} を追加しました`);
  };

  const register = async () => {
    setBusy(true);
    const rows: RegisterRow[] = list.map((r, i) => ({
      kind: r.kind, code: no(i) + (r.kind === "山" ? "-0" : ""), name: r.name, genre: r.genre, supplier: r.sup,
      date: r.date.replace(/-/g, "/"), cost: r.cost, qty: r.qty, exp: r.exp || null, kids: r.kids,
    }));
    const ok = await onRegister(rows);
    setBusy(false);
    if (ok) setList([]);
  };

  return (
    <div className="mobonly mf">
      <div className="card mcommon">
        <div className="muted" style={{ fontSize: 12 }}>仕入れの情報（続けて登録するとき、そのまま使います）</div>
        <div className="row2">
          <label>仕入先<input value={sup} onChange={(e) => setSup(e.target.value)} placeholder="例：オークション（関東）" /></label>
          <label>仕入日<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
      </div>
      <div className="card">
        <div className="seg">
          {(["単品", "山"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKindAuto(false); changeKind(k); }}>{k === "山" ? "山（まとめて仕入れ）" : "単品"}</button>
          ))}
        </div>
        <label>商品名<input ref={nameRef} value={name} onChange={(e) => onName(e.target.value)} placeholder="例：CASIO G-SHOCK" autoComplete="off" /></label>
        <div className="flabel">ジャンル <span className="auto-txt">{genre && genreAuto ? "商品名から推測しました（違えば押して選び直し）" : ""}</span></div>
        <div className="gchips">
          {genres.map((g) => (
            <button key={g} className={`chipbtn${g === genre ? " on" : ""}`} onClick={() => { setGenre(genre === g && !genreAuto ? "" : g); setGenreAuto(false); }}>{g}</button>
          ))}
        </div>
        <div className="row2">
          <label>{kind === "山" ? "仕入額（円）" : "原価（円）"}<input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /></label>
          <label>予想売価（円）<input inputMode="numeric" value={exp} onChange={(e) => setExp(e.target.value)} placeholder="0" /></label>
        </div>
        {kind === "単品" ? (
          <>
            <div className="flabel">個数</div>
            <div className="stepper"><button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button><b>{qty}</b><button onClick={() => setQty((q) => q + 1)}>＋</button></div>
          </>
        ) : (
          <div>
            <div className="flabel">山の中身（売ると決めたものだけ。あとから足せます）</div>
            {kids.map((k, i) => (
              <div className="kid" key={i}>
                <input placeholder="中身の商品名" value={k.name} onChange={(e) => setKids((ks) => ks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input inputMode="numeric" placeholder="予想売価" value={k.exp} onChange={(e) => setKids((ks) => ks.map((x, j) => (j === i ? { ...x, exp: e.target.value } : x)))} />
                <button className="x" onClick={() => setKids((ks) => ks.filter((_, j) => j !== i))}>×</button>
                <div className="al">{base}-{i + 1}　原価 {yen(al[i] ?? 0)}</div>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {hasKidExp ? `${base}-0（山の残り）は原価0円になります` : "中身を入れないときは、原価はまるごと山（-0）に入ります"}
            </div>
            <button className="btn" style={{ width: "100%" }} onClick={() => setKids((ks) => [...ks, { name: "", exp: "" }])}>＋ 中身を追加</button>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>原価は、中身の予想売価の比率で全部割り振ります</div>
          </div>
        )}
        <div className="mno">管理番号 <b>{base}{kind === "山" ? "-0" : ""}</b> <span className="muted">（自動）</span></div>
        <p className="merr">{err}</p>
        <button className="btn primary big" onClick={add}>リストに追加して、次を入力</button>
      </div>
      <div className="sec">今回登録するもの <span className="muted">{list.length ? `${list.length}件・原価の合計 ${yen(list.reduce((a, r) => a + r.cost, 0))}` : ""}</span></div>
      <div>
        {list.length ? list.map((r, i) => (
          <div className="mitem" key={i}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>{no(i)}{r.kind === "山" ? "-0" : ""}・{r.genre || "ジャンル未設定"}{r.kind === "山" && <>　<span className="tag t-yama">山</span></>}</div>
              <div className="name">{r.name}</div>
              <div className="meta">原価 {yen(r.cost)} / 予想 {yen(r.exp)}{r.kind === "山" ? `・中身 ${r.kids.length}点` : `・${r.qty}個`}　{r.sup}</div>
            </div>
            <button className="x" title="外す" onClick={() => { setList((l) => l.filter((_, j) => j !== i)); toast(`「${r.name.replace(/</g, "&lt;")}」をリストから外しました`); }}>×</button>
          </div>
        )) : <div className="muted" style={{ padding: "4px 0 8px" }}>まだありません。上で入力して「リストに追加」を押してください。</div>}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>伝票のCSVを取り込むときは、パソコンの「＋ 商品を登録」画面が便利です。</p>
      {list.length > 0 && (
        <div className="mbar"><button className="btn primary big" disabled={busy} onClick={register}>{list.length}件を登録する</button></div>
      )}
    </div>
  );
}
