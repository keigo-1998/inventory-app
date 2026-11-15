// 三菱UFJ銀行が毎日発表する為替レート（三菱UFJリサーチ＆コンサルティングの「外国為替相場」のページ）を読む
// TTM（仲値）は、TTS（売るとき）と TTB（買うとき）のちょうど真ん中
// - 毎日の相場:    https://www.murc-kawasesouba.jp/fx/past/index.php?id=261102 （26年11月02日）
// - 月中平均の相場: https://www.murc-kawasesouba.jp/fx/monthend/index.php?id=2610 （26年10月）
// ページの形が変わって読めなくなったときは null を返す（そのときは手で入れられるようにしてある）

const BASE = "https://www.murc-kawasesouba.jp/fx/";
export const CURRENCIES = ["EUR", "USD"] as const;
export type Rates = Partial<Record<(typeof CURRENCIES)[number], number>>;

async function get(path: string): Promise<string | null> {
  try {
    const res = await fetch(BASE + path, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (res.status !== 200) return null; // ない日はトップに飛ばされる（302）
    const buf = await res.arrayBuffer();
    return new TextDecoder("euc-jp").decode(buf);
  } catch {
    return null;
  }
}

/** 通貨の行の、右寄せの数字を順に取り出す */
function numbersAfter(html: string, code: string): number[] {
  const i = html.search(new RegExp(`>\\s*${code}\\s*<`));
  if (i < 0) return [];
  const row = html.slice(i, html.indexOf("</tr>", i));
  return [...row.matchAll(/>\s*([\d,]+\.\d+)\s*</g)].map((m) => Number(m[1].replace(/,/g, "")));
}
const mid = (a: number, b: number) => Math.round(((a + b) / 2) * 100) / 100;

/** ある日の TTM（土日・祝日など発表のない日は null） */
export async function fetchDaily(ymd: string): Promise<Rates | null> {
  const id = ymd.replace(/-/g, "").slice(2); // 2026-11-02 → 261102
  const html = await get(`past/index.php?id=${id}`);
  if (!html) return null;
  const out: Rates = {};
  for (const c of CURRENCIES) {
    const [tts, ttb] = numbersAfter(html, c);
    if (tts && ttb) out[c] = mid(tts, ttb);
  }
  return Object.keys(out).length ? out : null;
}

/** ある月の月中平均の TTM（月が終わって発表されるまでは null） */
export async function fetchMonthAvg(month: string): Promise<Rates | null> {
  const id = month.replace("-", "").slice(2); // 2026-10 → 2610
  const html = await get(`monthend/index.php?id=${id}`);
  if (!html) return null;
  const out: Rates = {};
  for (const c of CURRENCIES) {
    const n = numbersAfter(html, c); // 月末 TTS・TTB、月中平均 TTS・TTB の順
    if (n.length >= 4 && n[2] && n[3]) out[c] = mid(n[2], n[3]);
  }
  return Object.keys(out).length ? out : null;
}

/** 発表のあった日の一覧（直近3か月）。"2026-11-02" の形 */
export async function fetchDays(): Promise<string[]> {
  const html = await get("past_3month.php");
  if (!html) return [];
  return [...new Set([...html.matchAll(/past\/index\.php\?id=(\d{2})(\d{2})(\d{2})/g)].map((m) => `20${m[1]}-${m[2]}-${m[3]}`))].sort();
}
