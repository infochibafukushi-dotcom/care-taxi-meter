import type { ExpenseCategory, OcrParsedFields } from '../types/accounting'
import type {
  AccountingReceiptConfirmedFields,
  AccountingReceiptOcrCandidates,
  InvoiceStatus,
  TaxCategory,
} from '../types/accountingReceiptWorkflow'
import { toHalfWidthAscii } from './accountingReceiptOcrParse'
import { suggestExpenseCategoryFromReceiptText } from './accountingReceiptExpenseCategorySuggest'

const PUBLIC_FEE_KEYWORDS = [
  '市役所',
  '区役所',
  '法務局',
  '印鑑証明',
  '印鑑登録証明書',
  '住民票',
  '戸籍',
  '登記事項証明書',
  '証明書交付',
  '手数料',
  '電子納付',
  '登録免許税',
] as const

export const isPublicFeeReceiptText = (text: string) =>
  PUBLIC_FEE_KEYWORDS.some((keyword) => text.includes(keyword))

/** 電話番号候補抽出 */
export const extractPhoneNumber = (text: string) => {
  const half = toHalfWidthAscii(text)
  const match = half.match(/(?:TEL|Tel|電話|℡)?\s*[:：]?\s*(0\d{1,4}[\s-]?\d{1,4}[\s-]?\d{3,4})/)
  if (!match) {
    return undefined
  }
  const normalized = match[1].replace(/[^\d]/g, '')
  if (normalized.length < 10 || normalized.length > 11) {
    return undefined
  }
  return match[1].replace(/\s+/g, '')
}

/** 住所候補抽出（簡易） */
export const extractAddress = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (/(〒\s*\d{3}-?\d{4}|[都道府県].+[市区町村]|丁目|番地)/.test(line)) {
      if (line.length >= 8 && line.length <= 120) {
        return line
      }
    }
  }

  return undefined
}

export type ReceiptClassificationHint = {
  taxCategory: TaxCategory
  invoiceStatus: InvoiceStatus
  accountTitle: ExpenseCategory | ''
  description?: string
  taxAmount?: number
  notice?: string
}

/** T番号なし／公共手数料／小規模事業者の自動候補 */
export const classifyReceiptWithoutInvoice = ({
  text,
  vendorName,
  phoneNumber,
  address,
}: {
  text: string
  vendorName?: string
  phoneNumber?: string
  address?: string
}): ReceiptClassificationHint => {
  if (isPublicFeeReceiptText(text)) {
    const accountTitle: ExpenseCategory =
      /登録免許税|電子納付|登記/.test(text) ? '租税公課' : '決済手数料'

    return {
      taxCategory: /登録免許税/.test(text) ? 'out_of_scope' : 'non_taxable',
      invoiceStatus: 'not_required',
      accountTitle,
      description: '証明書発行手数料',
      taxAmount: 0,
    }
  }

  if (vendorName || phoneNumber || address) {
    return {
      taxCategory: 'taxable',
      invoiceStatus: 'none',
      accountTitle: suggestExpenseCategoryFromReceiptText({
        description: text.slice(0, 200),
        vendorName,
      }),
      notice: 'インボイス番号がないため、仕入税額控除の対象は要確認です。',
    }
  }

  return {
    taxCategory: 'taxable',
    invoiceStatus: 'unknown',
    accountTitle: '',
  }
}

export const buildOcrCandidatesFromParsed = ({
  parsed,
  rawText,
  suggestedExpenseCategory,
}: {
  parsed: OcrParsedFields
  rawText?: string
  suggestedExpenseCategory?: ExpenseCategory | ''
}): AccountingReceiptOcrCandidates => {
  const phoneNumber = rawText ? extractPhoneNumber(rawText) : undefined
  const address = parsed.invoiceAddress || (rawText ? extractAddress(rawText) : undefined)
  const hasInvoice = Boolean(parsed.invoiceNumber)

  let taxCategory: TaxCategory = 'taxable'
  let invoiceStatus: InvoiceStatus = hasInvoice ? 'verified' : 'unknown'
  let accountTitle: ExpenseCategory | '' = suggestedExpenseCategory ?? ''
  let description = parsed.description
  let taxAmount = parsed.consumptionTaxAmount

  if (!hasInvoice && rawText) {
    const hint = classifyReceiptWithoutInvoice({
      text: rawText,
      vendorName: parsed.vendorName,
      phoneNumber,
      address,
    })
    taxCategory = hint.taxCategory
    invoiceStatus = hint.invoiceStatus
    accountTitle = hint.accountTitle || accountTitle
    description = hint.description || description
    if (hint.taxAmount !== undefined) {
      taxAmount = hint.taxAmount
    }
  } else if (hasInvoice && parsed.invoiceCheckStatus === '確認済') {
    invoiceStatus = 'verified'
  } else if (hasInvoice) {
    invoiceStatus = 'unknown'
  }

  return {
    vendorName: parsed.vendorName || parsed.invoiceRegisteredName,
    phoneNumber,
    address,
    invoiceNumber: parsed.invoiceNumber,
    invoiceRegisteredName: parsed.invoiceRegisteredName,
    date: parsed.receiptDate || parsed.transactionDate,
    amount: parsed.taxIncludedAmount,
    taxAmount,
    taxRate: parsed.taxRate,
    taxExcludedAmount:
      parsed.taxExcludedAmount ??
      (parsed.taxIncludedAmount != null && taxAmount != null
        ? Math.max(parsed.taxIncludedAmount - taxAmount, 0)
        : undefined),
    description,
    accountTitle,
    taxCategory,
    invoiceStatus,
    rawText: rawText || undefined,
  }
}

export const buildConfirmedDraftFromCandidates = (
  candidates: AccountingReceiptOcrCandidates,
  memo?: string,
): AccountingReceiptConfirmedFields => ({
  vendorName: candidates.vendorName || '',
  date: candidates.date || '',
  amount: candidates.amount ?? 0,
  taxAmount: candidates.taxAmount ?? 0,
  taxCategory: candidates.taxCategory ?? 'taxable',
  invoiceStatus: candidates.invoiceStatus ?? 'unknown',
  invoiceNumber: candidates.invoiceNumber || '',
  invoiceRegisteredName: candidates.invoiceRegisteredName || '',
  accountTitle: candidates.accountTitle || '',
  description: candidates.description || '',
  memo: memo || '',
  phoneNumber: candidates.phoneNumber || '',
  address: candidates.address || '',
})
