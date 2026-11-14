export function fmtDate(d: Date | null | undefined, withTime = false) {
  if (!d) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

/** 円の表示（¥12,345） */
export const yen = (n: number) => (n < 0 ? "−" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString("ja-JP");

/** 今日の日付（JST）の YYYY-MM-DD */
export function todayJst() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/** 状態の表示名（docs/data-design.md「商品一覧の絞り込みと状態」） */
export const STATUS_LABEL: Record<string, string> = {
  stock: "未出品",
  list: "出品中",
  sold: "売却済み",
  disposed: "廃棄",
  fixture: "備品",
};
