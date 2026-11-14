"use client";
// 山の画面（画面イメージ docs/mockup/index.html の「山の画面」と同じ見た目・操作）
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addBranches, undoBranches } from "@/lib/lot-actions";
import { isFixed, reallocate } from "@/lib/lot";
import { yen } from "@/lib/format";
import { toast } from "@/lib/toast";

export type LotRow = {
  id: number; code: string; name: string; exp: number | null; cost: number; status: string;
  channels: string[]; soldChannels: string[]; price: number | null; profit: number | null; costMode: string | null;
};
type LotInfo = { code: string; name: string; totalCost: number; supplier: string; purchasedAt: string };
type NewRow = { name: string; exp: string; mode: "alloc" | "zero" };

const ST: Record<string, [string, string]> = {
  stock: ["未出品", "t-stock"], list: ["出品中", "t-list"], sold: ["売却済み", "t-sold"], disposed: ["廃棄", "t-warn"], fixture: ["備品", "t-stock"],
};
const num = (s: string) => { const v = s.normalize("NFKC").replace(/[¥,円\s]/g, ""); return v === "" || Number.isNaN(+v) ? 0 : Math.max(0, Math.floor(+v)); };
const isHead = (code: string) => code.endsWith("-0");

function Chips({ x }: { x: LotRow }) {
  if (!x.channels.length && !x.soldChannels.length) return <span className="muted">未出品</span>;
  return <>{x.soldChannels.map((c) => <span key={"s" + c} className="chip sold">{c}</span>)}{x.channels.map((c) => <span key={c} className="chip">{c}</span>)}</>;
}

export function LotView({ lot, rows }: { lot: LotInfo; rows: LotRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const branches = rows.filter((x) => !isHead(x.code));
  const head = rows.find((x) => isHead(x.code));
  // 枝番を足すときの原価の付け方：最初の仕分けは「割り振る」、枝番があとから増えるときは「0円で出す」がふつう
  const defMode: NewRow["mode"] = branches.length ? "zero" : "alloc";
  const blankRows = (n: number, mode: NewRow["mode"] = defMode) => Array.from({ length: n }, () => ({ name: "", exp: "", mode }));
  const [news, setNews] = useState<NewRow[]>(() => blankRows(3));

  const sold = branches.filter((x) => isFixed(x.status));
  const sales = rows.filter((x) => x.price != null).reduce((a, x) => a + (x.price ?? 0), 0);
  const profit = rows.filter((x) => x.profit != null).reduce((a, x) => a + (x.profit ?? 0), 0);
  const pct = lot.totalCost ? Math.round((sales / lot.totalCost) * 100) : 0;

  // 入れた行から、番号と原価の見込みを出す（登録するときはサーバーで同じ計算をやり直す）
  const preview = useMemo(() => {
    const next = Math.max(0, ...branches.map((x) => Number(x.code.split("-")[1]))) + 1;
    const filled = news.map((b, i) => ({ i, name: b.name.trim(), exp: num(b.exp), mode: b.mode })).filter((b) => b.name).map((b, k) => ({ ...b, code: `${lot.code}-${next + k}` }));
    const alloc = filled.filter((f) => f.mode === "alloc");
    const pool = lot.totalCost - sold.reduce((a, x) => a + x.cost, 0);
    const map = alloc.length
      ? reallocate(Math.max(0, pool), [
          ...branches.filter((x) => !isFixed(x.status) && x.costMode !== "zero").map((x) => ({ key: x.code, exp: x.exp ?? 0 })),
          ...alloc.map((f) => ({ key: f.code, exp: f.exp })),
        ])
      : {};
    const changed = branches.filter((x) => map[x.code] != null && map[x.code] !== x.cost);
    const expSum = Object.keys(map).reduce((a, c) => a + ((filled.find((f) => f.code === c)?.exp ?? rows.find((x) => x.code === c)?.exp) || 0), 0);
    return { filled, alloc, zero: filled.filter((f) => f.mode === "zero"), map, changed, pool, expSum, next };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news, rows]);

  const setRow = (i: number, patch: Partial<NewRow>) => setNews((ns) => ns.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const register = () =>
    start(async () => {
      const res = await addBranches({ lotCode: lot.code, rows: preview.filled.map((f) => ({ name: f.name, exp: f.exp, mode: f.mode })) });
      if (!res.ok) { toast(`<span style="color:#fca5a5">登録できませんでした</span>：${res.error}`); return; }
      setNews(blankRows(3, "zero")); // 枝番ができたので、次からは「0円で出す」がふつう
      router.refresh();
      const kinds = [res.alloc ? `割り振り ${res.alloc}点` : "", res.zero ? `原価0円 ${res.zero}点` : ""].filter(Boolean).join("・");
      toast(`${res.codes.join("・")} を登録しました（${kinds}）`, async () => {
        const u = await undoBranches(lot.code, res.undo);
        router.refresh();
        return u.ok ? "取り消しました。枝番を登録する前に戻りました" : u.error;
      });
    });

  const { filled, alloc, zero, map, changed, pool, expSum } = preview;
  const msgs: React.ReactNode[] = [];
  if (filled.length) {
    if (alloc.length)
      msgs.push(<>{alloc.length}点に原価を割り振ります。{changed.length ? `まだ売れていない枝番 ${changed.length}点の原価も割り振り直します（上の表の → の金額）。売れた商品の原価は変わりません。` : ""}{head && head.cost && !isFixed(head.status) ? `${head.code}（山の残り）の原価 ${yen(head.cost)} は 0円になります。` : ""}</>);
    if (zero.length) msgs.push(<>{zero.length}点は原価0円で出します。ほかの枝番の原価は変わりません。{head && head.cost && !alloc.length ? `（仕入額 ${yen(head.cost)} は、まだ山の残りに入ったままです）` : ""}</>);
    if (alloc.length && expSum < pool) msgs.push(<span className="down">割り振る枝番の予想売価の合計 {yen(expSum)} が、割り振る原価 {yen(pool)} より少ないので、このままだと赤字の見込みです</span>);
  }

  return (
    <section>
      <p className="muted" style={{ margin: "0 0 6px" }}><Link className="linkbtn" href="/items">← 商品一覧</Link> ＞ 山 {lot.code}</p>
      <div className="lothead"><div>
        <div className="lotnum">{lot.code}-0（山）</div>
        <h1>{lot.name}</h1>
        <p className="lead" style={{ margin: 0 }}>仕入先：{lot.supplier} ／ 仕入日：{lot.purchasedAt}</p>
      </div></div>

      <div className="grid three" style={{ marginTop: 16 }}>
        <div className="kpi"><div className="l">仕入額</div><div className="v">{yen(lot.totalCost)}</div><div className="d muted">全部を枝番に割り振り</div></div>
        <div className="kpi"><div className="l">売上合計</div><div className="v">{yen(sales)}</div></div>
        <div className="kpi"><div className="l">粗利合計</div><div className={`v ${sales ? "up" : ""}`}>{sales ? yen(profit) : "—"}</div></div>
        <div className="kpi"><div className="l">枝番</div><div className="v">{branches.length ? `${sold.length} / ${branches.length}` : "まだなし"}</div><div className="d muted">{branches.length ? "売れた数 / 枝番の数" : "仕分けしたら下で追加"}</div></div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>仕入額の回収</h2>
        <div className="progress"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <div className="muted">売上 {yen(sales)} ÷ 仕入額 {yen(lot.totalCost)} ＝ <b style={sales >= lot.totalCost ? { color: "var(--green)" } : undefined}>{pct}%</b>{sales >= lot.totalCost ? "（回収済み）" : ""}</div>
      </div>

      <div className="card tablewrap" style={{ padding: "4px 8px", marginTop: 12 }}>
        <table>
          <thead><tr><th>管理番号</th><th>商品名</th><th className="n">予想売価</th><th className="n">原価（割り振り）</th><th>状態</th><th>出品先</th><th className="n">売値</th><th className="n">粗利</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className={`${isFixed(x.status) ? "sold-row" : ""} ${isHead(x.code) ? "lotleft" : ""}`}>
                <td>{x.code}</td>
                <td>{x.name}{isHead(x.code) ? <> <span className="tag t-yama">山の残り</span></> : x.costMode === "zero" ? <> <span className="tag t-yama">残りから0円</span></> : null}</td>
                <td className="n">{isHead(x.code) ? "—" : x.exp != null ? yen(x.exp) : "—"}</td>
                <td className="n">{yen(x.cost)}{filled.length > 0 && map[x.code] != null && map[x.code] !== x.cost && <><br /><span className="auto-txt">→ {yen(map[x.code])}</span></>}</td>
                <td><span className={`tag ${ST[x.status][1]}`}>{ST[x.status][0]}</span></td>
                <td><Chips x={x} /></td>
                <td className="n">{x.price != null ? yen(x.price) : "—"}</td>
                <td className={`n ${(x.profit ?? 0) >= 0 ? "up" : "down"}`}>{x.profit != null ? yen(x.profit) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {head
          ? <>{head.code}（山の残り）は、枝番にしなかった物です。{branches.length && !head.cost ? "原価は0円で、売れた金額はまるごと利益になります。" : head.cost ? `仕入額のうち ${yen(head.cost)} がここに入っています。` : ""}</>
          : `${lot.code}-0（山の残り）はありません。`}
      </p>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>枝番を追加（単品で売れそうなもの）</h2>
        <p className="muted" style={{ margin: "-6px 0 10px" }}>
          商品名と予想売価を入れます。管理番号と原価は自動で入ります。原価の付け方は1行ずつ選べます。<br />
          <b>割り振る</b>：仕入額{sold.length ? "（売れた枝番の原価を引いた残り）" : ""}を、まだ売れていない枝番と一緒に予想売価の比率で分けます。<b>最初の仕分けで、ちゃんと売れそうな物</b>に使います。<br />
          <b>0円で出す</b>：山の残りから原価0円で出します。ほかの枝番の原価は変わりません。<b>あとで気が向いて出す安い物</b>に使います。
        </p>
        <div className="tablewrap">
          <table className="brtable">
            <thead><tr><th style={{ width: 90 }}>管理番号</th><th>商品名</th><th className="n" style={{ width: 120 }}>予想売価</th><th style={{ width: 130 }}>原価の付け方</th><th className="n" style={{ width: 110 }}>原価（自動）</th></tr></thead>
            <tbody>
              {news.map((b, i) => {
                const f = filled.find((x) => x.i === i);
                return (
                  <tr key={i}>
                    <td className="muted">{f ? f.code : "—"}</td>
                    <td><input value={b.name} placeholder="商品名" onChange={(e) => setRow(i, { name: e.target.value })} /></td>
                    <td><input value={b.exp} placeholder="0" className="n" inputMode="numeric" onChange={(e) => setRow(i, { exp: e.target.value })} /></td>
                    <td>
                      <select value={b.mode} onChange={(e) => setRow(i, { mode: e.target.value as NewRow["mode"] })}>
                        <option value="alloc">割り振る</option>
                        <option value="zero">0円で出す</option>
                      </select>
                    </td>
                    <td className="n auto-txt">{f ? yen(f.mode === "alloc" ? map[f.code] ?? 0 : 0) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          {filled.length ? msgs.map((m, i) => <span key={i}>{i > 0 && <br />}{m}</span>) : "商品名と予想売価を入れると、原価が自動で入ります"}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setNews((ns) => [...ns, ...blankRows(2)])}>＋ 行を追加</button>
          <button className="btn primary" disabled={!filled.length || pending} onClick={register}>枝番を登録する</button>
        </div>
      </div>
    </section>
  );
}
