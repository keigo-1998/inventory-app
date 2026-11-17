// 控え（バックアップ）を取るコマンド: npm run backup（本物のデータ）／ npm run backup:dev（見本のデータ）
// 名前の最後に付ける目印を渡せる: tsx scripts/backup.ts migrate
import { PrismaClient } from "@prisma/client";
import { backupNow } from "../src/lib/backup";

const db = new PrismaClient();
backupNow(db, process.argv[2] ?? "")
  .then((f) => console.log(`控えを取りました: ${f}`))
  .catch((e) => { console.error("控えを取れませんでした:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
