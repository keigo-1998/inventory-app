// 山の原価の割り振り（docs/data-design.md「山の原価の割り振り」）

/**
 * 仕入額を、予想売価の比率で全部割り振る。1円未満は切り捨て、端数は予想売価がいちばん高い商品で調整する。
 * 例: 10,000円を 30,000 / 20,000 / 20,000 / 15,000 / 15,000 → 3,000 / 2,000 / 2,000 / 1,500 / 1,500
 */
export function allocateCost(cost: number, exps: number[]): number[] {
  const total = exps.reduce((a, b) => a + b, 0);
  if (!cost || !total) return exps.map(() => 0);
  const al = exps.map((e) => Math.floor((cost * e) / total));
  al[exps.indexOf(Math.max(...exps))] += cost - al.reduce((a, b) => a + b, 0);
  return al;
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
