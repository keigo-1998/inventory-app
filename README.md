# 在庫・備品管理システム

Next.js (App Router) + Prisma + SQLite で作った在庫・備品管理 Web アプリです。

## 機能

- **ダッシュボード**: 登録品目数、要発注品目、貸出中、返却期限超過、最近の入出庫を表示
- **品目管理**: 登録・編集・削除、品名/品番/保管場所での検索、カテゴリ・在庫状態での絞り込み、CSV出力（Excel対応）
- **入出庫**: 入庫・出庫・棚卸調整（実数に合わせる）。在庫がマイナスになる出庫はエラーで防止
- **貸出管理**: 借用者・数量・返却期限を登録、返却処理、期限超過の強調表示
- **履歴**: 全ての在庫変動（入庫/出庫/調整/貸出/返却）を処理後在庫数とともに記録
- **カテゴリ管理**

## セットアップ

Node.js 20 以上が必要です。

```bash
npm install
cp .env.example .env
npm run setup      # DB作成 + サンプルデータ投入
npm run dev        # http://localhost:3000
```

本番起動:

```bash
npm run build && npm start
```

## 構成

```
prisma/schema.prisma      DBスキーマ（Category / Item / StockMovement / Loan）
prisma/seed.ts            サンプルデータ
src/lib/actions.ts        サーバーアクション（在庫更新はトランザクション内で実行）
src/app/                  各画面（/, /items, /items/[id], /loans, /movements, /categories）
src/app/api/items/export  CSV出力
```

## 今後の拡張候補

- ログイン・権限管理（現状は認証なし。社内ネットワーク内での利用を想定）
- PostgreSQL への切り替え（`schema.prisma` の `provider` と `DATABASE_URL` を変更）
- バーコード/QRコード読み取り、発注点到達時のメール通知
