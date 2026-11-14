# 物販管理（JOYNT）

物販の商品（在庫）・山・販売・販路・粗利を管理する Web アプリです。
いまは「2. 本物のアプリを作る」の途中で、このMacの中だけで動かしています。

- 進め方: [docs/roadmap.md](docs/roadmap.md)
- データの決まり: [docs/data-design.md](docs/data-design.md)
- 粗利の計算式: [docs/profit-formulas.md](docs/profit-formulas.md)
- 画面イメージ（見本）: `python3 docs/mockup/serve.py` → http://127.0.0.1:8765/

## 使っている道具

- **Next.js**: 画面とサーバー（裏で計算する部分）
- **Prisma**: データベースの入れ物を作る・読み書きする道具（設計図は `prisma/schema.prisma`）
- **SQLite**: このMacで作る間のデータベース（`prisma/dev.db`）。公開するときに PostgreSQL に切り替える

## 動かし方

Node.js 20 以上が必要です。

```bash
npm install
cp .env.example .env
npm run setup      # データベースを作って、見本データを入れる
npm run dev        # http://localhost:3000
```

`npm run setup` は見本データを入れ直します（データベースの中身は消えます）。本物のデータを入れたあとは使わないでください。

## フォルダの中身

```
prisma/schema.prisma   データの入れ物の設計図（商品・山・出品先・販売・販路・為替・変更の履歴）
prisma/seed.ts         見本データ（実際の商品ではありません）
src/lib/db.ts          データベースにつなぐ部品
src/lib/history.ts     変更の履歴を残す部品（削除は印を付けるだけ）
src/lib/format.ts      日付・金額・状態の表示
src/app/               画面
docs/                  設計メモと画面イメージ
```
