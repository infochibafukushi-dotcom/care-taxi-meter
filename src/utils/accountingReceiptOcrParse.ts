import type { OcrParsedFields } from '../types/accounting'
import { suggestExpenseCategoryFromReceiptText } from './accountingReceiptExpenseCategorySuggest'

const AMOUNT_KEYWORDS = [
  '合計',
  '総合計',
  'お支払金額',
  'お支払い金額',
  '領収金額',
  '税込合計',
  '税込み',
  '税込',
  '現計',
  'お買上金額',
  'お買い上げ',
  'お買上げ',
  'お買上',
  'ご請求額',
  'ご請求',
] as const
const TAX_KEYWORDS = ['消費税', '内税額', '内税', '税額', 'うち消費税', 'うち税'] as const
const PRODUCT_LINE_SKIP =
  /^(合計|小計|税|消費税|内税|お預かり|お預り|お釣り|釣り|登録番号|ポイント|レシート|領収|領収書|領収証|商品名|単価|数量|金額|店舗|店番|担当|tel|電話|〒|no\.|seria|セリア|\d{2,4}[/-]\d{1,2}[/-]\d{0,2}|\d{4}年)/i

/** 全角英数字・記号を半角に変換 */
export const toHalfWidthAscii = (value: string) =>
  value
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[ａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))

const pad2 = (value: number) => String(value).padStart(2, '0')

const normalizeLineForMatch = (line: string) => toHalfWidthAscii(line).replace(/\s+/g, '')

const lineIncludesKeyword = (line: string, keyword: string) =>
  normalizeLineForMatch(line).includes(keyword.replace(/\s+/g, ''))

const isValidDateParts = (year: number, month: number, day: number) =>
  year >= 2000 &&
  year <= 2100 &&
  month >= 1 &&
  month <= 12 &&
  day >= 1 &&
  day <= 31

export const formatParsedDate = (year: number, month: number, day: number) => {
  if (!isValidDateParts(year, month, day)) {
    return undefined
  }

  return `${year}-${pad2(month)}-${pad2(day)}`
}

export const parseYenAmountToken = (token: string) => {
  const digits = token.replace(/[^\d]/g, '')
  if (!digits) {
    return 0
  }

  return Number(digits)
}

const isReasonableYenAmount = (amount: number) => amount > 0 && amount < 100_000_000

/** 日付連結（例: 2026708）や西暦単独を金額候補から除外 */
const isLikelyDateOrIdAmount = (amount: number, matchedText: string) => {
  const digits = String(amount)
  const half = toHalfWidthAscii(matchedText)

  // YYYYMMDD 風（OCRでスラッシュが落ちた日付）
  if (/^20\d{6}$/.test(digits)) {
    return true
  }

  // 西暦のみ（通貨マークなし）
  if (/^20\d{2}$/.test(digits) && !/[￥¥円]/.test(half)) {
    return true
  }

  return false
}

const extractAmountCandidatesFromLine = (line: string) => {
  const amounts: Array<{ amount: number; hasCurrencyMark: boolean }> = []
  const half = toHalfWidthAscii(line)

  for (const match of half.matchAll(/(?:￥|¥|Y)?\s*([\d,]+)\s*(?:円)?/gi)) {
    const matchedText = match[0]
    const amount = parseYenAmountToken(matchedText)
    if (!isReasonableYenAmount(amount) || isLikelyDateOrIdAmount(amount, matchedText)) {
      continue
    }

    amounts.push({
      amount,
      hasCurrencyMark: /[￥¥円Y]/i.test(matchedText),
    })
  }

  return amounts
}

const extractAmountsFromLine = (line: string) =>
  extractAmountCandidatesFromLine(line).map((entry) => entry.amount)

const extractAmountsNearLine = (lines: string[], lineIndex: number, span = 3) => {
  const amounts: number[] = []

  for (let index = lineIndex; index < Math.min(lineIndex + span, lines.length); index += 1) {
    amounts.push(...extractAmountsFromLine(lines[index] ?? ''))
  }

  return amounts
}

const extractPreferredAmountNearLine = (lines: string[], lineIndex: number, span = 2) => {
  const sameLine = extractAmountCandidatesFromLine(lines[lineIndex] ?? '')
  const preferredSameLine = sameLine.filter((entry) => entry.hasCurrencyMark)
  const sameLinePool = preferredSameLine.length > 0 ? preferredSameLine : sameLine
  if (sameLinePool.length > 0) {
    return Math.max(...sameLinePool.map((entry) => entry.amount))
  }

  for (let index = lineIndex + 1; index < Math.min(lineIndex + span, lines.length); index += 1) {
    const nextLine = extractAmountCandidatesFromLine(lines[index] ?? '')
    const preferredNext = nextLine.filter((entry) => entry.hasCurrencyMark)
    const nextPool = preferredNext.length > 0 ? preferredNext : nextLine
    if (nextPool.length > 0) {
      // 次行は「合計」直後の単独金額を優先（最大値より先に先頭候補）
      return nextPool[0]?.amount
    }
  }

  return undefined
}

const pickTaxAmount = (amounts: number[], totalAmount?: number) => {
  const filtered = amounts.filter((amount) => {
    if (amount <= 0 || amount >= 10_000_000) {
      return false
    }

    if (totalAmount !== undefined && amount >= totalAmount) {
      return false
    }

    return true
  })

  if (filtered.length === 0) {
    return undefined
  }

  return Math.max(...filtered)
}

const isLikelyNoiseLine = (line: string) => {
  const normalized = line.trim()
  if (!normalized) {
    return true
  }

  if (/^(T\d{13}|登録番号|適格請求書|レシート|領収書|領収証)/i.test(normalized)) {
    return true
  }

  if (/^\d+$/.test(normalized)) {
    return true
  }

  if (/^(合計|小計|税込|消費税|お預かり|お釣り)/.test(normalized)) {
    return true
  }

  return false
}

/** インボイス番号を T + 13桁に正規化 */
export const extractInvoiceNumber = (text: string) => {
  const half = toHalfWidthAscii(text).toUpperCase()
  const pattern = /T(?:[\s-]*\d){13}/gi

  for (const match of half.matchAll(pattern)) {
    const normalized = match[0].replace(/[^0-9T]/g, '')
    if (/^T\d{13}$/.test(normalized)) {
      return normalized
    }
  }

  return undefined
}

/** 領収書日付を YYYY-MM-DD に正規化 */
export const extractReceiptDate = (text: string) => {
  const half = toHalfWidthAscii(text)

  const japaneseDate = half.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (japaneseDate) {
    return formatParsedDate(
      Number(japaneseDate[1]),
      Number(japaneseDate[2]),
      Number(japaneseDate[3]),
    )
  }

  const isoLikeDate = half.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/)
  if (isoLikeDate) {
    return formatParsedDate(
      Number(isoLikeDate[1]),
      Number(isoLikeDate[2]),
      Number(isoLikeDate[3]),
    )
  }

  const shortYearDate = half.match(/\b(\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/)
  if (shortYearDate) {
    return formatParsedDate(
      Number(shortYearDate[1]) + 2000,
      Number(shortYearDate[2]),
      Number(shortYearDate[3]),
    )
  }

  return undefined
}

/** 優先語句付近の税込金額を抽出 */
export const extractTaxIncludedAmount = (text: string) => {
  const half = toHalfWidthAscii(text)
  const lines = half.split(/\r?\n/)

  let bestAmount: number | undefined
  let bestPriority = Number.POSITIVE_INFINITY

  lines.forEach((line, lineIndex) => {
    AMOUNT_KEYWORDS.forEach((keyword, index) => {
      if (!lineIncludesKeyword(line, keyword)) {
        return
      }

      const candidate = extractPreferredAmountNearLine(lines, lineIndex)
      if (candidate === undefined || !isReasonableYenAmount(candidate)) {
        return
      }

      // キーワード一致時は小売想定上限を優先
      if (candidate > 1_000_000) {
        return
      }

      if (index < bestPriority || (index === bestPriority && candidate > (bestAmount ?? 0))) {
        bestPriority = index
        bestAmount = candidate
      }
    })
  })

  if (bestAmount !== undefined) {
    return bestAmount
  }

  const fallbackAmounts = extractAmountCandidatesFromLine(half)
    .filter((entry) => entry.amount <= 1_000_000)
    .map((entry) => entry.amount)

  if (fallbackAmounts.length === 0) {
    return undefined
  }

  return Math.max(...fallbackAmounts)
}

/** 消費税額候補を抽出 */
export const extractConsumptionTaxAmount = (text: string, totalAmount?: number) => {
  const half = toHalfWidthAscii(text)
  const lines = half.split(/\r?\n/)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    if (!TAX_KEYWORDS.some((keyword) => lineIncludesKeyword(line, keyword))) {
      continue
    }

    const amounts = extractAmountsNearLine(lines, lineIndex)
    const candidate = pickTaxAmount(amounts, totalAmount)
    if (candidate !== undefined) {
      return candidate
    }
  }

  return undefined
}

/** 税率（取れなければ 10%） */
export const extractTaxRate = (text: string) => {
  const half = toHalfWidthAscii(text)

  if (/(?:^|[^\d])8\s*%|8%|軽減税率/.test(half)) {
    return 8
  }

  if (/(?:^|[^\d])10\s*%|10%/.test(half)) {
    return 10
  }

  return 10
}

/** 支払先候補（会社名らしき行） */
export const extractVendorName = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines.slice(0, 12)) {
    if (/(セリア|Seria)/i.test(line) && !isLikelyNoiseLine(line)) {
      return /セリア/.test(line) ? 'セリア' : 'Seria'
    }
  }

  for (const line of lines.slice(0, 12)) {
    if (/(株式会社|有限会社|合同会社|（株）|\(株\)|薬局|医院|クリニック|店)/.test(line)) {
      if (!isLikelyNoiseLine(line)) {
        return line.slice(0, 80)
      }
    }
  }

  for (const line of lines.slice(0, 6)) {
    if (line.length >= 2 && !isLikelyNoiseLine(line)) {
      return line.slice(0, 80)
    }
  }

  return undefined
}

/** 商品名一覧を内容候補用テキストに整形 */
export const extractProductDescription = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const products: string[] = []

  for (const line of lines) {
    const half = toHalfWidthAscii(line)
    if (PRODUCT_LINE_SKIP.test(half) || isLikelyNoiseLine(line)) {
      continue
    }

    if (/^\d{2,4}[/-]\d{1,2}/.test(half) || /\d{4}年/.test(half)) {
      continue
    }

    if (/^T\d{13}$/i.test(half.replace(/\s+/g, ''))) {
      continue
    }

    const productMatch =
      half.match(/^(.+?)\s+(?:[@×x*＠]?\s*)?(?:￥|¥|Y)?(\d{1,7})(?:円)?\s*$/) ??
      half.match(/^(.{2,40}?)(?:￥|¥|Y)?(\d{2,7})$/)
    if (!productMatch) {
      continue
    }

    const name = productMatch[1]
      .replace(/[@×x*＠]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    const price = Number(productMatch[2])

    if (name.length < 2 || price <= 0 || price >= 100_000) {
      continue
    }

    if (/^[\d\s\-]+$/.test(name)) {
      continue
    }

    products.push(name.slice(0, 40))
  }

  if (products.length === 0) {
    return undefined
  }

  return [...new Set(products)].slice(0, 8).join('・')
}

/** OCR全文から経費入力候補を抽出 */
export const parseAccountingReceiptOcrText = (text: string): OcrParsedFields => {
  const receiptDate = extractReceiptDate(text)
  const taxIncludedAmount = extractTaxIncludedAmount(text)
  const consumptionTaxAmount = extractConsumptionTaxAmount(text, taxIncludedAmount)
  const taxRate = extractTaxRate(text)
  const invoiceNumber = extractInvoiceNumber(text)
  const vendorName = extractVendorName(text)
  const description = extractProductDescription(text)

  return {
    receiptDate,
    postingDate: receiptDate,
    vendorName,
    description,
    taxIncludedAmount,
    taxRate,
    consumptionTaxAmount,
    invoiceNumber,
    // 登録事業者名はインボイス番号検索結果を優先するため、ここでは OCR 仕入先を入れない
    invoiceRegisteredName: undefined,
    invoiceCheckStatus: invoiceNumber ? '未確認' : undefined,
    invoiceOcrNumber: invoiceNumber,
  }
}

export const buildSuggestedExpenseCategory = (parsed: OcrParsedFields) =>
  suggestExpenseCategoryFromReceiptText({
    description: parsed.description,
    vendorName: parsed.vendorName,
  })
