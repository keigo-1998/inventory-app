// アプリが起動したときに1回だけ動く（Next.js の決まり）
// 本物のデータで動かしているときは、1日1回、控え（バックアップ）を取る（中身は auto-backup.ts）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./auto-backup");
  }
}
