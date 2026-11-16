// データの控え（バックアップ）を取る部品
// - backups/ フォルダに「データベース名-日付-時刻.db」の名前で写す（GitHub には送らない）
// - アプリが動いている最中でも安全に写せる SQLite の「VACUUM INTO」を使う
// - 古い控えは、新しいほうから KEEP 個だけ残して消す
// 使うところ: npm run backup／アプリを起動したとき・1日1回／取り込み直しの前／データの形を変える前
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

export const BACKUP_DIR = path.join(process.cwd(), "backups");
const KEEP = 60;

/** いま使っているデータベースの名前（"real" や "dev"） */
export function dbName() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return path.basename(url.replace(/^file:/, "")).replace(/\.db$/, "");
}

const stamp = () => {
  const j = new Date(Date.now() + 9 * 3600 * 1000).toISOString(); // 日本時間
  return `${j.slice(0, 10).replace(/-/g, "")}-${j.slice(11, 19).replace(/:/g, "")}`;
};

/** 控えを取る。作ったファイルの場所を返す。why は名前の最後に付ける目印（例: "import"） */
export async function backupNow(db: PrismaClient, why = ""): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = dbName();
  let file = path.join(BACKUP_DIR, `${name}-${stamp()}${why ? `-${why}` : ""}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = file.replace(/(-\d+)?\.db$/, `-${i}.db`);
  await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune(name);
  return file;
}

/** いちばん新しい控えを取った時刻（なければ 0） */
export function lastBackupAt(name = dbName()): number {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  return Math.max(0, ...list(name).map((f) => fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs));
}

const list = (name: string) => fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(`${name}-`) && f.endsWith(".db")).sort();

function prune(name: string) {
  const files = list(name);
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(BACKUP_DIR, f));
}
