import type { ETaxPackage } from './accountingETax'
import type { ExpenseCategory, MonthlyProfitLoss, StoredAccountingExpense } from './accounting'
import type { StoredAccountingFixedAsset } from './accountingFixedAssets'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'

export type TaxAdvisorSectionId =
  | 'pdf-bulk'
  | 'csv-bulk'
  | 'print-preview'
  | 'summary'
  | 'pl'
  | 'bs'
  | 'expenses'
  | 'receipts'
  | 'unorganized-receipts'
  | 'fixed-costs'
  | 'fixed-assets'
  | 'depreciation'
  | 'small-assets'
  | 'account-breakdown'
  | 'business-overview'
  | 'consumption-tax'
  | 'input-status'
  | 'review-list'
  | 'filing-check'

export type TaxAdvisorHeader = {
  targetYear: number
  fiscalYearLabel: string
  companyName: string
  storeName: string
  createdDate: string
  purpose: string
}

export type TaxAdvisorReviewItem = {
  id: string
  category: string
  label: string
  detail?: string
}

export type TaxAdvisorDepreciationRow = {
  targetYearMonth: string
  assetName: string
  assetCategory: string
  acquisitionCost: number
  monthlyDepreciationYen: number
  depreciationYen: number
  cumulativeDepreciationYen: number
  remainingBookValue: number
  plExpenseCategory: string
}

export type TaxAdvisorFixedCostRow = {
  fixedCostName: string
  expenseCategory: ExpenseCategory
  monthlyAmountYen: number
  fiscalYearTotalYen: number
  startYearMonth: string
  endYearMonth: string
  status: string
}

export type TaxAdvisorDataSource = {
  sectionId: TaxAdvisorSectionId
  sources: string[]
}

export type TaxAdvisorPackage = {
  header: TaxAdvisorHeader
  etax: ETaxPackage
  fiscalYearExpenses: StoredAccountingExpense[]
  fiscalYearReceipts: StoredAccountingReceipt[]
  unorganizedReceipts: StoredAccountingReceipt[]
  fixedCostRows: TaxAdvisorFixedCostRow[]
  ledgerAssets: StoredAccountingFixedAsset[]
  smallAssets: StoredAccountingFixedAsset[]
  depreciationRows: TaxAdvisorDepreciationRow[]
  reviewItems: TaxAdvisorReviewItem[]
  dataSources: TaxAdvisorDataSource[]
  fiscalYearEndYearMonth: string
  pl: MonthlyProfitLoss
}
