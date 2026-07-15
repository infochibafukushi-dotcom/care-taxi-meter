import type { StoredCaseRecord } from '../services/caseRecords'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import type {
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
} from '../types/accounting'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type {
  TaxAdvisorDepreciationRow,
  TaxAdvisorFixedCostRow,
  TaxAdvisorHeader,
  TaxAdvisorPackage,
  TaxAdvisorReviewItem,
  TaxAdvisorSectionId,
} from '../types/accountingTaxAdvisor'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'
import type { Company } from '../types/work'
import type { MeterSettings } from '../services/meterSettings'
import {
  getExpensePostingDate,
  isExpenseEligibleForReporting,
  normalizePlTreatment,
} from '../types/accounting'
import { FIXED_ASSET_STATUS_LABELS } from '../types/accountingFixedAssets'
import { detectFixedAssetRegistrationWarning } from '../utils/accountingAssetDetection'
import {
  buildETaxPackage,
  getFiscalYearMonths,
} from '../utils/accountingETaxData'
import { isFixedCostActiveForMonth } from '../utils/accountingFixedCost'
import {
  calculateCumulativeDepreciationYen,
  calculateRemainingBookValue,
  getDepreciationAmountForMonth,
} from '../utils/accountingDepreciation'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from './accountingFiscalPeriod'

const PURPOSE_TEXT =
  '税理士相談・申告前確認のための経理根拠資料一式（e-Tax転記用資料とは別用途）'

const formatCreatedDateInJapan = () => {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

const isExpenseInFiscalYear = (expense: StoredAccountingExpense, targetYear: number) => {
  const month = getExpensePostingDate(expense).slice(0, 7)
  return getFiscalYearMonths(targetYear).includes(month)
}

const isReceiptInFiscalYear = (receipt: StoredAccountingReceipt, targetYear: number) => {
  const date = receipt.receiptDate || receipt.createdAt || ''
  const month = date.slice(0, 7)
  return month ? getFiscalYearMonths(targetYear).includes(month) : false
}

const buildFixedCostRows = (
  fixedCosts: StoredAccountingFixedCost[],
  targetYear: number,
): TaxAdvisorFixedCostRow[] => {
  const fiscalMonths = getFiscalYearMonths(targetYear)
  const rows: TaxAdvisorFixedCostRow[] = []

  fixedCosts.forEach((cost) => {
    const activeMonths = fiscalMonths.filter((month) => isFixedCostActiveForMonth(cost, month))
    if (activeMonths.length === 0) {
      return
    }

    const cancelYearMonth = cost.cancelYearMonth ?? cost.endYearMonth
    rows.push({
      fixedCostName: cost.name,
      expenseCategory: cost.expenseCategory,
      monthlyAmountYen: cost.monthlyAmountYen,
      fiscalYearTotalYen: activeMonths.length * cost.monthlyAmountYen,
      startYearMonth: cost.startYearMonth,
      endYearMonth: cancelYearMonth || '継続中',
      status: cost.confirmationStatus === '無効' ? '無効' : cost.status === 'cancelled' ? '解約済' : '有効',
    })
  })

  return rows.sort((left, right) => left.fixedCostName.localeCompare(right.fixedCostName, 'ja'))
}

const buildDepreciationRows = (
  ledgerAssets: StoredAccountingFixedAsset[],
  targetYear: number,
): TaxAdvisorDepreciationRow[] =>
  getFiscalYearMonths(targetYear).flatMap((targetYearMonth) =>
    ledgerAssets
      .map((asset) => {
        const depreciationYen = getDepreciationAmountForMonth(asset, targetYearMonth)
        if (depreciationYen <= 0) {
          return null
        }

        return {
          targetYearMonth,
          assetName: asset.assetName,
          assetCategory: asset.assetCategory,
          acquisitionCost: asset.acquisitionCost,
          monthlyDepreciationYen: asset.monthlyDepreciationYen,
          depreciationYen,
          cumulativeDepreciationYen: calculateCumulativeDepreciationYen(asset, targetYearMonth),
          remainingBookValue: calculateRemainingBookValue(asset, targetYearMonth),
          plExpenseCategory: '減価償却費',
        }
      })
      .filter((row): row is TaxAdvisorDepreciationRow => row !== null),
  )

export const buildTaxAdvisorReviewItems = ({
  fiscalYearExpenses,
  unorganizedReceipts,
  fixedAssets,
  etaxActionRequiredCount,
  etaxReviewCount,
  consumptionTaxPlannedCount,
}: {
  fiscalYearExpenses: StoredAccountingExpense[]
  unorganizedReceipts: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  etaxActionRequiredCount: number
  etaxReviewCount: number
  consumptionTaxPlannedCount: number
}): TaxAdvisorReviewItem[] => {
  const items: TaxAdvisorReviewItem[] = []

  if (unorganizedReceipts.length > 0) {
    items.push({
      id: 'review.unorganized-receipts',
      category: '領収書',
      label: '未整理領収書が残っています',
      detail: `${unorganizedReceipts.length}件`,
    })
  }

  const expensesWithoutImage = fiscalYearExpenses.filter((expense) => !expense.receiptImageUrl?.trim())
  if (expensesWithoutImage.length > 0) {
    items.push({
      id: 'review.expense-no-receipt-image',
      category: '経費',
      label: '領収書画像がない経費があります',
      detail: `${expensesWithoutImage.length}件`,
    })
  }

  const missingInvoice = fiscalYearExpenses.filter((expense) => !expense.invoiceNumber?.trim())
  if (missingInvoice.length > 0) {
    items.push({
      id: 'review.missing-invoice',
      category: '経費',
      label: 'インボイス番号が未入力の経費があります',
      detail: `${missingInvoice.length}件`,
    })
  }

  const missingTaxRate = fiscalYearExpenses.filter((expense) => expense.taxRate == null)
  if (missingTaxRate.length > 0) {
    items.push({
      id: 'review.missing-tax-rate',
      category: '経費',
      label: '消費税率が未設定の経費があります',
      detail: `${missingTaxRate.length}件`,
    })
  }

  const fixedAssetCandidates = fiscalYearExpenses.filter((expense) => {
    const warning = detectFixedAssetRegistrationWarning({
      amountYen: expense.taxIncludedAmount,
      description: expense.description,
      vendorName: expense.vendorName,
    })
    return warning.shouldWarn && normalizePlTreatment(expense.plTreatment) === 'expense'
  })
  if (fixedAssetCandidates.length > 0) {
    items.push({
      id: 'review.fixed-asset-candidate',
      category: '経費',
      label: '固定資産候補が通常経費で登録されています',
      detail: `${fixedAssetCandidates.length}件`,
    })
  }

  const manualUsefulLife = fixedAssets.filter(
    (asset) =>
      asset.assetKind === 'fixed' &&
      !asset.isDeleted &&
      asset.appliedUsefulLifeYears !== asset.standardUsefulLifeYears,
  )
  if (manualUsefulLife.length > 0) {
    items.push({
      id: 'review.manual-useful-life',
      category: '固定資産',
      label: '固定資産の耐用年数が手動変更されています',
      detail: `${manualUsefulLife.length}件`,
    })
  }

  if (etaxReviewCount > 0) {
    items.push({
      id: 'review.etax-balance-mismatch',
      category: '決算補助データ',
      label: '預金残高と預金内訳合計が一致していません、または借入金残高と借入金内訳合計が一致していません',
      detail: `${etaxReviewCount}件の要確認`,
    })
  }

  if (etaxActionRequiredCount > 0) {
    items.push({
      id: 'review.etax-unset',
      category: 'e-Tax入力用資料',
      label: 'e-Tax入力用資料に未設定項目があります',
      detail: `${etaxActionRequiredCount}件`,
    })
  }

  if (consumptionTaxPlannedCount > 0) {
    items.push({
      id: 'review.consumption-tax-planned',
      category: '消費税',
      label: '消費税集計に今後対応予定項目があります',
      detail: `${consumptionTaxPlannedCount}件`,
    })
  }

  return items
}

const DATA_SOURCE_MAP: Record<TaxAdvisorSectionId, string[]> = {
  'pdf-bulk': ['各資料セクションの集計結果'],
  'csv-bulk': ['各資料セクションの集計結果'],
  'print-preview': ['各資料セクションの集計結果'],
  summary: ['caseRecords', 'accountingExpenses', 'accountingFixedCosts', 'accountingFixedAssets', 'accountingSettlementAuxiliary'],
  pl: ['caseRecords（売上）', 'accountingExpenses（経費）', 'accountingFixedCosts（固定費）', 'accountingFixedAssets（減価償却費）'],
  bs: ['accountingSettlementAuxiliary（期末残高）', 'accountingFixedAssets（固定資産）'],
  expenses: ['accountingExpenses（確認済み・未削除）'],
  receipts: ['accountingReceipts', 'Storage画像有無'],
  'unorganized-receipts': ['accountingReceipts（未整理）', 'Storage画像有無'],
  'fixed-costs': ['accountingFixedCosts'],
  'fixed-assets': ['accountingFixedAssets'],
  depreciation: ['accountingFixedAssets', '減価償却計算'],
  'small-assets': ['accountingFixedAssets（少額資産）'],
  'account-breakdown': ['accountingSettlementAuxiliary', 'accountingFixedAssets'],
  'business-overview': ['companies', 'accountingExpenses', 'accountingSettlementAuxiliary'],
  'consumption-tax': ['accountingExpenses', 'accountingTax'],
  'input-status': ['accountingSettlementAuxiliary'],
  'review-list': ['accountingExpenses', 'accountingReceipts', 'accountingFixedAssets', 'accountingSettlementAuxiliary', 'accountingETaxData'],
}

export const getTaxAdvisorDataSources = (sectionId: TaxAdvisorSectionId): string[] =>
  DATA_SOURCE_MAP[sectionId] ?? []

export const buildTaxAdvisorPackage = ({
  targetYear,
  storeName,
  company,
  meterSettings,
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  auxiliary,
  allReceipts,
  unorganizedReceipts,
}: {
  targetYear: number
  storeName: string
  company: Company | null
  meterSettings: MeterSettings | null
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  auxiliary: AccountingSettlementAuxiliaryInput | null
  allReceipts: StoredAccountingReceipt[]
  unorganizedReceipts: StoredAccountingReceipt[]
}): TaxAdvisorPackage => {
  const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, targetYear)
  const fiscalYearEndYearMonth = period?.endYearMonth ?? ''
  const etax = buildETaxPackage({
    targetYear,
    targetYearMonth: fiscalYearEndYearMonth || '',
    company,
    meterSettings,
    caseRecords,
    expenses,
    adjustments,
    fixedCosts,
    fixedAssets,
    auxiliary,
  })

  const fiscalYearExpenses = expenses.filter(
    (expense) => isExpenseEligibleForReporting(expense) && isExpenseInFiscalYear(expense, targetYear),
  )
  const fiscalYearReceipts = allReceipts.filter((receipt) => isReceiptInFiscalYear(receipt, targetYear))

  const ledgerAssets = fixedAssets
    .filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
    .map((asset) => ({
      ...asset,
      remainingBookValue: fiscalYearEndYearMonth
        ? calculateRemainingBookValue(asset, fiscalYearEndYearMonth)
        : asset.acquisitionCost,
      status: asset.status,
    }))

  const smallAssets = fixedAssets.filter((asset) => asset.assetKind === 'small' && !asset.isDeleted)

  const header: TaxAdvisorHeader = {
    targetYear,
    fiscalYearLabel: period?.label ?? '会社設立前の年度です',
    companyName: etax.company.companyName,
    storeName: storeName || '未設定',
    createdDate: formatCreatedDateInJapan(),
    purpose: PURPOSE_TEXT,
  }

  const reviewItems = buildTaxAdvisorReviewItems({
    fiscalYearExpenses,
    unorganizedReceipts,
    fixedAssets,
    etaxActionRequiredCount: etax.actionRequiredItems.filter((item) => item.status === 'required').length,
    etaxReviewCount: etax.checkItems.filter((item) => item.status === 'review').length,
    consumptionTaxPlannedCount: etax.consumptionTax.filter((line) => line.status === 'planned').length,
  })

  const dataSources = (Object.keys(DATA_SOURCE_MAP) as TaxAdvisorSectionId[]).map((sectionId) => ({
    sectionId,
    sources: DATA_SOURCE_MAP[sectionId],
  }))

  return {
    header,
    etax,
    fiscalYearExpenses,
    fiscalYearReceipts,
    unorganizedReceipts,
    fixedCostRows: buildFixedCostRows(fixedCosts, targetYear),
    ledgerAssets,
    smallAssets,
    depreciationRows: buildDepreciationRows(ledgerAssets, targetYear),
    reviewItems,
    dataSources,
    fiscalYearEndYearMonth,
    pl: etax.pl,
  }
}

export const formatLedgerAssetStatus = (status: StoredAccountingFixedAsset['status']) =>
  FIXED_ASSET_STATUS_LABELS[status]
