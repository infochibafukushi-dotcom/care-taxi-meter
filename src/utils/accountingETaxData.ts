import type { StoredCaseRecord } from '../services/caseRecords'
import type {
  MonthlyProfitLoss,
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
} from '../types/accounting'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type {
  ETaxCompanyProfile,
  ETaxFixedAssetRow,
  ETaxPackage,
  ETaxReportLine,
  ETaxSmallAssetRow,
} from '../types/accountingETax'
import {
  calculateCumulativeDepreciationYen,
  calculateRemainingBookValue,
} from './accountingDepreciation'
import { getExpensePostingDate, isExpenseEligibleForReporting } from '../types/accounting'
import { calculateMonthlyProfitLoss, formatFiscalYearLabelForCalendarYear } from './accountingPl'
import { corporateNumberFromInvoiceNumber } from '../services/invoiceRegistrantLookup'
import type { Company } from '../types/work'
import type { MeterSettings } from '../services/meterSettings'

const UNSET = '未設定'
const PLANNED = '今後対応予定'

const line = (
  mappingId: string,
  label: string,
  amountYen: number | null | undefined,
  status: ETaxReportLine['status'] = amountYen != null && amountYen !== 0 ? 'set' : 'unset',
): ETaxReportLine => ({
  mappingId,
  label,
  amountYen: amountYen ?? null,
  displayValue:
    status === 'unset'
      ? UNSET
      : status === 'planned'
        ? PLANNED
        : typeof amountYen === 'number'
          ? String(amountYen)
          : UNSET,
  status,
})

const plannedLine = (mappingId: string, label: string): ETaxReportLine => ({
  mappingId,
  label,
  displayValue: PLANNED,
  status: 'planned',
})

const unsetLine = (mappingId: string, label: string): ETaxReportLine => ({
  mappingId,
  label,
  displayValue: UNSET,
  status: 'unset',
})

export const getFiscalYearMonths = (calendarYear: number) => {
  const months: string[] = []
  for (let month = 4; month <= 12; month += 1) {
    months.push(`${calendarYear}-${String(month).padStart(2, '0')}`)
  }
  for (let month = 1; month <= 3; month += 1) {
    months.push(`${calendarYear + 1}-${String(month).padStart(2, '0')}`)
  }
  return months
}

const sumProfitLossColumns = (rows: MonthlyProfitLoss[]): MonthlyProfitLoss => {
  if (rows.length === 0) {
    return calculateMonthlyProfitLoss({
      caseRecords: [],
      expenses: [],
      adjustments: [],
      fixedCosts: [],
      fixedAssets: [],
      targetYearMonth: '',
    })
  }

  const [first, ...rest] = rows
  return rest.reduce((accumulator, current) => {
    const sales = { ...accumulator.sales }
    Object.keys(sales).forEach((key) => {
      const category = key as keyof typeof sales
      sales[category] += current.sales[category]
    })

    const mergeBreakdown = (
      left: MonthlyProfitLoss['costOfSales'],
      right: MonthlyProfitLoss['costOfSales'],
    ) => {
      const next = { ...left }
      Object.keys(next).forEach((key) => {
        const category = key as keyof typeof next
        next[category] += right[category]
      })
      return next
    }

    const costOfSales = mergeBreakdown(accumulator.costOfSales, current.costOfSales)
    const fixedCosts = mergeBreakdown(accumulator.fixedCosts, current.fixedCosts)
    const variableExpenses = mergeBreakdown(accumulator.variableExpenses, current.variableExpenses)
    const deferredCandidate = mergeBreakdown(accumulator.deferredCandidate, current.deferredCandidate)
    const expenses = mergeBreakdown(accumulator.expenses, current.expenses)

    const salesTotalYen = accumulator.salesTotalYen + current.salesTotalYen
    const costOfSalesTotalYen = accumulator.costOfSalesTotalYen + current.costOfSalesTotalYen
    const fixedCostsTotalYen = accumulator.fixedCostsTotalYen + current.fixedCostsTotalYen
    const variableExpensesTotalYen = accumulator.variableExpensesTotalYen + current.variableExpensesTotalYen
    const grossProfitYen = salesTotalYen - costOfSalesTotalYen
    const operatingProfitYen = grossProfitYen - fixedCostsTotalYen - variableExpensesTotalYen

    return {
      ...accumulator,
      sales,
      salesTotalYen,
      costOfSales,
      costOfSalesTotalYen,
      grossProfitYen,
      fixedCosts,
      fixedCostsTotalYen,
      variableExpenses,
      variableExpensesTotalYen,
      deferredCandidate,
      expenses,
      expensesTotalYen: accumulator.expensesTotalYen + current.expensesTotalYen,
      deferredCandidateTotalYen: accumulator.deferredCandidateTotalYen + current.deferredCandidateTotalYen,
      operatingProfitYen,
      caseRecordCount: accumulator.caseRecordCount + current.caseRecordCount,
      confirmedExpenseCount: accumulator.confirmedExpenseCount + current.confirmedExpenseCount,
      fixedCostCount: accumulator.fixedCostCount + current.fixedCostCount,
      deferredCandidateCount: accumulator.deferredCandidateCount + current.deferredCandidateCount,
    }
  }, first)
}

export const calculateFiscalYearProfitLoss = ({
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  targetYear,
}: {
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  targetYear: number
}): MonthlyProfitLoss => {
  const months = getFiscalYearMonths(targetYear)
  const monthlyRows = months.map((targetYearMonth) =>
    calculateMonthlyProfitLoss({
      caseRecords,
      expenses,
      adjustments,
      fixedCosts,
      fixedAssets,
      targetYearMonth,
    }),
  )
  const merged = sumProfitLossColumns(monthlyRows)
  return { ...merged, targetYearMonth: `${targetYear}-FY` }
}

export const buildETaxCompanyProfile = ({
  targetYear,
  company,
  meterSettings,
}: {
  targetYear: number
  company: Company | null
  meterSettings: MeterSettings | null
}): ETaxCompanyProfile => {
  const invoiceNumber = meterSettings?.receipt?.invoiceNumber ?? company?.invoiceNumber ?? ''
  const corporateNumber = corporateNumberFromInvoiceNumber(invoiceNumber) || UNSET

  return {
    targetYear,
    fiscalYearLabel: formatFiscalYearLabelForCalendarYear(targetYear),
    companyName:
      company?.corporateName ||
      company?.name ||
      meterSettings?.company?.corporateName ||
      meterSettings?.company?.companyName ||
      UNSET,
    corporateNumber,
    address: company?.address || meterSettings?.company?.address || UNSET,
    representativeName: company?.representativeName || company?.ownerName || UNSET,
  }
}

const isExpenseInFiscalYear = (expense: StoredAccountingExpense, targetYear: number) => {
  const month = getExpensePostingDate(expense).slice(0, 7)
  return getFiscalYearMonths(targetYear).includes(month)
}

export const buildETaxSettlementSummary = (
  pl: MonthlyProfitLoss,
  fiscalYearLabel: string,
  fixedAssets: StoredAccountingFixedAsset[],
  smallAssets: StoredAccountingFixedAsset[],
  targetYear: number,
): ETaxReportLine[] => {
  const depreciationYen = pl.fixedCosts['減価償却費'] ?? 0
  const sgaYen = pl.fixedCostsTotalYen + pl.variableExpensesTotalYen - depreciationYen

  const fiscalMonths = getFiscalYearMonths(targetYear)
  const smallAssetTotal = smallAssets
    .filter((asset) => fiscalMonths.some((month) => asset.purchaseDate.startsWith(month)))
    .reduce((sum, asset) => sum + asset.acquisitionCost, 0)

  const fixedAssetAcquisitionTotal = fixedAssets
    .filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
    .filter((asset) => fiscalMonths.some((month) => asset.purchaseDate.startsWith(month)))
    .reduce((sum, asset) => sum + asset.acquisitionCost, 0)

  return [
    {
      mappingId: 'etax.summary.fiscalYear',
      label: '会計年度',
      displayValue: fiscalYearLabel,
      status: 'set',
    },
    line('etax.summary.sales', '売上高', pl.salesTotalYen),
    line('etax.summary.costOfSales', '売上原価', pl.costOfSalesTotalYen),
    line('etax.summary.grossProfit', '売上総利益', pl.grossProfitYen),
    line('etax.summary.sga', '販売管理費', sgaYen),
    line('etax.summary.operatingProfit', '営業利益', pl.operatingProfitYen),
    plannedLine('etax.summary.nonOperatingIncome', '営業外収益'),
    plannedLine('etax.summary.nonOperatingExpense', '営業外費用'),
    plannedLine('etax.summary.ordinaryProfit', '経常利益'),
    plannedLine('etax.summary.corporateTax', '法人税等'),
    plannedLine('etax.summary.netIncome', '当期純利益'),
    line('etax.summary.depreciation', '減価償却費', depreciationYen),
    line('etax.summary.smallAssets', '少額資産合計', smallAssetTotal),
    line('etax.summary.fixedAssetAcquisition', '固定資産取得額', fixedAssetAcquisitionTotal),
    unsetLine('etax.summary.cash', '現金残高'),
    unsetLine('etax.summary.deposits', '預金残高'),
    unsetLine('etax.summary.borrowings', '借入金残高'),
    unsetLine('etax.summary.capital', '資本金'),
    unsetLine('etax.summary.officerLoan', '役員借入金'),
  ]
}

export const buildETaxBalanceSheet = (
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
): ETaxReportLine[] => {
  const ledgerAssets = fixedAssets.filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
  const grossFixedAssets = ledgerAssets.reduce((sum, asset) => sum + asset.acquisitionCost, 0)
  const accumulatedDepreciation = ledgerAssets.reduce(
    (sum, asset) => sum + (asset.acquisitionCost - calculateRemainingBookValue(asset, asOfYearMonth)),
    0,
  )
  const netFixedAssets = grossFixedAssets - accumulatedDepreciation

  return [
    unsetLine('etax.bs.cash', '現金'),
    unsetLine('etax.bs.deposits', '預金'),
    unsetLine('etax.bs.accountsReceivable', '売掛金'),
    unsetLine('etax.bs.accruedIncome', '未収金'),
    line('etax.bs.fixedAssetsGross', '固定資産（取得価額）', grossFixedAssets || null, grossFixedAssets > 0 ? 'set' : 'unset'),
    line('etax.bs.accumulatedDepreciation', '減価償却累計額', accumulatedDepreciation || null, accumulatedDepreciation > 0 ? 'set' : 'unset'),
    line('etax.bs.fixedAssetsNet', '固定資産（帳簿価額）', netFixedAssets || null, netFixedAssets > 0 ? 'set' : 'unset'),
    unsetLine('etax.bs.borrowings', '借入金'),
    unsetLine('etax.bs.accountsPayable', '未払金'),
    unsetLine('etax.bs.capital', '資本金'),
    plannedLine('etax.bs.retainedEarnings', '利益剰余金'),
  ]
}

export const buildETaxFixedAssetRows = (
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
): ETaxFixedAssetRow[] =>
  fixedAssets
    .filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
    .map((asset) => ({
      mappingId: `etax.fixedAsset.${asset.id}`,
      assetName: asset.assetName,
      assetCategory: asset.assetCategory,
      purchaseDate: asset.purchaseDate,
      acquisitionCost: asset.acquisitionCost,
      usefulLifeYears: asset.appliedUsefulLifeYears,
      depreciationMethod: '定額法',
      monthlyDepreciationYen: asset.monthlyDepreciationYen,
      annualDepreciationYen: asset.monthlyDepreciationYen * 12,
      cumulativeDepreciationYen: calculateCumulativeDepreciationYen(asset, asOfYearMonth),
      remainingBookValue: calculateRemainingBookValue(asset, asOfYearMonth),
    }))

export const buildETaxSmallAssetRows = (fixedAssets: StoredAccountingFixedAsset[]): ETaxSmallAssetRow[] =>
  fixedAssets
    .filter((asset) => asset.assetKind === 'small' && !asset.isDeleted)
    .map((asset) => ({
      mappingId: `etax.smallAsset.${asset.id}`,
      purchaseDate: asset.purchaseDate,
      assetName: asset.assetName,
      acquisitionCost: asset.acquisitionCost,
      treatment: '少額資産（取得月一括費用化）',
      plPostingYearMonth: asset.depreciationStartYearMonth,
      notes: asset.notes ?? '',
    }))

export const buildETaxAccountBreakdown = (): ETaxReportLine[] => [
  unsetLine('etax.account.cash', '現金'),
  unsetLine('etax.account.deposits', '普通預金'),
  unsetLine('etax.account.accountsReceivable', '売掛金'),
  unsetLine('etax.account.accruedIncome', '未収金'),
  unsetLine('etax.account.accountsPayable', '未払金'),
  unsetLine('etax.account.borrowings', '借入金'),
  unsetLine('etax.account.officerLoan', '役員借入金'),
  plannedLine('etax.account.fixedAssets', '固定資産'),
]

const aggregateFiscalExpenseTax = (expenses: StoredAccountingExpense[], targetYear: number) => {
  const totals = {
    taxable8: 0,
    taxable10: 0,
    nonTaxable: 0,
    outOfScope: 0,
  }

  expenses.forEach((expense) => {
    if (!isExpenseEligibleForReporting(expense) || !isExpenseInFiscalYear(expense, targetYear)) {
      return
    }

    const amount = expense.taxIncludedAmount

    if (expense.taxCategory === 'non_taxable') {
      totals.nonTaxable += amount
      return
    }
    if (expense.taxCategory === 'out_of_scope') {
      totals.outOfScope += amount
      return
    }

    const rate = expense.taxRate ?? 10
    if (rate === 8) {
      totals.taxable8 += amount
    } else {
      totals.taxable10 += amount
    }
  })

  return totals
}

export const buildETaxConsumptionTaxSummary = (
  pl: MonthlyProfitLoss,
  expenses: StoredAccountingExpense[],
  targetYear: number,
): ETaxReportLine[] => {
  const expenseTax = aggregateFiscalExpenseTax(expenses, targetYear)

  return [
    line('etax.tax.taxableSales', '課税売上', pl.salesTotalYen),
    plannedLine('etax.tax.nonTaxableSales', '非課税売上'),
    line('etax.tax.rate8', '8%', expenseTax.taxable8 || null, expenseTax.taxable8 > 0 ? 'set' : 'unset'),
    line('etax.tax.rate10', '10%', expenseTax.taxable10 || null, expenseTax.taxable10 > 0 ? 'set' : 'unset'),
    line('etax.tax.outOfScope', '対象外', expenseTax.outOfScope || null, expenseTax.outOfScope > 0 ? 'set' : 'unset'),
    plannedLine('etax.tax.prepaidTax', '仮払消費税'),
    plannedLine('etax.tax.collectedTax', '仮受消費税'),
    plannedLine('etax.tax.difference', '差額'),
  ]
}

export const buildETaxBusinessOverview = (
  company: ETaxCompanyProfile,
  pl: MonthlyProfitLoss,
  expenses: StoredAccountingExpense[],
): ETaxReportLine[] => {
  const vendors = [
    ...new Set(
      expenses
        .filter((expense) => isExpenseEligibleForReporting(expense) && expense.vendorName)
        .map((expense) => expense.vendorName.trim())
        .filter(Boolean),
    ),
  ].slice(0, 5)

  return [
    {
      mappingId: 'etax.overview.companyName',
      label: '会社名',
      displayValue: company.companyName,
      status: 'set',
    },
    {
      mappingId: 'etax.overview.address',
      label: '所在地',
      displayValue: company.address,
      status: 'set',
    },
    {
      mappingId: 'etax.overview.representative',
      label: '代表者',
      displayValue: company.representativeName,
      status: 'set',
    },
    plannedLine('etax.overview.businessDescription', '事業内容'),
    plannedLine('etax.overview.employeeCount', '従業員数'),
    plannedLine('etax.overview.officerCount', '役員数'),
    line('etax.overview.sales', '売上高', pl.salesTotalYen),
    line('etax.overview.operatingProfit', '営業利益', pl.operatingProfitYen),
    {
      mappingId: 'etax.overview.vendors',
      label: '主要仕入先',
      displayValue: vendors.length > 0 ? vendors.join(' / ') : UNSET,
      status: vendors.length > 0 ? 'set' : 'unset',
    },
    plannedLine('etax.overview.customers', '主要取引先'),
    plannedLine('etax.overview.financialInstitutions', '金融機関'),
  ]
}

export const buildETaxPackage = ({
  targetYear,
  targetYearMonth,
  company,
  meterSettings,
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
}: {
  targetYear: number
  targetYearMonth: string
  company: Company | null
  meterSettings: MeterSettings | null
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
}): ETaxPackage => {
  const companyProfile = buildETaxCompanyProfile({ targetYear, company, meterSettings })
  const pl = calculateFiscalYearProfitLoss({
    caseRecords,
    expenses,
    adjustments,
    fixedCosts,
    fixedAssets,
    targetYear,
  })
  const smallAssets = fixedAssets.filter((asset) => asset.assetKind === 'small' && !asset.isDeleted)

  return {
    company: companyProfile,
    summary: buildETaxSettlementSummary(pl, companyProfile.fiscalYearLabel, fixedAssets, smallAssets, targetYear),
    pl,
    balanceSheet: buildETaxBalanceSheet(fixedAssets, targetYearMonth),
    fixedAssets: buildETaxFixedAssetRows(fixedAssets, targetYearMonth),
    smallAssets: buildETaxSmallAssetRows(fixedAssets),
    accountBreakdown: buildETaxAccountBreakdown(),
    businessOverview: buildETaxBusinessOverview(companyProfile, pl, expenses),
    consumptionTax: buildETaxConsumptionTaxSummary(pl, expenses, targetYear),
  }
}
