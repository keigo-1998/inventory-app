export const MOVEMENT_LABELS: Record<string, string> = {
  IN: "入庫",
  OUT: "出庫",
  ADJUST: "棚卸調整",
  LOAN: "貸出",
  RETURN: "返却",
};

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

export function fmtSigned(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

/** 今日の日付（JST）の YYYY-MM-DD */
export function todayJst() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/** 期限日（その日の終わり JST）を過ぎているか */
export function isOverdue(due: Date | null, returnedAt: Date | null) {
  if (!due || returnedAt) return false;
  return due.getTime() + 24 * 60 * 60 * 1000 <= Date.now();
}
