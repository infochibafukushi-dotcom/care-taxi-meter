import type { InvoiceRegistrantInfo } from './invoiceRegistrant'
import type {
  AccountingReceiptConfirmedFields,
  AccountingReceiptEditHistoryEntry,
  AccountingReceiptOcrCandidates,
  AccountingReceiptWorkflowStatus,
  AccountingSourceDevice,
  AccountingExpenseLineItemDraft,
  InvoiceStatus,
  TaxCategory,
} from './accountingReceiptWorkflow'

export type {
  AccountingReceiptConfirmedFields,
  AccountingReceiptEditHistoryEntry,
  AccountingReceiptOcrCandidates,
  AccountingReceiptWorkflowStatus,
  AccountingSourceDevice,
  AccountingExpenseLineItemDraft,
  InvoiceStatus,
  TaxCategory,
} from './accountingReceiptWorkflow'

export {
  ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS,
  ACCOUNTING_RECEIPT_WORKFLOW_STATUSES,
  ACCOUNTING_SOURCE_DEVICES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  TAX_CATEGORY_LABELS,
  TAX_CATEGORIES,
  buildEmptyConfirmedFields,
  detectSourceDevice,
  isConfirmedReceiptForAggregation,
  normalizeAccountingReceiptWorkflowStatus,
  normalizeInvoiceStatus,
  normalizeTaxCategory,
} from './accountingReceiptWorkflow'

export {
  ACCOUNT_CATEGORY_MASTER,
  ACCOUNT_PL_CATEGORIES,
  ACCOUNT_PL_CATEGORY_LABELS,
  COST_OF_SALES_CATEGORIES,
  EXPENSE_CATEGORIES,
  FIXED_COST_CATEGORY_OPTIONS,
  FIXED_EXPENSE_CATEGORIES,
  getAccountPlCategory,
  getExpenseCategoriesByPlCategory,
  isExpenseCategorySelected,
  isSalesCategory,
  LEGACY_EXPENSE_CATEGORY_MAP,
  LEGACY_SALES_CATEGORY_MAP,
  normalizeExpenseCategory,
  normalizeSalesCategory,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
  type AccountPlCategory,
  type CostOfSalesCategory,
  type ExpenseCategory,
  type FixedExpenseCategory,
  type SalesCategory,
  type VariableExpenseCategory,
} from './accountingCategoryMaster'

import {
  isExpenseCategorySelected,
  normalizeExpenseCategory,
  normalizeSalesCategory,
  type ExpenseCategory,
  type SalesCategory,
} from './accountingCategoryMaster'
import { deriveTaxFields, normalizeTaxCalculationMode, normalizeTaxRate } from '../utils/accountingTax'

export const FIXED_COST_AMOUNT_MODES = ['monthly', 'annual'] as const

export type FixedCostAmountMode = (typeof FIXED_COST_AMOUNT_MODES)[number]

export const FIXED_COST_STATUSES = ['active', 'cancelled'] as const

export type FixedCostStatus = (typeof FIXED_COST_STATUSES)[number]

export const FIXED_COST_STATUS_LABELS: Record<FixedCostStatus, string> = {
  active: '有効',
  cancelled: '解約済み',
}

export const EXPENSE_CONFIRMATION_STATUSES = ['未確認', '確認済み', '無効'] as const

export type ExpenseConfirmationStatus = (typeof EXPENSE_CONFIRMATION_STATUSES)[number]

/** 日常入力向け。役員立替は後方互換のため残す */
export const PAYMENT_METHODS = [
  '現金',
  'クレジットカード',
  'オーナー立替',
  '銀行振込',
  '電子マネー',
  '役員立替',
  'その他',
] as const

export const PL_TREATMENTS = ['expense', 'excluded', 'deferredCandidate'] as const

export type PlTreatment = (typeof PL_TREATMENTS)[number]

export const PL_TREATMENT_LABELS: Record<PlTreatment, string> = {
  expense: 'PL反映する',
  excluded: 'PL反映しない',
  deferredCandidate: '繰延資産候補',
}

export type AccountingPaymentMethod = (typeof PAYMENT_METHODS)[number]

export const INVOICE_CHECK_STATUSES = ['未確認', '確認済', '登録あり', '登録なし', '対象外'] as const

export type InvoiceCheckStatus = (typeof INVOICE_CHECK_STATUSES)[number]

/** 領収書データの整理状態 */
export const RECEIPT_STATUSES = ['unorganized', 'linked', 'invalid'] as const

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number]

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  unorganized: '未整理',
  linked: '経費紐付け済み',
  invalid: '無効',
}

export type OcrParsedFields = {
  transactionDate?: string
  receiptDate?: string
  postingDate?: string
  vendorName?: string
  description?: string
  taxIncludedAmount?: number
  taxExcludedAmount?: number
  /** 消費税率候補（%）。未検出時は undefined */
  taxRate?: number
  consumptionTaxAmount?: number
  invoiceNumber?: string
  invoiceRegisteredName?: string
  invoiceCheckStatus?: InvoiceCheckStatus
  /** インボイス番号から取得した法人番号（T無し13桁） */
  invoiceCorporateNumber?: string
  /** 登録事業者の所在地 */
  invoiceAddress?: string
  /** 登録状況（登録／取消／失効など） */
  invoiceRegistrationStatus?: string
  /** 登録年月日（YYYY-MM-DD） */
  invoiceRegistrationDate?: string
  /** 屋号 */
  invoiceTradeName?: string
  /** 取得方法（例: インボイス番号検索） */
  invoiceLookupMethod?: string
  /** OCR番号（検索に使った登録番号） */
  invoiceOcrNumber?: string
  phoneNumber?: string
  address?: string
}

export type AccountingOcrData = {
  ocrRawText?: string
  ocrParsedFields?: OcrParsedFields
  ocrConfidence?: number
  ocrProcessedAt?: string
  suggestedExpenseCategory?: ExpenseCategory | ''
  invoiceRegistrant?: InvoiceRegistrantInfo
  ocrCandidates?: AccountingReceiptOcrCandidates
}

export type AccountingTenantFields = {
  franchiseeId: string
  companyId: string
  storeId: string
}

export type AccountingExpenseInput = AccountingTenantFields &
  AccountingOcrData & {
    /** @deprecated 後方互換のため残存。保存時は postingDate と同期される */
    transactionDate: string
    /** 領収書・請求書に記載された日付 */
    receiptDate?: string
    /** 会社の帳簿に載せる日付 */
    postingDate?: string
    /** PLへの反映区分 */
    plTreatment?: PlTreatment
    vendorName: string
    /** 店舗名（領収書記載の店名など） */
    storeName?: string
    /** 仕入先電話番号 */
    phoneNumber?: string
    description: string
    expenseCategory: ExpenseCategory | ''
    taxIncludedAmount: number
    /** 消費税率（%）。未設定は null。保存は number | null */
    taxRate: number | null
    /**
     * 消費税額（円）。自動計算・手入力・OCRのいずれか。
     * @deprecated 新フィールド taxAmount と同一。後方互換のため残す
     */
    consumptionTaxAmount: number
    /** 消費税額（円）。consumptionTaxAmount と同値で保存 */
    taxAmount?: number | null
    /** 税抜金額（円）。将来の税抜PL切替用 */
    taxExcludedAmount?: number | null
    /** 税額の算出方法 */
    taxCalculationMode?: 'auto' | 'manual' | 'ocr'
    paymentMethod: AccountingPaymentMethod | ''
    /**
     * 適格請求書発行事業者登録番号（T+13桁）。
     * 請求書番号（billingInvoiceNumber）とは別フィールド。
     */
    invoiceNumber?: string
    /**
     * 仕入先の請求書番号・注文番号など（例: 04890-15126953-1）。
     * 適格請求書発行事業者登録番号（invoiceNumber）とは別フィールド。
     */
    billingInvoiceNumber?: string
    /** 紐付固定資産 ID（経費側からの参照。資産側 expenseId と併用） */
    linkedAssetId?: string
    invoiceCheckStatus?: InvoiceCheckStatus
    invoiceRegisteredName?: string
    invoiceCheckedAt?: string
    /** true when registered name came from NTA invoice search (not OCR/hand) */
    invoiceRegisteredNameVerified?: boolean
    invoiceCorporateNumber?: string
    invoiceAddress?: string
    invoiceRegistrationStatus?: string
    invoiceRegistrationDate?: string
    invoiceTradeName?: string
    invoiceLookupMethod?: string
    taxCategory?: TaxCategory
    invoiceStatus?: InvoiceStatus
    /** OCR・画面プレビュー用画像 URL（後方互換） */
    receiptImageUrl?: string
    /** OCR・画面プレビュー用 Storage パス（後方互換） */
    receiptStoragePath?: string
    /** 利用者がアップロードした証憑原本 URL（PDF 含む） */
    receiptFileUrl?: string
    receiptFileStoragePath?: string
    receiptFileName?: string
    receiptFileMimeType?: string
    /** OCR・画面プレビュー用画像 */
    receiptPreviewImageUrl?: string
    receiptPreviewStoragePath?: string
    receiptId?: string
    /** 未整理領収書ワークフロー状態（フォーム読み込み時） */
    receiptStatus?: AccountingReceiptWorkflowStatus
    /** 領収書画像の SHA-256 ハッシュ（二重計上検知用） */
    imageHash?: string
    lineItems?: AccountingExpenseLineItemDraft[]
    confirmationStatus: ExpenseConfirmationStatus
    memo?: string
    createdBy: string
    createdByName: string
    updatedBy: string
    updatedByName: string
    /** 論理削除フラグ（confirmed 済み経費の削除用）。物理削除は禁止。 */
    isDeleted?: boolean
    deletedAt?: string
    deletedBy?: string
    deleteReason?: string
    /** 10万円以上等で通常経費登録を選択した理由 */
    normalExpenseOverrideReason?: string
    /** 固定資産候補を通常経費のまま登録する確認済みフラグ */
    normalExpenseOverrideConfirmed?: boolean
  }

export type StoredAccountingExpense = AccountingExpenseInput & {
  id: string
  createdAt?: string
  updatedAt?: string
}

export type AccountingAdjustmentType = 'sales' | 'expense'

export type AccountingAdjustmentInput = AccountingTenantFields & {
  adjustmentType: AccountingAdjustmentType
  targetYearMonth: string
  salesCategory?: SalesCategory | ''
  expenseCategory?: ExpenseCategory | ''
  amountYen: number
  description: string
  confirmationStatus: ExpenseConfirmationStatus
  createdBy: string
  createdByName: string
  updatedBy: string
  updatedByName: string
}

export type StoredAccountingAdjustment = AccountingAdjustmentInput & {
  id: string
  createdAt?: string
  updatedAt?: string
}

export type AccountingReceiptCandidateFields = {
  memo?: string
  receiptDate?: string
  vendorNameCandidate?: string
  invoiceNumberCandidate?: string
  invoiceRegisteredNameCandidate?: string
  amountTotalCandidate?: number
  taxAmountCandidate?: number
  taxRateCandidate?: number
}

export type AccountingReceiptDocumentType = 'image' | 'pdf'

export type AccountingReceiptInput = AccountingTenantFields &
  AccountingReceiptCandidateFields &
  AccountingOcrData & {
    storagePath: string
    downloadUrl: string
    /** alias for downloadUrl — used by mobile→PC workflows */
    imageUrl?: string
    mimeType: string
    fileName: string
    fileSizeBytes: number
    /** 領収書画像の SHA-256 ハッシュ（二重計上検知用）。PDF の場合は原本のハッシュ */
    imageHash?: string
    documentType?: AccountingReceiptDocumentType
    /** 利用者がアップロードした証憑原本 */
    originalStoragePath?: string
    originalDownloadUrl?: string
    originalFileName?: string
    originalMimeType?: string
    originalFileSizeBytes?: number
    /** OCR・画面プレビューに使う画像 */
    ocrImageStoragePath?: string
    ocrImageDownloadUrl?: string
    ocrImageFileName?: string
    ocrImageMimeType?: string
    ocrImageSizeBytes?: number
    /** PDF の場合の総ページ数 */
    pdfPageCount?: number
    status: ReceiptStatus
    /** ワークフロー状態 draft / ocr_ready / confirmed / rejected */
    receiptStatus?: AccountingReceiptWorkflowStatus
    confirmed?: AccountingReceiptConfirmedFields
    editHistory?: AccountingReceiptEditHistoryEntry[]
    sourceDevice?: AccountingSourceDevice
    createdBy?: string
    updatedBy?: string
    linkedExpenseId?: string
    uploadedBy: string
    uploadedByName: string
  }

export type StoredAccountingReceipt = AccountingReceiptInput & {
  id: string
  createdAt?: string
  updatedAt?: string
  invalidatedAt?: string
}

export type {
  AccountingExportType,
  AccountingExportFileManifestItem,
  AccountingExportReadinessSnapshot,
  AccountingExportFiscalPeriodSnapshot,
  AccountingExportSourceRecordCounts,
  AccountingExportInput,
  StoredAccountingExport,
  AccountingExportPackageRecordPayload,
} from './accountingExportHistory'

export {
  ACCOUNTING_EXPORT_SCHEMA_VERSION,
  formatAccountingExportTypeLabel,
} from './accountingExportHistory'

export type AccountingFixedCostInput = AccountingTenantFields & {
  name: string
  expenseCategory: ExpenseCategory
  amountMode: FixedCostAmountMode
  monthlyAmountYen: number
  annualAmountYen: number
  startYearMonth: string
  /** @deprecated cancelYearMonth を優先。後方互換のため残存 */
  endYearMonth?: string
  cancelYearMonth?: string
  status: FixedCostStatus
  memo?: string
  confirmationStatus: ExpenseConfirmationStatus
  sourceType: 'fixedCost'
  createdBy?: string
  updatedBy?: string
}

export type StoredAccountingFixedCost = AccountingFixedCostInput & {
  id: string
  createdAt?: string
  updatedAt?: string
  cancelledAt?: string
}

export type AccountingSalesEntryInput = AccountingTenantFields & {
  sourceCaseRecordId?: string
  targetYearMonth: string
  salesCategory: SalesCategory
  amountYen: number
  description: string
  isManualEntry: boolean
}

export type StoredAccountingSalesEntry = AccountingSalesEntryInput & {
  id: string
  createdAt?: string
}

export type SalesCategoryBreakdown = Record<SalesCategory, number>

export type ExpenseCategoryBreakdown = Record<ExpenseCategory, number>

export type MonthlyProfitLoss = {
  targetYearMonth: string
  sales: SalesCategoryBreakdown
  salesTotalYen: number
  /** 売上原価（category: costOfSales） */
  costOfSales: ExpenseCategoryBreakdown
  costOfSalesTotalYen: number
  /** 粗利益 = 売上合計 − 売上原価小計 */
  grossProfitYen: number
  /** 固定費（category: fixedExpense。固定費マスタ＋経費入力） */
  fixedCosts: ExpenseCategoryBreakdown
  fixedCostsTotalYen: number
  fixedCostCount: number
  /** 変動費（category: variableExpense） */
  variableExpenses: ExpenseCategoryBreakdown
  variableExpensesTotalYen: number
  /** @deprecated 互換用。変動費＋固定費＋売上原価の合算 */
  expenses: ExpenseCategoryBreakdown
  expensesTotalYen: number
  deferredCandidate: ExpenseCategoryBreakdown
  deferredCandidateTotalYen: number
  deferredCandidateCount: number
  /** 営業利益（純利益）= 粗利益 − 固定費小計 − 変動費小計 */
  operatingProfitYen: number
  caseRecordCount: number
  confirmedExpenseCount: number
}

/** 年次PL（前々期・前期・月別・年間合計） */
export type YearlyProfitLossColumnKey =
  | 'twoYearsAgo'
  | 'previousYear'
  | 'm01'
  | 'm02'
  | 'm03'
  | 'm04'
  | 'm05'
  | 'm06'
  | 'm07'
  | 'm08'
  | 'm09'
  | 'm10'
  | 'm11'
  | 'm12'
  | 'yearTotal'

export type YearlyProfitLoss = {
  /** 対象カレンダー年（1〜12月） */
  targetYear: number
  columns: Record<YearlyProfitLossColumnKey, MonthlyProfitLoss>
  columnLabels: Record<YearlyProfitLossColumnKey, string>
}

export const normalizeReceiptStatus = (value: unknown, linkedExpenseId?: string): ReceiptStatus => {
  if (value === 'linked' || value === 'confirmed') {
    return linkedExpenseId || value === 'linked' ? 'linked' : 'unorganized'
  }
  if (value === 'invalid' || value === 'invalidated' || value === 'rejected') {
    return 'invalid'
  }
  if (value === 'unorganized' || value === 'draft' || value === 'ocr_ready') {
    return 'unorganized'
  }
  // 旧 status: active は linkedExpenseId の有無で解釈
  if (value === 'active') {
    return linkedExpenseId ? 'linked' : 'unorganized'
  }
  return linkedExpenseId ? 'linked' : 'unorganized'
}

export const mapLegacyStatusToWorkflow = (
  status: ReceiptStatus,
  hasOcr: boolean,
  linkedExpenseId?: string,
): AccountingReceiptWorkflowStatus => {
  if (status === 'invalid') {
    return 'rejected'
  }
  if (status === 'linked' || linkedExpenseId) {
    return 'confirmed'
  }
  if (hasOcr) {
    return 'ocr_ready'
  }
  return 'draft'
}

export const normalizePlTreatment = (value: unknown): PlTreatment => {
  if (value === 'excluded' || value === 'deferredCandidate') {
    return value
  }

  return 'expense'
}

export const getPlTreatmentLabel = (treatment: PlTreatment | undefined) =>
  PL_TREATMENT_LABELS[normalizePlTreatment(treatment)]

export const getExpensePostingDate = (
  expense: Pick<AccountingExpenseInput, 'postingDate' | 'transactionDate'>,
) => expense.postingDate || expense.transactionDate

export const getExpenseReceiptDate = (
  expense: Pick<AccountingExpenseInput, 'receiptDate' | 'postingDate' | 'transactionDate'>,
) => expense.receiptDate || getExpensePostingDate(expense)

export const normalizeExpenseInputForSave = (input: AccountingExpenseInput): AccountingExpenseInput => {
  const postingDate = getExpensePostingDate(input)
  const receiptDate = input.receiptDate || postingDate
  const expenseCategory = normalizeExpenseCategory(input.expenseCategory)
  const taxFields = deriveTaxFields({
    taxIncludedAmount: input.taxIncludedAmount,
    taxRate: input.taxRate,
    taxAmount: input.taxAmount ?? input.consumptionTaxAmount,
    taxCalculationMode: input.taxCalculationMode,
  })

  return {
    ...input,
    receiptDate,
    postingDate,
    transactionDate: postingDate,
    expenseCategory,
    taxRate: taxFields.taxRate,
    taxAmount: taxFields.taxAmount,
    consumptionTaxAmount: taxFields.consumptionTaxAmount,
    taxExcludedAmount: taxFields.taxExcludedAmount,
    taxCalculationMode: taxFields.taxCalculationMode,
    plTreatment: normalizePlTreatment(input.plTreatment),
  }
}

export const normalizeExpensePatchForSave = (
  input: Partial<AccountingExpenseInput>,
): Partial<AccountingExpenseInput> => {
  const patch = { ...input }

  if (input.plTreatment !== undefined) {
    patch.plTreatment = normalizePlTreatment(input.plTreatment)
  }

  if (input.expenseCategory !== undefined) {
    patch.expenseCategory = normalizeExpenseCategory(input.expenseCategory)
  }

  if (
    input.taxRate !== undefined ||
    input.taxAmount !== undefined ||
    input.consumptionTaxAmount !== undefined ||
    input.taxIncludedAmount !== undefined ||
    input.taxCalculationMode !== undefined
  ) {
    const taxIncludedAmount = input.taxIncludedAmount ?? 0
    const taxFields = deriveTaxFields({
      taxIncludedAmount,
      taxRate: input.taxRate,
      taxAmount: input.taxAmount ?? input.consumptionTaxAmount,
      taxCalculationMode: input.taxCalculationMode,
    })
    if (input.taxRate !== undefined || Object.prototype.hasOwnProperty.call(input, 'taxRate')) {
      patch.taxRate = normalizeTaxRate(input.taxRate)
    }
    if (input.taxCalculationMode !== undefined) {
      patch.taxCalculationMode = normalizeTaxCalculationMode(input.taxCalculationMode)
    }
    if (
      input.taxAmount !== undefined ||
      input.consumptionTaxAmount !== undefined ||
      input.taxIncludedAmount !== undefined ||
      input.taxCalculationMode !== undefined
    ) {
      patch.taxAmount = taxFields.taxAmount
      patch.consumptionTaxAmount = taxFields.consumptionTaxAmount
      patch.taxExcludedAmount = taxFields.taxExcludedAmount
    }
  }

  const postingDate = input.postingDate ?? input.transactionDate
  if (postingDate !== undefined) {
    patch.postingDate = postingDate
    patch.transactionDate = postingDate
  }

  if (input.receiptDate !== undefined) {
    patch.receiptDate = input.receiptDate
  }

  return patch
}

export const normalizeAdjustmentSalesCategory = (value: unknown): SalesCategory | '' =>
  normalizeSalesCategory(value)

export const normalizeAdjustmentExpenseCategory = (value: unknown): ExpenseCategory | '' =>
  normalizeExpenseCategory(value)

export const canConfirmExpense = (expense: Pick<AccountingExpenseInput, 'expenseCategory' | 'confirmationStatus'>) =>
  expense.confirmationStatus !== '無効' &&
  isExpenseCategorySelected(expense.expenseCategory)

export const isConfirmedForPl = (status: ExpenseConfirmationStatus) => status === '確認済み'

export const isExpenseDeleted = (expense: Pick<StoredAccountingExpense, 'isDeleted'>) =>
  expense.isDeleted === true

/** PL・CSV・集計の対象経費（確認済みかつ未削除） */
export const isExpenseEligibleForReporting = (
  expense: Pick<StoredAccountingExpense, 'confirmationStatus' | 'isDeleted'>,
) => isConfirmedForPl(expense.confirmationStatus) && !isExpenseDeleted(expense)

/** 帳簿日付（postingDate）が対象年月の確認済み・未削除経費 */
export const filterReportingExpensesByPostingYearMonth = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) =>
  expenses.filter(
    (expense) =>
      isExpenseEligibleForReporting(expense) &&
      getExpensePostingDate(expense).startsWith(targetYearMonth),
  )
