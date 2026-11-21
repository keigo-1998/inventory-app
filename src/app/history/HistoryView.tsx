"use client";
// 変更履歴の画面（docs/data-design.md「変更履歴の画面」）
// 新しい順。日付ごとに分け、同じ操作でまとめて変わったものは1行（押すと中身が開く）
import { useDeferredValue, useMemo, useState } from "react";
import { PageHead } from "@/components/PageHead";

export type HistChange = { field: string; before: string; after: string };
export type HistRow = { code: string; name: string; action: string; table: string; changes: HistChange[] };
export type HistGroup = { key: number; at: string; note: string; rows: HistRow[] };

const PAGE = 100;
const KINDS = [["all", "すべて"], ["Item", "商品"], ["Sale", "販売"], ["Listing", "出品先"], ["other", "そのほか"]] as const;
const MAIN = new Set(["Item", "Sale", "Listing"]);

function Change({ c }: { c: HistChange }) {
  return (
    <span className="hist-ch">
      {c.field} {c.before && <s>{c.before}</s>}{c.before && c.after && " → "}{c.after && <b>{c.after}</b>}
    </span>
  );
}

export function HistoryView({ groups, total, limited, q: q0 }: { groups: HistGroup[]; total: number; limited: boolean; q: string }) {
  const [qInput, setQ] = useState(q0);
  const q = useDeferredValue(qInput).normalize("NFKC").trim().toLowerCase();
  const [kind, setKind] = useState<string>("all");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => groups.filter((g) => {
    const kindOk = kind === "all" || g.rows.some((r) => (kind === "other" ? !MAIN.has(r.table) : r.table === kind));
    if (!kindOk) return false;
    if (!q) return true;
    return g.note.toLowerCase().includes(q) || g.rows.some((r) => `${r.code} ${r.name}`.normalize("NFKC").toLowerCase().includes(q));
  }), [groups, q, kind]);

  const toggle = (k: number) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  let lastDay = "";

  return (
    <section>
      <PageHead title="変更履歴" sub={`全${total.toLocaleString()}件${limited ? "（新しい分だけ）" : ""}`} help={[
        "アプリでデータを変えると、いつ・何を・どう変えたかがここに残ります（新しい順）。",
        "同じ操作でまとめて変わったもの（為替の確定・まとめて入力など）は1行にまとめています。押すと中身が開きます。",
        <>変わった項目は <s>前の値</s> → <b>後の値</b> で出します。</>,
        "管理番号・商品名・操作の名前（例：「販売を直す」「廃棄」）で探せます。商品の画面の「履歴」からも、その商品の履歴だけを開けます。",
        "履歴は消せません（間違えて変えたときに、元の値を確かめるためのものです）。",
      ]} />
      <div className="toolbar">
        <div className="searchbox"><input type="search" placeholder="管理番号・商品名・操作で探す" value={qInput} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} /></div>
        <div className="filters" style={{ margin: 0 }}>
          {KINDS.map(([k, l]) => <button key={k} className={`pill${kind === k ? " on" : ""}`} onClick={() => { setKind(k); setShown(PAGE); }}>{l}</button>)}
        </div>
      </div>
      {list.length === 0 && <p className="muted">当てはまる履歴はありません。</p>}
      <div className="hist">
        {list.slice(0, shown).map((g) => {
          const [day, time] = g.at.split(" ");
          const head = day !== lastDay ? <div className="hist-day">{day}</div> : null;
          lastDay = day;
          const one = g.rows.length === 1 ? g.rows[0] : null;
          const codes = [...new Set(g.rows.map((r) => r.code).filter(Boolean))];
          const canOpen = g.rows.length > 1 || (one && one.changes.length > 3);
          const isOpen = open.has(g.key);
          return (
            <div key={g.key}>
              {head}
              <div className={`hist-row${canOpen ? " can" : ""}`} onClick={canOpen ? () => toggle(g.key) : undefined}>
                <span className="hist-time">{time}</span>
                <div className="hist-main">
                  <div>
                    <b>{g.note}</b>
                    {one ? <span className="muted">　{one.code} {one.name}</span>
                      : <span className="muted">　{g.rows.length}件{codes.length ? `（${codes.slice(0, 4).join("・")}${codes.length > 4 ? ` ほか${codes.length - 4}` : ""}）` : ""}</span>}
                    {canOpen && <span className="hist-more">{isOpen ? "▲ 閉じる" : "▼ 中身"}</span>}
                  </div>
                  {one && !isOpen && one.changes.length > 0 && <div className="hist-chs">{one.changes.slice(0, 3).map((c, i) => <Change key={i} c={c} />)}</div>}
                  {isOpen && (
                    <div className="hist-detail">
                      {g.rows.map((r, i) => (
                        <div key={i} className="hist-line">
                          <span className="hist-code">{r.code || "—"}</span>
                          <span className="hist-name">{r.name}</span>
                          <span className="hist-chs">{r.changes.length ? r.changes.map((c, j) => <Change key={j} c={c} />) : <span className="muted">{r.action}</span>}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {list.length > shown && <div style={{ textAlign: "center", margin: 12 }}><button className="btn" onClick={() => setShown(shown + PAGE)}>もっと見る（残り{list.length - shown}件）</button></div>}
    </section>
  );
}
