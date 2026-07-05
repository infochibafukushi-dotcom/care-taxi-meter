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
  '広告宣伝費',
  '接待交際費',
  '旅費交通費',
  '租税公課',
  '支払手数料',
  'その他経費',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CONFIRMATION_STATUSES = ['未確認', '確認済み', '無効'] as const

export type ExpenseConfirmationStatus = (typeof EXPENSE_CONFIRMATION_STATUSES)[number]

export const PAYMENT_METHODS = ['現金', 'クレジットカード', '銀行振込', '電子マネー', 'その他'] as const

export type AccountingPaymentMethod = (typeof PAYMENT_METHODS)[number]

export const RECEIPT_STATUSES = ['active', 'invalidated'] as const

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number]

export type OcrParsedFields = {
  transactionDate?: string
  vendorName?: string
  description?: string
  taxIncludedAmount?: number
  taxRate?: number
  consumptionTaxAmount?: number
  invoiceNumber?: string
}

export type AccountingOcrData = {
  ocrRawText?: string
  ocrParsedFields?: OcrParsedFields
  ocrConfidence?: number
  suggestedExpenseCategory?: ExpenseCategory | ''
}

export type AccountingTenantFields = {
  franchiseeId: string
  companyId: string
  storeId: string
}

export type AccountingExpenseInput = AccountingTenantFields &
  AccountingOcrData & {
    transactionDate: string
    vendorName: string
    description: string
    expenseCategory: ExpenseCategory | ''
    taxIncludedAmount: number
    taxRate: number
    consumptionTaxAmount: number
    paymentMethod: AccountingPaymentMethod | ''
    invoiceNumber?: string
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

export type AccountingReceiptInput = AccountingTenantFields & {
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
  monthlyAmountYen: number
  startYearMonth: string
  endYearMonth?: string
  memo?: string
  confirmationStatus: ExpenseConfirmationStatus
}

export type StoredAccountingFixedCost = AccountingFixedCostInput & {
  id: string
  createdAt?: string
  updatedAt?: string
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
  expenses: ExpenseCategoryBreakdown
  expensesTotalYen: number
  operatingProfitYen: number
  caseRecordCount: number
  confirmedExpenseCount: number
}

export const isExpenseCategorySelected = (
  category: ExpenseCategory | '' | undefined,
): category is ExpenseCategory => Boolean(category && EXPENSE_CATEGORIES.includes(category as ExpenseCategory))

export const canConfirmExpense = (expense: Pick<AccountingExpenseInput, 'expenseCategory' | 'confirmationStatus'>) =>
  expense.confirmationStatus !== '無効' &&
  isExpenseCategorySelected(expense.expenseCategory)

export const isConfirmedForPl = (status: ExpenseConfirmationStatus) => status === '確認済み'
