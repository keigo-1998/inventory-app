// 商品名からジャンルを推測する（docs/data-design.md「ジャンル」）
// スプレッドシートの過去の商品（約600件）でよく出た言葉と、一般的なブランド名・品名から作った手がかり。
// 本物のアプリでは、登録するたびに手がかりを増やしていく予定。
export const GENRE_HINTS: Record<string, string[]> = {
  "カメラ":["カメラ","レンズ","一眼","フィルム","ビデオカメラ","ズイコー","タクマー","canon","キヤノン","キャノン","nikon","ニコン","pentax","ペンタックス","olympus","オリンパス","minolta","ミノルタ","fujifilm","富士フイルム","leica","ライカ","rolleiflex","mamiya","マミヤ","contax","コンタックス","asahi","takumar","eos","om-1","om-system","hi-matic","camera","lens"],
  "時計":["時計","腕時計","懐中時計","クォーツ","クオーツ","自動巻","seiko","セイコー","citizen","シチズン","casio","カシオ","g-shock","orient","オリエント","grand seiko","tissot","chrono"],
  "PC、OA機器":["パソコン","ノートパソコン","デスクトップ","プリンター","モニター","マザーボード","グラボ","キーボード","マウス","pc","macbook","imac","ipad","iphone","apple","mac","thinkpad","surface","dell","asus","lenovo","hp","intel","core","cpu","ssd","hdd","ddr3","ddr4","i5","i7","i9","ryzen","geforce","gtx","rtx"],
  "茶道具":["茶道具","茶碗","茶器","茶入","茶杓","棗","水指","建水","香合","急須","湯呑","抹茶","一輪挿","花入","薩摩焼","楽焼","中次","釜"],
  "絵画、美術品":["絵画","油絵","水彩","版画","リトグラフ","掛軸","掛け軸","日本画","彫刻","ブロンズ","美術","模造刀","刀","仏像","書画"],
  "家電":["家電","ラジオ","リモコン","ウォークマン","スピーカー","アンプ","オーディオ","コンポ","テレビ","扇風機","掃除機","ドライヤー","炊飯器","レンジ","ポータブル","denon","sony","ソニー","panasonic","パナソニック","bose","technics"],
  "家具":["家具","チェア","椅子","スツール","テーブル","ソファ","ベッド","デスク","キャビネット","チェスト","シェルフ","ランプ","照明","竹細工","boconcept","boconsept","stool","newport","shogun","xtra","アクタス","カリモク"],
  "アパレル":["シャツ","tシャツ","パンツ","ボトム","ジーンズ","デニム","ジャケット","コート","ニット","パーカー","スウェット","ドレス","ワンピース","スカート","スニーカー","ブーツ","リーバイス","levi's","gildan","ハーレーダビッドソン","nike","ナイキ","adidas","アディダス"],
  "ブランド品":["louis vuitton","ルイヴィトン","ヴィトン","chanel","シャネル","gucci","グッチ","hermes","エルメス","prada","プラダ","dior","ディオール","rolex","ロレックス","omega","オメガ","cartier","カルティエ","rimowa","リモワ","リモア","スワロフスキー","swarovski","バカラ","baccarat","マイセン","meissen","ウェッジウッド","wedgwood","ロイヤルコペンハーゲン","ヘレンド","ベネチアンガラス","バッグ","ショルダーバッグ","財布","スーツケース"],
  "ホビー":["フィギュア","プラモデル","ミニカー","ドール","人形","西洋人形","トレカ","トレーディングカード","ワンピースカード","ポケモンカード","ぬいぐるみ","鉄道模型","ガンプラ","おもちゃ"],
  "ゲーム":["ゲーム","ドリームキャスト","ファミコン","スーパーファミコン","プレイステーション","プレステ","playstation","ps2","ps3","ps4","ps5","nintendo","任天堂","switch","ゲームボーイ","game boy","セガ","sega","xbox","3ds"],
  "着物関係":["着物","羽織","帯","浴衣","反物","和装","振袖","留袖","帯締"],
  "楽器":["ギター","ベース","ウクレレ","バイオリン","ピアノ","シンセサイザー","ドラム","サックス","トランペット","楽器","エフェクター"],
  "雑貨":["雑貨","小物","メガネ","眼鏡","サングラス","zippo","ジッポ","ルアー","民芸品","置物","直筆","サイン","チェキ","生写真","衣装","コスチューム","一点物"],
};

/** 長い言葉ほど確かとして点数を付け、いちばん点の高いジャンルを返す。分からなければ空 */
export function guessGenre(name: string, genres: string[]): string {
  const n = String(name || "").normalize("NFKC").toLowerCase();
  if (!n) return "";
  const score: Record<string, number> = {};
  for (const [g, words] of Object.entries(GENRE_HINTS)) {
    if (!genres.includes(g)) continue;
    for (const raw of words) {
      const w = raw.normalize("NFKC").toLowerCase();
      const ascii = /^[a-z0-9 .'\-]+$/.test(w);
      const hit = ascii ? new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(n) : n.includes(w);
      if (hit) score[g] = (score[g] || 0) + w.length;
    }
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : "";
}
