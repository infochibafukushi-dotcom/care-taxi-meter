import type {
  AccountingExpenseInput,
  ExpenseCategory,
  OcrParsedFields,
  StoredAccountingReceipt,
} from '../types/accounting'
import { buildEmptyExpenseInput } from '../services/accountingExpenses'
import { getExpensePostingDate } from '../types/accounting'
import { calculateConsumptionTaxFromIncluded } from './accountingPl'

/** 数字のみ抽出し先頭0を除去して number に変換（空欄は 0） */
export const parseYenInput = (raw: string) => {
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) {
    return 0
  }

  return Number(digits.replace(/^0+(?=\d)/, ''))
}

/** 新規入力時は 0 を空欄表示、既存データは 0 も含めて表示 */
export const formatYenInputDisplay = (amountYen: number, allowEmptyZero: boolean) => {
  if (allowEmptyZero && amountYen === 0) {
    return ''
  }

  return String(amountYen)
}

export type AccountingReceiptOcrResult = {
  status: 'success' | 'not_configured' | 'error'
  message?: string
  ocrRawText?: string
  ocrConfidence?: number
  parsed: OcrParsedFields
  suggestedExpenseCategory?: ExpenseCategory | ''
}

export const OCR_NOT_CONFIGURED_MESSAGE =
  'OCR APIが未設定です。手入力で登録できます。'

/** T + 13桁（合計14文字）の簡易チェック */
export const validateInvoiceNumberCandidate = (value: string) => {
  const normalized = value.trim().toUpperCase()
  if (!normalized) {
    return { valid: true as const, warning: '' }
  }

  if (normalized.startsWith('T') && normalized.length !== 14) {
    return {
      valid: false as const,
      warning: 'インボイス番号は T + 13桁（合計14文字）である必要があります。候補として入力しましたが、内容を確認してください。',
    }
  }

  if (normalized.startsWith('T') && !/^T\d{13}$/.test(normalized)) {
    return {
      valid: false as const,
      warning: 'インボイス番号の形式が不正です（T + 13桁の数字）。候補として入力しましたが、内容を確認してください。',
    }
  }

  return { valid: true as const, warning: '' }
}

export const applyAccountingReceiptOcrToExpense = (
  expense: AccountingExpenseInput,
  ocr: AccountingReceiptOcrResult,
): AccountingExpenseInput => {
  const parsed = ocr.parsed
  const receiptDate = parsed.receiptDate ?? parsed.transactionDate
  const postingDate = parsed.postingDate ?? receiptDate
  const taxIncludedAmount = parsed.taxIncludedAmount ?? expense.taxIncludedAmount
  const taxRate = parsed.taxRate ?? expense.taxRate
  const consumptionTaxAmount =
    parsed.consumptionTaxAmount ??
    (taxIncludedAmount > 0
      ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, taxRate)
      : expense.consumptionTaxAmount)

  return {
    ...expense,
    receiptDate: receiptDate || expense.receiptDate,
    postingDate: postingDate || expense.postingDate,
    transactionDate: postingDate || expense.transactionDate,
    vendorName: parsed.vendorName ?? expense.vendorName,
    description: parsed.description ?? expense.description,
    taxIncludedAmount,
    taxRate,
    consumptionTaxAmount,
    invoiceNumber: parsed.invoiceNumber ?? expense.invoiceNumber,
    invoiceRegisteredName: parsed.invoiceRegisteredName ?? expense.invoiceRegisteredName,
    invoiceCheckStatus: parsed.invoiceCheckStatus ?? expense.invoiceCheckStatus ?? '未確認',
    ocrRawText: ocr.ocrRawText ?? expense.ocrRawText,
    ocrParsedFields: parsed,
    ocrConfidence: ocr.ocrConfidence ?? expense.ocrConfidence,
    suggestedExpenseCategory: ocr.suggestedExpenseCategory ?? expense.suggestedExpenseCategory ?? '',
    expenseCategory: expense.expenseCategory,
  }
}

export const buildExpenseFormFromReceipt = ({
  receipt,
  franchiseeId,
  storeId,
  staffId,
  staffName,
}: {
  receipt: StoredAccountingReceipt
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
}): AccountingExpenseInput => {
  const base = buildEmptyExpenseInput({ franchiseeId, storeId, staffId, staffName })
  const receiptDate = receipt.receiptDate || receipt.ocrParsedFields?.receiptDate || ''
  const postingDate = receipt.ocrParsedFields?.postingDate || receiptDate || base.postingDate
  const taxIncludedAmount = receipt.amountTotalCandidate ?? receipt.ocrParsedFields?.taxIncludedAmount ?? 0
  const taxRate = receipt.taxRateCandidate ?? receipt.ocrParsedFields?.taxRate ?? 10
  const consumptionTaxAmount =
    receipt.taxAmountCandidate ??
    receipt.ocrParsedFields?.consumptionTaxAmount ??
    (taxIncludedAmount > 0 ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, taxRate) : 0)

  return {
    ...base,
    receiptId: receipt.id,
    receiptImageUrl: receipt.downloadUrl,
    receiptStoragePath: receipt.storagePath,
    receiptDate: receiptDate || base.receiptDate,
    postingDate: postingDate || getExpensePostingDate(base),
    transactionDate: postingDate || getExpensePostingDate(base),
    vendorName: receipt.vendorNameCandidate || receipt.ocrParsedFields?.vendorName || '',
    description: receipt.ocrParsedFields?.description || '',
    taxIncludedAmount,
    taxRate,
    consumptionTaxAmount,
    invoiceNumber: receipt.invoiceNumberCandidate || receipt.ocrParsedFields?.invoiceNumber || '',
    invoiceRegisteredName:
      receipt.invoiceRegisteredNameCandidate || receipt.ocrParsedFields?.invoiceRegisteredName || '',
    invoiceCheckStatus: receipt.ocrParsedFields?.invoiceCheckStatus ?? '未確認',
    memo: receipt.memo ?? '',
    ocrRawText: receipt.ocrRawText ?? '',
    ocrParsedFields: receipt.ocrParsedFields,
    ocrConfidence: receipt.ocrConfidence,
    suggestedExpenseCategory: receipt.suggestedExpenseCategory ?? '',
    confirmationStatus: '未確認',
    expenseCategory: '',
    plTreatment: 'expense',
  }
}

export const buildReceiptCandidateFieldsFromExpense = (
  expense: AccountingExpenseInput,
): {
  memo?: string
  receiptDate?: string
  vendorNameCandidate?: string
  invoiceNumberCandidate?: string
  invoiceRegisteredNameCandidate?: string
  amountTotalCandidate?: number
  taxAmountCandidate?: number
  taxRateCandidate?: number
} => ({
  memo: expense.memo,
  receiptDate: expense.receiptDate,
  vendorNameCandidate: expense.vendorName || undefined,
  invoiceNumberCandidate: expense.invoiceNumber || undefined,
  invoiceRegisteredNameCandidate: expense.invoiceRegisteredName || undefined,
  amountTotalCandidate: expense.taxIncludedAmount > 0 ? expense.taxIncludedAmount : undefined,
  taxAmountCandidate: expense.consumptionTaxAmount > 0 ? expense.consumptionTaxAmount : undefined,
  taxRateCandidate: expense.taxRate,
})

export const formatReceiptSavedAt = (receipt: StoredAccountingReceipt) => {
  const raw = receipt.createdAt ?? receipt.updatedAt ?? ''
  if (!raw) {
    return '―'
  }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return raw.slice(0, 10)
  }

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(date)
}
