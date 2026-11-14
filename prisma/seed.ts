// 見本のデータを入れる（実際の商品ではありません）
// 使い方: npm run setup （データベースを作って、この見本を入れる）
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const d = (s: string) => new Date(`${s}T00:00:00+09:00`);

// ジャンル（docs/data-design.md「ジャンル」の、よく使う順）
const GENRES = ["雑貨", "カメラ", "PC、OA機器", "時計", "茶道具", "絵画、美術品", "家電", "家具", "アパレル", "ブランド品", "ホビー", "ゲーム", "着物関係", "楽器"];

// 販路と計算のルール（docs/profit-formulas.md）
const CHANNELS: Prisma.ChannelCreateInput[] = [
  { name: "Catawiki", currency: "EUR", feeMode: "manual", feeHintRate: 0.155, usesShippingFee: true, shippingPaidBy: "bank" },
  { name: "メルカリ", currency: "JPY", feeMode: "auto", feeRate: 0.1, usesShippingFee: false, shippingPaidBy: "payout" },
  { name: "ヤフオク", currency: "JPY", feeMode: "manual", feeHintRate: 0.091, usesShippingFee: true, shippingPaidBy: "payout", refundVia: "bank" },
  { name: "JOOM", currency: "USD", feeMode: "auto", feeRate: 0.15, usesShippingFee: true },
  { name: "Chrono24", currency: "JPY", feeMode: "auto", feeRate: 0.125, usesShippingFee: true },
  { name: "浜屋", currency: "JPY", feeMode: "manual", feeHintRate: 0.1, usesShippingFee: true },
  { name: "古物市場", currency: "JPY", feeMode: "manual", feeHintRate: 0.1, usesShippingFee: true },
  { name: "ジモティー", currency: "JPY", feeMode: "none", usesShippingFee: true },
  { name: "eBay", currency: "USD", feeMode: "manual", usesShippingFee: true, undecided: true },
];

const SUPPLIERS = ["トレファクオークション", "メルカリ", "栗田"];

async function main() {
  // いったん全部消してから入れ直す（見本用。本物のデータでは使わない）
  for (const t of ["ChangeLog", "SaleAdjustment", "SaleLine", "Sale", "Listing", "Item", "Lot", "ExchangeRate", "Channel", "Supplier", "Genre"]) {
    await db.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }

  const genre: Record<string, number> = {};
  for (const [i, name] of GENRES.entries()) genre[name] = (await db.genre.create({ data: { name, sortOrder: i } })).id;
  const ch: Record<string, number> = {};
  for (const [i, c] of CHANNELS.entries()) ch[c.name] = (await db.channel.create({ data: { ...c, sortOrder: i } })).id;
  const sup: Record<string, number> = {};
  for (const name of SUPPLIERS) sup[name] = (await db.supplier.create({ data: { name } })).id;

  await db.exchangeRate.createMany({
    data: [
      { currency: "EUR", date: d("2026-11-04"), ttm: 177.36 },
      { currency: "USD", date: d("2026-11-04"), ttm: 152.4 },
    ],
  });

  // 単品: [管理番号, 商品名, ジャンル, 仕入日, 原価, 予想売価, 出品先]
  const singles: [string, string, string, string, number, number, string[]][] = [
    ["0350", "ニコン 純正ストラップ", "カメラ", "2026-10-02", 800, 4000, []],
    ["0352", "Apple MacBookAir A2941", "PC、OA機器", "2026-11-04", 81675, 110000, []],
    ["0354", "BAKUNE Dry TENTIAL ロングスリーブTシャツ/ロングパンツセット", "アパレル", "2026-11-04", 14520, 22000, ["メルカリ"]],
    ["0404", "オリエント バンビーノ", "時計", "2026-11-07", 5000, 25000, ["メルカリ"]],
    ["0409", "ミノルタ α-7", "カメラ", "2026-06-07", 8000, 16000, ["Catawiki", "メルカリ"]],
    ["0401", "SEIKO 5 自動巻き", "時計", "2026-09-21", 2000, 6000, []],
    ["0413", "萩焼 湯呑", "茶道具", "2026-06-03", 4000, 16000, []],
  ];
  for (const [code, name, g, date, cost, exp, chans] of singles) {
    await db.item.create({
      data: {
        code, name, genreId: genre[g], supplierId: sup["トレファクオークション"], purchasedAt: d(date),
        unitCost: cost, expectedPrice: exp, status: chans.length ? "list" : "stock",
        listings: { create: chans.map((c) => ({ channelId: ch[c], startedAt: d(date) })) },
      },
    });
  }

  // 縦積在庫（同じ商品が8個）
  await db.item.create({
    data: {
      code: "L00004", name: "北欧 チェア", genreId: genre["家具"], supplierId: sup["メルカリ"], purchasedAt: d("2026-07-13"),
      unitCost: 2500, quantity: 8, expectedPrice: 9000, status: "list",
      listings: { create: [{ channelId: ch["メルカリ"], startedAt: d("2026-07-13") }] },
    },
  });

  // 山（枝番あり）: 仕入額 24,000円を、枝番に予想売価の比率で全部割り振る。-0（山の残り）は0円
  const lot460 = await db.lot.create({
    data: { code: "0460", name: "茶道具まとめ 20点", totalCost: 24000, purchasedAt: d("2026-10-10"), supplierId: sup["トレファクオークション"], genreId: genre["茶道具"] },
  });
  const lotItems: [string, string, number, number, string | null][] = [
    ["0460-0", "茶道具まとめ 20点（残り）", 0, 0, null],
    ["0460-1", "楽焼 茶碗", 16000, 20000, "alloc"],
    ["0460-2", "棗 漆塗り", 8000, 10000, "alloc"],
  ];
  for (const [code, name, cost, exp, mode] of lotItems) {
    await db.item.create({
      data: { code, name, genreId: genre["茶道具"], supplierId: sup["トレファクオークション"], purchasedAt: d("2026-10-10"), unitCost: cost, expectedPrice: exp || null, lotId: lot460.id, lotCostMode: mode },
    });
  }

  // 山（まだ枝番なし）: 仕入額はまるごと -0 に入っている
  const lot353 = await db.lot.create({
    data: { code: "0353", name: "カメラまとめ 15点", totalCost: 52333, purchasedAt: d("2026-11-04"), supplierId: sup["トレファクオークション"], genreId: genre["カメラ"] },
  });
  await db.item.create({
    data: { code: "0353-0", name: "カメラまとめ 15点", genreId: genre["カメラ"], supplierId: sup["トレファクオークション"], purchasedAt: d("2026-11-04"), unitCost: 52333, lotId: lot353.id },
  });

  // 売れた見本 1: ヤフオク（円）
  const hagi = await db.item.update({ where: { code: "0413" }, data: { status: "sold" } });
  await db.sale.create({
    data: {
      soldAt: d("2026-11-08"), channelId: ch["ヤフオク"], priceJpy: 15000, shippingFeeJpy: 1000, feeJpy: 1365, actualShippingJpy: 800, shipped: true,
      lines: { create: [{ itemId: hagi.id, costJpy: 4000, amountJpy: 15000 }] },
    },
  });
  await db.listing.create({ data: { itemId: hagi.id, channelId: ch["ヤフオク"], state: "sold", startedAt: d("2026-06-03"), endedAt: d("2026-11-08") } });

  // 売れた見本 2: Catawiki（ユーロ）。€60 × 177.36円。為替は月初のTTMで仮
  const seiko = await db.item.update({ where: { code: "0401" }, data: { status: "sold" } });
  const rate = 177.36, yen = (cents: number) => Math.round((cents / 100) * rate);
  await db.sale.create({
    data: {
      soldAt: d("2026-11-10"), channelId: ch["Catawiki"], currency: "EUR",
      priceForeign: 6000, shippingForeign: 2000, feeForeign: 930,
      priceJpy: yen(6000), shippingFeeJpy: yen(2000), feeJpy: yen(930), actualShippingJpy: 2900, shippingTentative: true,
      fxRate: rate, fxRateFinal: false,
      lines: { create: [{ itemId: seiko.id, costJpy: 2000, amountJpy: yen(6000) }] },
    },
  });
  await db.listing.create({ data: { itemId: seiko.id, channelId: ch["Catawiki"], state: "sold", startedAt: d("2026-09-21"), endedAt: d("2026-11-10") } });

  const n = await db.item.count();
  console.log(`見本データを入れました（商品 ${n} 件・販路 ${CHANNELS.length} 件・ジャンル ${GENRES.length} 件）`);
}

main().finally(() => db.$disconnect());
