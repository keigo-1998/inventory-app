// 販売の粗利の計算（docs/profit-formulas.md）。画面とサーバーで同じ計算を使う
// 粗利 = 売値（円） ＋ 設定送料（円） − 実送料 − 手数料（円） − 原価

export type ChannelRule = {
  name: string; currency: string; feeMode: string; feeRate: number | null; feeHintRate: number | null; usesShippingFee: boolean; undecided: boolean;
};
export type SaleInput = {
  price: number | null; // 売値（販路の通貨。2個以上なら合計）
  ship: number | null; // 設定送料（販路の通貨）
  fee: number | null; // 手数料（販路の通貨）。自動の販路で手で直していなければ無視
  feeTouched: boolean;
  real: number | null; // 実送料（円）
  cost: number; // 原価の合計（円）
};

export const CUR_SIGN: Record<string, string> = { JPY: "円", EUR: "€", USD: "$" };

/** 文字を数字にする（¥ , 円 空白 は無視。空なら null、数字でなければ NaN） */
export const toNum = (s: unknown): number | null => {
  const v = String(s ?? "").normalize("NFKC").replace(/[¥€$,円\s]/g, "");
  return v === "" ? null : Number.isNaN(+v) ? NaN : +v;
};

export function calcSale(c: ChannelRule, rate: number, x: SaleInput) {
  const price = x.price || 0;
  const priceY = price * rate;
  const shipIn = c.usesShippingFee ? x.ship || 0 : 0;
  const shipY = shipIn * rate;
  let feeIn = x.fee;
  let feeAuto = false;
  if (c.feeMode === "auto" && !x.feeTouched) { feeIn = price * (c.feeRate ?? 0); feeAuto = true; }
  if (c.feeMode === "none") { feeIn = 0; feeAuto = true; }
  const feeY = (feeIn || 0) * rate;
  const realY = x.real || 0;
  const profit = priceY + shipY - realY - feeY - x.cost;
  // 毎回入力の販路で、いつもの手数料率から大きく外れたら知らせる（打ち間違い防止）
  let warn = "";
  if (c.feeMode === "manual" && c.feeHintRate && price > 0 && feeIn != null) {
    const pct = feeIn / price;
    if (Math.abs(pct - c.feeHintRate) > c.feeHintRate * 0.4)
      warn = `いつもの手数料率（約${(c.feeHintRate * 100).toFixed(1)}%）と違います（今回 ${(pct * 100).toFixed(1)}%）。打ち間違いがないか確認してください`;
  }
  return { rate, price, shipIn, feeIn: feeIn ?? 0, priceY, shipY, feeY, realY, profit, feeAuto, warn };
}
