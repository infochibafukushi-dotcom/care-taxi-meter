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

export const PAYMENT_METHODS = ['現金', 'クレジットカード', '銀行振込', '電子マネー', '役員立替', 'その他'] as const

export const PL_TREATMENTS = ['expense', 'excluded', 'deferredCandidate'] as const

export type PlTreatment = (typeof PL_TREATMENTS)[number]

export const PL_TREATMENT_LABELS: Record<PlTreatment, string> = {
  expense: 'PL反映する',
  excluded: 'PL反映しない',
  deferredCandidate: '繰延資産候補',
}

export type AccountingPaymentMethod = (typeof PAYMENT_METHODS)[number]

export const INVOICE_CHECK_STATUSES = ['未確認', '登録あり', '登録なし', '対象外'] as const

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
}

export type AccountingOcrData = {
  ocrRawText?: string
  ocrParsedFields?: OcrParsedFields
  ocrConfidence?: number
  ocrProcessedAt?: string
  suggestedExpenseCategory?: ExpenseCategory | ''
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
    receiptImageUrl?: string
    receiptStoragePath?: string
    receiptId?: string
    confirmationStatus: ExpenseConfirmationStatus
    memo?: string
    createdBy: string
    createdByName: string
    updatedBy: string
    updatedByName: string
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
    mimeType: string
    fileName: string
    fileSizeBytes: number
    status: ReceiptStatus
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
  if (value === 'linked') {
    return 'linked'
  }
  if (value === 'invalid' || value === 'invalidated') {
    return 'invalid'
  }
  if (value === 'unorganized') {
    return 'unorganized'
  }
  // 旧 status: active は linkedExpenseId の有無で解釈
  if (value === 'active') {
    return linkedExpenseId ? 'linked' : 'unorganized'
  }
  return linkedExpenseId ? 'linked' : 'unorganized'
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
