import type {
  AccountingExpenseInput,
  ExpenseCategory,
  OcrParsedFields,
  StoredAccountingReceipt,
} from '../types/accounting'
import type { AccountingReceiptOcrCandidates } from '../types/accountingReceiptWorkflow'
import { buildEmptyExpenseInput } from '../services/accountingExpenses'
import { getExpensePostingDate } from '../types/accounting'
import { calculateConsumptionTaxFromIncluded, calculateTaxExcludedAmount } from './accountingTax'

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
  invoiceRegistrant?: import('../types/invoiceRegistrant').InvoiceRegistrantInfo
  invoiceLookupStatus?: 'success' | 'not_found' | 'error' | 'skipped' | 'idle'
  ocrCandidates?: AccountingReceiptOcrCandidates
  invoiceNotice?: string
}

export const OCR_NOT_CONFIGURED_MESSAGE =
  'OCR APIが未設定です。手入力で登録できます。'

export const OCR_AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.7

export const shouldAutoApplyOcrCandidates = (confidence?: number) =>
  (confidence ?? 0) >= OCR_AUTO_APPLY_CONFIDENCE_THRESHOLD

export const RECEIPT_IMAGE_REQUIRED_MESSAGE = '先に領収書画像をアップロードしてください。'

export const hasAccountingFormReceiptImage = (
  form: Pick<AccountingExpenseInput, 'receiptImageUrl' | 'receiptStoragePath' | 'receiptId'>,
) => Boolean(form.receiptImageUrl?.trim() || form.receiptStoragePath?.trim() || form.receiptId?.trim())

export const hasStoredAccountingReceiptImage = (
  receipt: Pick<StoredAccountingReceipt, 'downloadUrl' | 'storagePath' | 'imageUrl'>,
) => Boolean(receipt.downloadUrl?.trim() || receipt.imageUrl?.trim() || receipt.storagePath?.trim())

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
  const candidates = ocr.ocrCandidates
  const receiptDate = parsed.receiptDate ?? parsed.transactionDate
  const postingDate = parsed.postingDate ?? receiptDate
  const taxIncludedAmount = parsed.taxIncludedAmount ?? expense.taxIncludedAmount
  const taxRate =
    parsed.taxRate !== undefined ? parsed.taxRate : (expense.taxRate ?? null)
  const hasOcrTaxAmount =
    parsed.consumptionTaxAmount !== undefined || candidates?.taxAmount !== undefined
  const consumptionTaxAmount =
    candidates?.taxAmount ??
    parsed.consumptionTaxAmount ??
    (taxIncludedAmount > 0 && taxRate !== null
      ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, taxRate)
      : expense.consumptionTaxAmount)
  const suggestedExpenseCategory =
    ocr.suggestedExpenseCategory ?? expense.suggestedExpenseCategory ?? ''
  const autoApplyCandidates = shouldAutoApplyOcrCandidates(ocr.ocrConfidence)

  const registrantVerified = Boolean(
    ocr.invoiceLookupStatus === 'success' && parsed.invoiceRegisteredName,
  )
  const invoiceStatus =
    candidates?.invoiceStatus ??
    (registrantVerified ? 'verified' : parsed.invoiceNumber ? 'unknown' : 'none')
  const taxCategory = candidates?.taxCategory ?? 'taxable'
  const resolvedIncluded = candidates?.amount ?? taxIncludedAmount
  const resolvedTaxAmount = candidates?.taxAmount ?? consumptionTaxAmount

  return {
    ...expense,
    receiptDate: receiptDate || expense.receiptDate,
    postingDate: postingDate || expense.postingDate,
    transactionDate: postingDate || expense.transactionDate,
    vendorName:
      candidates?.vendorName ||
      parsed.vendorName ||
      parsed.invoiceRegisteredName ||
      expense.vendorName,
    description: candidates?.description || parsed.description || expense.description,
    taxIncludedAmount: resolvedIncluded,
    taxRate: candidates?.taxRate ?? taxRate,
    taxAmount: resolvedTaxAmount,
    consumptionTaxAmount: resolvedTaxAmount,
    taxExcludedAmount:
      candidates?.taxExcludedAmount ??
      calculateTaxExcludedAmount(resolvedIncluded, resolvedTaxAmount),
    taxCalculationMode:
      hasOcrTaxAmount || parsed.taxRate !== undefined ? 'ocr' : expense.taxCalculationMode ?? 'auto',
    invoiceNumber: candidates?.invoiceNumber || parsed.invoiceNumber || expense.invoiceNumber,
    invoiceRegisteredName:
      candidates?.invoiceRegisteredName ||
      parsed.invoiceRegisteredName ||
      expense.invoiceRegisteredName,
    invoiceCheckStatus:
      invoiceStatus === 'verified'
        ? '確認済'
        : invoiceStatus === 'not_required'
          ? '対象外'
          : invoiceStatus === 'none'
            ? '登録なし'
            : parsed.invoiceCheckStatus ?? expense.invoiceCheckStatus ?? '未確認',
    invoiceStatus,
    taxCategory,
    invoiceCheckedAt: registrantVerified ? new Date().toISOString() : expense.invoiceCheckedAt,
    invoiceRegisteredNameVerified: registrantVerified,
    invoiceCorporateNumber: parsed.invoiceCorporateNumber ?? expense.invoiceCorporateNumber,
    invoiceAddress:
      candidates?.address || parsed.invoiceAddress || expense.invoiceAddress,
    invoiceRegistrationStatus: parsed.invoiceRegistrationStatus ?? expense.invoiceRegistrationStatus,
    invoiceRegistrationDate: parsed.invoiceRegistrationDate ?? expense.invoiceRegistrationDate,
    invoiceTradeName: parsed.invoiceTradeName ?? expense.invoiceTradeName,
    invoiceLookupMethod: parsed.invoiceLookupMethod ?? expense.invoiceLookupMethod,
    invoiceRegistrant: ocr.invoiceRegistrant ?? expense.invoiceRegistrant,
    ocrRawText: ocr.ocrRawText ?? expense.ocrRawText,
    ocrParsedFields: parsed,
    ocrCandidates: candidates ?? expense.ocrCandidates,
    ocrConfidence: ocr.ocrConfidence ?? expense.ocrConfidence,
    suggestedExpenseCategory:
      candidates?.accountTitle ||
      ocr.suggestedExpenseCategory ||
      expense.suggestedExpenseCategory ||
      '',
    expenseCategory:
      autoApplyCandidates &&
      (candidates?.accountTitle || suggestedExpenseCategory) &&
      !expense.expenseCategory
        ? candidates?.accountTitle || suggestedExpenseCategory
        : expense.expenseCategory,
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
  const candidates = receipt.ocrCandidates
  const confirmed = receipt.confirmed
  const receiptDate =
    confirmed?.date ||
    receipt.receiptDate ||
    candidates?.date ||
    receipt.ocrParsedFields?.receiptDate ||
    ''
  const postingDate = receiptDate || base.postingDate
  const taxIncludedAmount =
    confirmed?.amount ??
    receipt.amountTotalCandidate ??
    candidates?.amount ??
    receipt.ocrParsedFields?.taxIncludedAmount ??
    0
  const taxRate =
    receipt.taxRateCandidate ??
    candidates?.taxRate ??
    receipt.ocrParsedFields?.taxRate ??
    null
  const consumptionTaxAmount =
    confirmed?.taxAmount ??
    receipt.taxAmountCandidate ??
    candidates?.taxAmount ??
    receipt.ocrParsedFields?.consumptionTaxAmount ??
    (taxIncludedAmount > 0 && taxRate !== null
      ? calculateConsumptionTaxFromIncluded(taxIncludedAmount, taxRate)
      : 0)
  const hasOcrTax =
    confirmed?.taxAmount != null ||
    receipt.taxAmountCandidate != null ||
    candidates?.taxAmount != null ||
    receipt.ocrParsedFields?.consumptionTaxAmount != null ||
    receipt.ocrParsedFields?.taxRate != null
  const invoiceStatus =
    confirmed?.invoiceStatus ||
    candidates?.invoiceStatus ||
    (receipt.ocrParsedFields?.invoiceNumber ? 'unknown' : 'none')
  const taxCategory = confirmed?.taxCategory || candidates?.taxCategory || 'taxable'
  const accountTitle =
    confirmed?.accountTitle ||
    candidates?.accountTitle ||
    receipt.suggestedExpenseCategory ||
    ''

  return {
    ...base,
    receiptId: receipt.id,
    receiptStatus: receipt.receiptStatus ?? 'draft',
    imageHash: receipt.imageHash || '',
    receiptImageUrl: receipt.downloadUrl || receipt.imageUrl || '',
    receiptStoragePath: receipt.storagePath,
    receiptDate: receiptDate || base.receiptDate,
    postingDate: postingDate || getExpensePostingDate(base),
    transactionDate: postingDate || getExpensePostingDate(base),
    vendorName:
      confirmed?.vendorName ||
      receipt.vendorNameCandidate ||
      candidates?.vendorName ||
      receipt.ocrParsedFields?.vendorName ||
      '',
    storeName: confirmed?.storeName || '',
    phoneNumber:
      confirmed?.phoneNumber ||
      candidates?.phoneNumber ||
      receipt.ocrParsedFields?.phoneNumber ||
      '',
    description:
      confirmed?.description ||
      candidates?.description ||
      receipt.ocrParsedFields?.description ||
      '',
    lineItems: confirmed?.lineItems ?? [],
    taxIncludedAmount,
    taxRate,
    taxAmount: consumptionTaxAmount,
    consumptionTaxAmount,
    taxExcludedAmount:
      candidates?.taxExcludedAmount ??
      calculateTaxExcludedAmount(taxIncludedAmount, consumptionTaxAmount),
    taxCalculationMode: hasOcrTax ? 'ocr' : 'auto',
    taxCategory,
    invoiceStatus,
    invoiceNumber:
      confirmed?.invoiceNumber ||
      receipt.invoiceNumberCandidate ||
      candidates?.invoiceNumber ||
      receipt.ocrParsedFields?.invoiceNumber ||
      '',
    invoiceRegisteredName:
      confirmed?.invoiceRegisteredName ||
      receipt.invoiceRegisteredNameCandidate ||
      candidates?.invoiceRegisteredName ||
      receipt.ocrParsedFields?.invoiceRegisteredName ||
      '',
    invoiceCheckStatus:
      invoiceStatus === 'verified'
        ? '確認済'
        : invoiceStatus === 'not_required'
          ? '対象外'
          : invoiceStatus === 'none'
            ? '登録なし'
            : receipt.ocrParsedFields?.invoiceCheckStatus ?? '未確認',
    invoiceRegisteredNameVerified: Boolean(
      receipt.invoiceRegistrant?.registeredName || receipt.ocrParsedFields?.invoiceLookupMethod,
    ),
    invoiceCorporateNumber:
      receipt.ocrParsedFields?.invoiceCorporateNumber || receipt.invoiceRegistrant?.corporateNumber || '',
    invoiceAddress:
      confirmed?.address ||
      candidates?.address ||
      receipt.ocrParsedFields?.invoiceAddress ||
      receipt.invoiceRegistrant?.address ||
      '',
    invoiceRegistrationStatus:
      receipt.ocrParsedFields?.invoiceRegistrationStatus ||
      receipt.invoiceRegistrant?.registrationStatus ||
      '',
    invoiceRegistrationDate:
      receipt.ocrParsedFields?.invoiceRegistrationDate ||
      receipt.invoiceRegistrant?.registrationDate ||
      '',
    invoiceTradeName:
      receipt.ocrParsedFields?.invoiceTradeName || receipt.invoiceRegistrant?.tradeName || '',
    invoiceLookupMethod:
      receipt.ocrParsedFields?.invoiceLookupMethod || receipt.invoiceRegistrant?.lookupMethod || '',
    invoiceRegistrant: receipt.invoiceRegistrant,
    invoiceCheckedAt:
      invoiceStatus === 'verified' || receipt.ocrParsedFields?.invoiceCheckStatus === '確認済'
        ? new Date().toISOString()
        : '',
    memo: confirmed?.memo || receipt.memo || '',
    ocrRawText: receipt.ocrRawText || candidates?.rawText || '',
    ocrParsedFields: receipt.ocrParsedFields,
    ocrCandidates: candidates,
    ocrConfidence: receipt.ocrConfidence,
    suggestedExpenseCategory: accountTitle,
    confirmationStatus: receipt.receiptStatus === 'confirmed' ? '確認済み' : '未確認',
    expenseCategory: accountTitle,
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
  taxRateCandidate: expense.taxRate ?? undefined,
})

export const formatReceiptSavedAt = (receipt: Pick<StoredAccountingReceipt, 'createdAt' | 'updatedAt'>) => {
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

export const formatOcrProcessedAt = (value?: string) => {
  if (!value) {
    return '―'
  }

  return formatReceiptSavedAt({ createdAt: value, updatedAt: value })
}
