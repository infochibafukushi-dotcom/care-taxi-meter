import type { OcrParsedFields } from '../types/accounting'

const AMOUNT_KEYWORDS = ['合計', '総合計', 'お支払金額', 'お支払い金額', '領収金額', '税込', '現計'] as const
const TAX_KEYWORDS = ['消費税', '内税', '税額', 'うち消費税', 'うち税'] as const

/** 全角英数字・記号を半角に変換 */
export const toHalfWidthAscii = (value: string) =>
  value
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[ａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))

const pad2 = (value: number) => String(value).padStart(2, '0')

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

const extractAmountsFromLine = (line: string) => {
  const amounts: number[] = []

  for (const match of line.matchAll(/(?:￥|¥)?\s*([\d,]+)\s*(?:円)?/g)) {
    const amount = parseYenAmountToken(match[0])
    if (isReasonableYenAmount(amount)) {
      amounts.push(amount)
    }
  }

  return amounts
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
  const pattern = /T(?:[\s\-]*\d){13}/gi

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

  const isoLikeDate = half.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/)
  if (isoLikeDate) {
    return formatParsedDate(
      Number(isoLikeDate[1]),
      Number(isoLikeDate[2]),
      Number(isoLikeDate[3]),
    )
  }

  const shortYearDate = half.match(/\b(\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/)
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

  lines.forEach((line) => {
    AMOUNT_KEYWORDS.forEach((keyword, index) => {
      if (!line.includes(keyword)) {
        return
      }

      const amounts = extractAmountsFromLine(line)
      if (amounts.length === 0) {
        return
      }

      const candidate = Math.max(...amounts)
      if (index < bestPriority || (index === bestPriority && candidate > (bestAmount ?? 0))) {
        bestPriority = index
        bestAmount = candidate
      }
    })
  })

  if (bestAmount !== undefined) {
    return bestAmount
  }

  const fallbackAmounts = [...half.matchAll(/(?:￥|¥)?\s*([\d,]+)\s*円/g)]
    .map((match) => parseYenAmountToken(match[0]))
    .filter(isReasonableYenAmount)

  if (fallbackAmounts.length === 0) {
    return undefined
  }

  return Math.max(...fallbackAmounts)
}

/** 消費税額候補を抽出 */
export const extractConsumptionTaxAmount = (text: string) => {
  const half = toHalfWidthAscii(text)
  const lines = half.split(/\r?\n/)

  for (const line of lines) {
    if (!TAX_KEYWORDS.some((keyword) => line.includes(keyword))) {
      continue
    }

    const amounts = extractAmountsFromLine(line).filter((amount) => amount < 10_000_000)
    if (amounts.length > 0) {
      return Math.max(...amounts)
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

/** OCR全文から経費入力候補を抽出 */
export const parseAccountingReceiptOcrText = (text: string): OcrParsedFields => {
  const receiptDate = extractReceiptDate(text)
  const taxIncludedAmount = extractTaxIncludedAmount(text)
  const consumptionTaxAmount = extractConsumptionTaxAmount(text)
  const taxRate = extractTaxRate(text)
  const invoiceNumber = extractInvoiceNumber(text)
  const vendorName = extractVendorName(text)

  return {
    receiptDate,
    postingDate: receiptDate,
    vendorName,
    taxIncludedAmount,
    taxRate,
    consumptionTaxAmount,
    invoiceNumber,
    invoiceRegisteredName: vendorName,
    invoiceCheckStatus: invoiceNumber ? '未確認' : undefined,
  }
}
