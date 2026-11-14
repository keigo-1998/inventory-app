// 山の原価の割り振り（docs/data-design.md「山の原価の割り振り」）

/** 丸める単位：1万円以上は1,000円、それより安い物は100円（2026/11/15 決定） */
export const roundUnit = (yen: number) => (yen >= 10000 ? 1000 : 100);

/**
 * pool（割り振る金額）を、予想売価の比率で分けて、きりのいい数字に丸める。
 * - 1万円以上は1,000円単位、それより安い物は100円単位で四捨五入
 * - 合計は pool と同じにするため、丸めて余った端数は予想売価がいちばん高い商品に入れる
 * - 予想売価がどれも0のときは同じ額ずつ
 * 例: 52,333円を 30,000 / 20,000 / 10,000 → 26,633 / 17,000 / 8,700
 */
export function shareCost(pool: number, exps: number[]): number[] {
  if (!exps.length) return [];
  if (pool <= 0) return exps.map(() => 0);
  const tot = exps.reduce((a, b) => a + b, 0);
  const raw = exps.map((e) => (tot ? (pool * e) / tot : pool / exps.length));
  const top = exps.indexOf(Math.max(...exps));
  const out = raw.map((v, i) => (i === top ? 0 : Math.round(v / roundUnit(v)) * roundUnit(v)));
  out[top] = pool - out.reduce((a, b) => a + b, 0);
  if (out[top] >= 0) return out;
  // 金額がとても小さくて丸めると足りなくなるときは、1円単位で分ける
  const fl = raw.map((v) => Math.floor(v));
  fl[top] += pool - fl.reduce((a, b) => a + b, 0);
  return fl;
}

/**
 * 商品の登録のとき：仕入額を、中身の予想売価の比率で全部割り振る（丸め方は shareCost）。
 * 予想売価がどれも0なら割り振らない（全部0）。
 */
export function allocateCost(cost: number, exps: number[]): number[] {
  const total = exps.reduce((a, b) => a + b, 0);
  if (!cost || !total) return exps.map(() => 0);
  return shareCost(cost, exps);
}

/** 管理番号の数字の部分を4けたにそろえる（352 → "0352"） */
export const padNo = (n: number) => String(n).padStart(4, "0");

/** 今ある管理番号の続きの番号（数字で始まる番号のいちばん大きいもの ＋ 1） */
export function nextNumber(codes: string[]): number {
  let max = 0;
  for (const c of codes) {
    const m = /^(\d+)/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export type AllocTarget = { key: string; exp: number };

/**
 * 山の画面で枝番を足すときの割り振り（割り振り直し）。
 * pool（仕入額 − 売れた枝番の原価）を、targets（まだ売れていない「割り振る」の枝番＋新しく足す枝番）に予想売価の比率で分ける（丸め方は shareCost）。
 */
export function reallocate(pool: number, targets: AllocTarget[]): Record<string, number> {
  const shares = shareCost(pool, targets.map((t) => t.exp));
  return Object.fromEntries(targets.map((t, i) => [t.key, shares[i]]));
}

/** 売れた（在庫でなくなった）商品か */
export const isFixed = (status: string) => status !== "stock" && status !== "list";
