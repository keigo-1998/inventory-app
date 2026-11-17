// 本物のデータで動かしているとき、1日1回、控え（バックアップ）を取る（instrumentation.ts から呼ばれる）
import { backupNow, lastBackupAt, dbName } from "@/lib/backup";
import { db } from "@/lib/db";

const DAY = 24 * 3600 * 1000;
const tick = async () => {
  try {
    if (Date.now() - lastBackupAt() < DAY - 60 * 1000) return;
    console.log(`[控え] ${await backupNow(db, "auto")}`);
  } catch (e) {
    console.error("[控え] 取れませんでした", e);
  }
};

const g = globalThis as unknown as { backupTimer?: NodeJS.Timeout };
if (dbName() === "real" && !g.backupTimer) {
  g.backupTimer = setInterval(tick, 60 * 60 * 1000); // 1時間ごとに見て、1日たっていたら取る
  void tick();
}
