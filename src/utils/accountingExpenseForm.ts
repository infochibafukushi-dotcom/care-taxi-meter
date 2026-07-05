import type { AccountingExpenseInput, ExpenseCategory, OcrParsedFields } from '../types/accounting'
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
    (taxIncludedAmount > 0 ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, taxRate) : expense.consumptionTaxAmount)

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
    ocrRawText: ocr.ocrRawText ?? expense.ocrRawText,
    ocrParsedFields: parsed,
    ocrConfidence: ocr.ocrConfidence ?? expense.ocrConfidence,
    suggestedExpenseCategory: ocr.suggestedExpenseCategory ?? expense.suggestedExpenseCategory ?? '',
    // 経費科目は人間が選択する（自動確定しない）
    expenseCategory: expense.expenseCategory,
  }
}
