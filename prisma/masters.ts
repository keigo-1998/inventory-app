// 選択肢の一覧（見本のデータと、スプレッドシートからの取り込みで同じものを使う）
import type { Prisma } from "@prisma/client";

// ジャンル（docs/data-design.md「ジャンル」の、よく使う順）
export const GENRES = ["雑貨", "カメラ", "PC、OA機器", "時計", "茶道具", "絵画、美術品", "家電", "家具", "アパレル", "ブランド品", "ホビー", "ゲーム", "着物関係", "楽器"];

// 販路と計算のルール（docs/profit-formulas.md）
export const CHANNELS: Prisma.ChannelCreateInput[] = [
  { name: "Catawiki", currency: "EUR", feeMode: "manual", feeHintRate: 0.155, usesShippingFee: true, shippingPaidBy: "bank" },
  { name: "メルカリ", currency: "JPY", feeMode: "auto", feeRate: 0.1, usesShippingFee: false, shippingPaidBy: "payout", returnShippingBack: true },
  { name: "ヤフオク", currency: "JPY", feeMode: "manual", feeHintRate: 0.091, usesShippingFee: true, shippingPaidBy: "payout", refundVia: "bank" },
  { name: "JOOM", currency: "USD", feeMode: "auto", feeRate: 0.15, usesShippingFee: true },
  { name: "Chrono24", currency: "JPY", feeMode: "auto", feeRate: 0.125, usesShippingFee: true },
  { name: "浜屋", currency: "JPY", feeMode: "manual", feeHintRate: 0.1, usesShippingFee: true },
  { name: "古物市場", currency: "JPY", feeMode: "manual", feeHintRate: 0.1, usesShippingFee: true },
  { name: "ジモティー", currency: "JPY", feeMode: "none", usesShippingFee: true },
  { name: "eBay", currency: "USD", feeMode: "manual", usesShippingFee: true, undecided: true },
];

export const SUPPLIERS = ["トレファクオークション", "メルカリ", "栗田"];

