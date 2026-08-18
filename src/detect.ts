/**
 * CJK detection gate for reasoning translation.
 *
 * @module dsh-reasoning-cn/detect
 */

/** CJK code-point ranges: ideographs, extensions, compatibility, punctuation, fullwidth forms. */
function isCjkCodePoint(code: number): boolean {
  return (code >= 0x3400 && code <= 0x4dbf) // CJK Extension A
    || (code >= 0x4e00 && code <= 0x9fff) // CJK Unified Ideographs
    || (code >= 0xf900 && code <= 0xfaff) // CJK Compatibility Ideographs
    || (code >= 0x20000 && code <= 0x2ffff) // CJK Extensions B and above
    || (code >= 0x3000 && code <= 0x303f) // CJK Symbols and Punctuation
    || (code >= 0xff00 && code <= 0xffef) // Halfwidth and Fullwidth Forms
}

/** Hiragana, Katakana, and their extensions are unambiguously Japanese. */
function isJapaneseCodePoint(code: number): boolean {
  return (code >= 0x3040 && code <= 0x309f)
    || (code >= 0x30a0 && code <= 0x30ff)
    || (code >= 0x31f0 && code <= 0x31ff)
    || (code >= 0x1b000 && code <= 0x1b16f)
}

function isLatinLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
}

function isCjkLetter(code: number): boolean {
  return (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x20000 && code <= 0x2ffff)
    || isJapaneseCodePoint(code)
}

/**
 * Traditional-only characters commonly emitted in Chinese reasoning. Shared
 * Han characters cannot distinguish scripts, so an all-shared sentence is
 * intentionally treated as indeterminate rather than misclassified.
 */
const TRADITIONAL_ONLY = new Set([
  ...'萬與為專業東絲兩嚴喪個豐臨麗舉麼義烏樂喬習鄉書買亂爭於雲亞產親億僅從侖倉儀們價眾優會傘偉傳傷倫偽體餘傭債傾僑儲兒兌黨蘭關興養獸內冊寫軍農馮凱別刪則剛創劃劉劑勁動務勳區醫華協單賣衛卻廠廳厲壓參雙發變葉號嘆嘗嚮嚴國園圓圖團壞塊壓壢壟壘壟壟壺壽夢夥奪奮奧奬婦媽媧嬌嬰孫學寧審實寬寢寶將專尋對導屆屬岡峽島嶺嶼嶽巔幣幫幹幾庫廁廂廈廚廟廢廣廬廳弒張彈彌彎彙彥後徑從復徵德憂懇應戲戶拋拔擇擊擋攏攔攤攪攬敗敘敵數斂斷無舊時晉晝暈曆曇術東條來楊極構樞樣樓標樂樹橋機檔檢櫃權歐歟歡歲歷殘殼毀氣氫漢湯濟濤淵淨減測溝滅滯滿漁漲漸濃濕濟濱濾瀉灑災爐點為煉煙燈營燦燭爭爺爾牆獎獨獲獻獸現環瑪瑩畫當畝畢異癡發盜盡監盤盧眾睜矚矯礎禮禍禪離種穩窩竊競筆築籌簡簽簾籃糧糾紀紂約紅紋納紐純紕級紛紙紮紛終組經結給絕統絲絹綁綠緊緒線練縣總績織繪繫繩繪繭繼續纏罰羅聖聞聯聰聲職聽肅脅腳脫腦臉臺與興舊艱藝節華萬葉蘇處虛蟲衛衝補裝裡複覺觀觸計訓訊託記訥訪設許訴訟診詩該詳誠誤說課調請諸諾謀謂謝證譯議讀變讓讚豐貝財貢貧貨販貪貫責貯貴費賀賓賠賴賽贊贏趕趙跡踐蹟車軌軍軟較載輔輕輛輝輪輸辦辭邊遙遜遞鄧鄭鄰鄭鄉醫釋鈔鈕鈣鈴鉛銅銳鋒鋼錄錢錦鍊鍾鎖鎮鏡鐵鑄鑑門閃閉開閒間閣閱隊陽陰陣階際險隱雙雜雞難雲電靈靜靜頂頃項順頑頓領頗頻題額顏顯顧颱飄飛飯飲飾餃餅館驅驗驚體髮鬥魯鮮鯨鳥鳳鳴鴨鴻鵝麥黃點黨齊齒齡龍龜',
])

/** Whether text contains script-specific Japanese or traditional Chinese characters. */
export function needsSimplifiedConversion(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (isJapaneseCodePoint(code) || TRADITIONAL_ONLY.has(ch)) return true
  }
  return false
}

/**
 * CJK code points over the CJK-plus-Latin-letter total. Text with neither
 * reports 0; callers combine this advisory ratio with the code-only gate.
 *
 * @param text - the assembled reasoning text.
 * @returns the CJK ratio in [0, 1].
 */
export function cjkRatio(text: string): number {
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (isCjkCodePoint(code)) cjk++
    else if (isLatinLetter(code)) latin++
  }
  const total = cjk + latin
  return total === 0 ? 0 : cjk / total
}

function isCodeOnlyLine(line: string): boolean {
  return /^(?:[$>#]\s*)?(?:(?:npm|pnpm|yarn|bun|npx|node|git|cd)\b|(?:const|let|var|import|export|function|class|return|if|for|while|async|await)\b|[\[{(]|["']?[\w.-]+["']?\s*(?:[:=]|=>)|[\w$.]+\s*\(|(?:[~./][\w@~./-]*|[\w.-]+\/[\w@~./-]+)(?::\d+)?$)/.test(line)
}

/** Whether text contains prose rather than only commands, code, paths, or numbers. */
export function hasTranslatableText(text: string): boolean {
  const outsideCode = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const lines = outsideCode.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return false
  let hasLetters = false
  for (const ch of outsideCode) {
    const code = ch.codePointAt(0) ?? 0
    if (isLatinLetter(code) || isCjkLetter(code)) {
      hasLetters = true
      break
    }
  }
  if (!hasLetters) return false
  return !lines.every(isCodeOnlyLine)
}

/**
 * Whether one buffered reasoning text should be translated or normalized:
 * non-empty Japanese/traditional text always needs conversion to Simplified
 * Chinese; otherwise a CJK-ratio gate treats likely Simplified Chinese as
 * already suitable.
 *
 * @param text - the assembled reasoning text.
 * @param threshold - the CJK ratio at or above which text counts as Chinese.
 * @returns true when translation or script conversion should run.
 */
export function needsTranslation(text: string, threshold: number): boolean {
  if (text.length === 0) return false
  if (!hasTranslatableText(text)) return false
  return needsSimplifiedConversion(text) || cjkRatio(text) < threshold
}
