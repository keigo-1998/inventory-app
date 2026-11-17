// 画面の下に出るお知らせ（10秒で消える。「元に戻す」付きにもできる）
// 画面イメージの toast() と同じ見た目・動き
let timer: ReturnType<typeof setTimeout> | undefined;

/** undo が文字を返したときは、その文字をお知らせに出す（取り消せなかったときの説明など） */
export function toast(msg: string, undo?: () => void | string | Promise<void | string>, undoMsg = "取り消しました") {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.innerHTML = `<span>${msg}</span>${undo ? '<button class="btn" id="toastUndo">元に戻す</button>' : ""}<button class="x" id="toastX">×</button><i class="bar"></i>`;
  t.className = "";
  void t.offsetWidth; // 時間の線をはじめから動かし直す
  t.className = "show";
  clearTimeout(timer);
  timer = setTimeout(() => t!.classList.remove("show"), 10000);
  t.querySelector<HTMLButtonElement>("#toastX")!.onclick = () => t!.classList.remove("show");
  if (undo) {
    t.querySelector<HTMLButtonElement>("#toastUndo")!.onclick = async () => {
      t!.classList.remove("show");
      const r = await undo();
      toast(typeof r === "string" ? r : undoMsg);
    };
  }
}

/** HTML に入れても安全な文字にする */
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
