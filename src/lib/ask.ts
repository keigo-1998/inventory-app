// 「〜しますか？」の確認の画面（ブラウザの confirm() は、環境によっては出ずに「キャンセル」扱いになるため、自前で出す）
// 使い方: if (!(await ask("消しますか？", "消す"))) return;
export function ask(message: string, okLabel = "OK"): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "askdlg";
    const p = document.createElement("p");
    p.style.cssText = "margin:0 0 16px;white-space:pre-line;line-height:1.6";
    p.textContent = message;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const no = Object.assign(document.createElement("button"), { className: "btn", textContent: "やめる" });
    const ok = Object.assign(document.createElement("button"), { className: "btn primary", textContent: okLabel });
    row.append(no, ok);
    d.append(p, row);
    let answered = false;
    const done = (v: boolean) => { if (answered) return; answered = true; d.close(); d.remove(); resolve(v); };
    no.onclick = () => done(false);
    ok.onclick = () => done(true);
    d.addEventListener("cancel", () => done(false)); // Escキー
    d.addEventListener("click", (e) => { if (e.target === d) done(false); }); // 外側を押す
    // 開いている画面（商品の画面など）の上に重ねる
    (document.querySelector("dialog[open]") ?? document.body).appendChild(d);
    d.showModal();
    ok.focus();
  });
}
