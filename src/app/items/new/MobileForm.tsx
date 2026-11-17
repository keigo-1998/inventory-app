"use client";
// スマホでの登録（1件ずつ入れて、リストにためてからまとめて登録）。docs/data-design.md「スマホでの登録」
import { useMemo, useRef, useState } from "react";
import { guessGenre } from "@/lib/genre-guess";
import { allocateCost, padNo, stackNo } from "@/lib/lot";
import { yen } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { RegisterRow } from "@/lib/register-actions";
import { num } from "./sheet";

const YAMA_WORDS = /まとめ|山売り|ロット|大量|詰め合わせ|\d+点/;
type Kid = { name: string; exp: string };
type Kind = "単品" | "山" | "縦積";
type Entry = { kind: Kind; name: string; genre: string; cost: number; exp: number; qty: number; kids: { name: string; exp: number }[]; sup: string; date: string };

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

export function MobileForm({ genres, nextNo, nextStack, onRegister }: { genres: string[]; nextNo: number; nextStack: number; onRegister: (rows: RegisterRow[]) => Promise<boolean> }) {
  const [sup, setSup] = useState("");
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState<Kind>("単品");
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

  /** i件目の管理番号（縦積は L の続き、ほかはふつうの番号の続き）。suffix=false なら山の -0 を付けない */
  const codeAt = (es: { kind: Kind }[], i: number, suffix = true) => {
    const before = es.slice(0, i);
    if (es[i].kind === "縦積") return stackNo(nextStack + before.filter((e) => e.kind === "縦積").length);
    return padNo(nextNo + before.filter((e) => e.kind !== "縦積").length) + (suffix && es[i].kind === "山" ? "-0" : "");
  };
  const al = useMemo(() => allocateCost(num(cost) || 0, kids.map((k) => num(k.exp) || 0)), [cost, kids]);
  const base = codeAt([...list, { kind }], list.length, false);
  const hasKidExp = kids.some((k) => (num(k.exp) || 0) > 0);

  const changeKind = (k: Kind) => { setKind(k); if (k === "山" && !kids.length) setKids([{ name: "", exp: "" }]); };
  /** 個数を変える。種類を自分で選んでいなければ、2個以上で縦積、1個で単品にする */
  const changeQty = (q: number) => { setQty(q); if (kindAuto && kind !== "山") setKind(q >= 2 ? "縦積" : "単品"); };
  const onName = (v: string) => {
    setName(v);
    if (genreAuto) setGenre(guessGenre(v, genres));
    if (kindAuto) changeKind(YAMA_WORDS.test(v) ? "山" : qty >= 2 ? "縦積" : "単品");
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
    const added = codeAt([...list, { kind }], list.length);
    setName(""); setCost(""); setExp(""); setKind("単品"); setKindAuto(true); setGenre(""); setGenreAuto(true); setQty(1); setKids([]);
    nameRef.current?.focus();
    toast(`${added} を追加しました`);
  };

  const register = async () => {
    setBusy(true);
    const rows: RegisterRow[] = list.map((r, i) => ({
      kind: r.kind, code: codeAt(list, i), name: r.name, genre: r.genre, supplier: r.sup,
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
          {(["単品", "山", "縦積"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKindAuto(false); changeKind(k); }}>{k}</button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, margin: "-4px 0 8px" }}>
          {kind === "山" ? "山：まとめて仕入れたもの（中身は枝番にできます）" : kind === "縦積" ? "縦積：同じ型番の商品が複数あるとき（番号は L から）" : "単品：1点ずつの商品"}
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
        {kind !== "山" ? (
          <>
            <div className="flabel">個数</div>
            <div className="stepper"><button onClick={() => changeQty(Math.max(1, qty - 1))}>−</button><b>{qty}</b><button onClick={() => changeQty(qty + 1)}>＋</button></div>
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
              <div className="muted" style={{ fontSize: 12 }}>{codeAt(list, i)}・{r.genre || "ジャンル未設定"}{r.kind === "山" && <>　<span className="tag t-yama">山</span></>}{r.kind === "縦積" && <>　<span className="tag t-list">縦積</span></>}</div>
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
