// さっき変えた商品を覚えておく（商品一覧で、しばらく色を付けるため）
// ブラウザのタブの中だけに覚える（sessionStorage）。10分たつと消える
const KEY = "recentChanged";
export const RECENT_MIN = 10;

type Store = Record<string, number>; // 管理番号 → 変えた時刻

function load(): Store {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "{}") as Store;
    const limit = Date.now() - RECENT_MIN * 60 * 1000;
    return Object.fromEntries(Object.entries(s).filter(([, t]) => t > limit));
  } catch {
    return {};
  }
}
function save(s: Store) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 覚えられなくても動くようにする */ }
  window.dispatchEvent(new Event("recent-changed"));
}

/** 変えた商品として覚える */
export function markChanged(codes: string[]) {
  const s = load();
  const now = Date.now();
  for (const c of codes) s[c] = now;
  save(s);
}
/** 覚えている商品（10分以内に変えたもの） */
export const recentChanged = (): Store => load();
/** 印を全部消す */
export function clearChanged() { save({}); }
