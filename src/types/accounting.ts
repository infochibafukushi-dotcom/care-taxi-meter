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

export const SALES_CATEGORIES = [
  '運賃',
  '介助',
  '機材レンタル',
  'ストック',
  'その他',
] as const

export type SalesCategory = (typeof SALES_CATEGORIES)[number]

export const EXPENSE_CATEGORIES = [
  '燃料費',
  '車両費',
  '高速・駐車場',
  '通信費',
  'システム費',
  '保険料',
  'リース料',
  '消耗品費',
  '水道光熱費',
  '地代家賃',
  '介護用品費',
  '広告宣伝費',
  '接待交際費',
  '旅費交通費',
  '租税公課',
  '支払手数料',
  '開業前立替金・繰延資産候補',
  '開業費償却',
  '創立費償却',
  '研修費',
  'その他経費',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** 固定費登録フォーム用の科目候補（表示ラベルは既存勘定科目と整合） */
export const FIXED_COST_CATEGORY_OPTIONS: ReadonlyArray<{ value: ExpenseCategory; label: string }> = [
  { value: '燃料費', label: '燃料費' },
  { value: '車両費', label: '車両費' },
  { value: '保険料', label: '保険料' },
  { value: '通信費', label: '通信費' },
  { value: '水道光熱費', label: '水道光熱費' },
  { value: '地代家賃', label: '地代家賃' },
  { value: '高速・駐車場', label: '駐車場代' },
  { value: '消耗品費', label: '消耗品費' },
  { value: '介護用品費', label: '介護用品費' },
  { value: '広告宣伝費', label: '広告宣伝費' },
  { value: '支払手数料', label: '支払手数料' },
  { value: '研修費', label: '研修費' },
  { value: '租税公課', label: '租税公課' },
  { value: '旅費交通費', label: '旅費交通費' },
  { value: 'システム費', label: 'システム利用料' },
  { value: 'その他経費', label: '雑費' },
]

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
    taxRate: number
    consumptionTaxAmount: number
    paymentMethod: AccountingPaymentMethod | ''
    invoiceNumber?: string
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
    receiptImageUrl?: string
    receiptStoragePath?: string
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
    /** 領収書画像の SHA-256 ハッシュ（二重計上検知用） */
    imageHash?: string
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

export type AccountingExportInput = AccountingTenantFields & {
  exportType: 'monthly-pl' | 'expenses' | 'sales'
  targetYearMonth: string
  fileName: string
  rowCount: number
  createdBy: string
  createdByName: string
}

export type StoredAccountingExport = AccountingExportInput & {
  id: string
  createdAt?: string
}

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
  /** 変動費・通常経費（レシート経費＋調整） */
  variableExpenses: ExpenseCategoryBreakdown
  variableExpensesTotalYen: number
  /** 固定費（sourceType: fixedCost） */
  fixedCosts: ExpenseCategoryBreakdown
  fixedCostsTotalYen: number
  fixedCostCount: number
  /** 変動費＋固定費の合算（営業利益計算用） */
  expenses: ExpenseCategoryBreakdown
  expensesTotalYen: number
  deferredCandidate: ExpenseCategoryBreakdown
  deferredCandidateTotalYen: number
  deferredCandidateCount: number
  operatingProfitYen: number
  caseRecordCount: number
  confirmedExpenseCount: number
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

  return {
    ...input,
    receiptDate,
    postingDate,
    transactionDate: postingDate,
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

export const isExpenseCategorySelected = (
  category: ExpenseCategory | '' | undefined,
): category is ExpenseCategory => Boolean(category && EXPENSE_CATEGORIES.includes(category as ExpenseCategory))

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
