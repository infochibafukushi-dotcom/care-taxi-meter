import type { ExpenseCategory } from './accounting'

/** 税区分（確定値） */
export const TAX_CATEGORIES = ['taxable', 'non_taxable', 'out_of_scope'] as const
export type TaxCategory = (typeof TAX_CATEGORIES)[number]

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  taxable: '課税',
  non_taxable: '非課税',
  out_of_scope: '対象外',
}

/** インボイス有無ステータス（確定値） */
export const INVOICE_STATUSES = ['verified', 'none', 'not_required', 'unknown'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  verified: 'あり・確認済',
  none: 'なし',
  not_required: '対象外',
  unknown: '未確認',
}

/** 領収書ワークフロー状態（集計は confirmed のみ） */
export const ACCOUNTING_RECEIPT_WORKFLOW_STATUSES = [
  'draft',
  'ocr_ready',
  'confirmed',
  'rejected',
] as const
export type AccountingReceiptWorkflowStatus = (typeof ACCOUNTING_RECEIPT_WORKFLOW_STATUSES)[number]

export const ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS: Record<
  AccountingReceiptWorkflowStatus,
  string
> = {
  draft: '下書き',
  ocr_ready: 'OCR候補あり・未確定',
  confirmed: '確認済み（集計対象）',
  rejected: '登録しない',
}

export const ACCOUNTING_SOURCE_DEVICES = ['mobile', 'pc'] as const
export type AccountingSourceDevice = (typeof ACCOUNTING_SOURCE_DEVICES)[number]

/** OCR候補（集計に使わない） */
export type AccountingReceiptOcrCandidates = {
  vendorName?: string
  phoneNumber?: string
  address?: string
  invoiceNumber?: string
  invoiceRegisteredName?: string
  date?: string
  /** 税込金額候補 */
  amount?: number
  /** 消費税額候補 */
  taxAmount?: number
  /** 消費税率候補（%） */
  taxRate?: number
  /** 税抜金額候補 */
  taxExcludedAmount?: number
  description?: string
  accountTitle?: ExpenseCategory | ''
  taxCategory?: TaxCategory
  invoiceStatus?: InvoiceStatus
  rawText?: string
}

/** 人間確認後の確定値（集計に使う） */
export type AccountingReceiptConfirmedFields = {
  vendorName: string
  date: string
  amount: number
  taxAmount?: number
  taxCategory: TaxCategory
  invoiceStatus: InvoiceStatus
  invoiceNumber?: string
  invoiceRegisteredName?: string
  accountTitle: ExpenseCategory | ''
  description: string
  memo?: string
  phoneNumber?: string
  address?: string
  storeName?: string
  /**
   * 将来の複数仕訳（例: 車検=整備代+重量税）。
   * 現状の UI は1行だが、データ構造として維持する。
   */
  lineItems?: AccountingExpenseLineItemDraft[]
}

/** 1枚の領収書を複数明細へ分割するための下書き型（将来対応） */
export type AccountingExpenseLineItemDraft = {
  id: string
  description: string
  expenseCategory: ExpenseCategory | ''
  taxIncludedAmount: number
  consumptionTaxAmount?: number
  taxRate?: number
  taxCategory: TaxCategory
  invoiceStatus?: InvoiceStatus
}

export type AccountingReceiptEditHistoryEntry = {
  editedAt: string
  editedBy: string
  sourceDevice: AccountingSourceDevice
  changedFields: string[]
}

export const normalizeTaxCategory = (value: unknown): TaxCategory => {
  if (value === 'non_taxable' || value === 'out_of_scope' || value === 'taxable') {
    return value
  }
  return 'taxable'
}

export const normalizeInvoiceStatus = (value: unknown): InvoiceStatus => {
  if (value === 'verified' || value === 'none' || value === 'not_required' || value === 'unknown') {
    return value
  }
  return 'unknown'
}

export const normalizeAccountingReceiptWorkflowStatus = (
  value: unknown,
  fallback: AccountingReceiptWorkflowStatus = 'draft',
): AccountingReceiptWorkflowStatus => {
  if (
    value === 'draft' ||
    value === 'ocr_ready' ||
    value === 'confirmed' ||
    value === 'rejected'
  ) {
    return value
  }
  return fallback
}

export const isConfirmedReceiptForAggregation = (
  receiptStatus: AccountingReceiptWorkflowStatus | undefined,
) => receiptStatus === 'confirmed'

export const detectSourceDevice = (): AccountingSourceDevice => {
  if (typeof navigator === 'undefined') {
    return 'pc'
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'pc'
}

export const buildEmptyConfirmedFields = (): AccountingReceiptConfirmedFields => ({
  vendorName: '',
  date: '',
  amount: 0,
  taxAmount: 0,
  taxCategory: 'taxable',
  invoiceStatus: 'unknown',
  invoiceNumber: '',
  invoiceRegisteredName: '',
  accountTitle: '',
  description: '',
  memo: '',
  phoneNumber: '',
  address: '',
  storeName: '',
  lineItems: [],
})
