import type { StoredCaseRecord } from '../services/caseRecords'
import type {
  ExpenseCategoryBreakdown,
  MonthlyProfitLoss,
  SalesCategoryBreakdown,
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
  YearlyProfitLoss,
  YearlyProfitLossColumnKey,
  ExpenseCategory,
} from '../types/accounting'
import {
  EXPENSE_CATEGORIES,
  getAccountPlCategory,
  getExpensePostingDate,
  INVOICE_STATUS_LABELS,
  isConfirmedForPl,
  isExpenseCategorySelected,
  isExpenseEligibleForReporting,
  normalizeExpenseCategory,
  normalizePlTreatment,
  normalizeSalesCategory,
  SALES_CATEGORIES,
  TAX_CATEGORY_LABELS,
  type InvoiceStatus,
  type TaxCategory,
} from '../types/accounting'
import { isFixedCostActiveForMonth } from './accountingFixedCost'
import {
  aggregateSalesBreakdown,
  filterCaseRecordsByYearMonth,
  mergeSalesBreakdowns,
  sumSalesBreakdown,
} from './accountingSalesMapping'

/** 経費が PL / 集計対象か。確認済み + 科目選択 + 未削除が必須。 */
export const isExpenseEligibleForAggregation = (
  expense: Pick<StoredAccountingExpense, 'confirmationStatus' | 'expenseCategory' | 'isDeleted'>,
): expense is Pick<StoredAccountingExpense, 'confirmationStatus' | 'expenseCategory' | 'isDeleted'> & {
  expenseCategory: ExpenseCategory
} =>
  isExpenseEligibleForReporting(expense) && isExpenseCategorySelected(expense.expenseCategory)

export const createEmptyExpenseBreakdown = (): ExpenseCategoryBreakdown =>
  EXPENSE_CATEGORIES.reduce((breakdown, category) => {
    breakdown[category] = 0
    return breakdown
  }, {} as ExpenseCategoryBreakdown)

export const sumExpenseBreakdown = (breakdown: ExpenseCategoryBreakdown) =>
  EXPENSE_CATEGORIES.reduce((total, category) => total + breakdown[category], 0)

const applySalesAdjustments = (
  breakdown: SalesCategoryBreakdown,
  adjustments: StoredAccountingAdjustment[],
) => {
  const next = { ...breakdown }

  adjustments.forEach((adjustment) => {
    if (adjustment.adjustmentType !== 'sales' || !isConfirmedForPl(adjustment.confirmationStatus)) {
      return
    }

    const salesCategory = normalizeSalesCategory(adjustment.salesCategory)
    if (!salesCategory) {
      return
    }

    next[salesCategory] += adjustment.amountYen
  })

  return next
}

/**
 * 経費調整を category に応じて売上原価 / 固定費 / 変動費へ振り分ける。
 * 旧データの「全経費調整→変動費」ではなく、科目マスタの category を優先する。
 */
const applyExpenseAdjustmentsByPlCategory = (
  buckets: {
    costOfSales: ExpenseCategoryBreakdown
    fixedCosts: ExpenseCategoryBreakdown
    variableExpenses: ExpenseCategoryBreakdown
  },
  adjustments: StoredAccountingAdjustment[],
) => {
  const next = {
    costOfSales: { ...buckets.costOfSales },
    fixedCosts: { ...buckets.fixedCosts },
    variableExpenses: { ...buckets.variableExpenses },
  }

  adjustments.forEach((adjustment) => {
    if (adjustment.adjustmentType !== 'expense' || !isConfirmedForPl(adjustment.confirmationStatus)) {
      return
    }

    const expenseCategory = normalizeExpenseCategory(adjustment.expenseCategory)
    if (!expenseCategory) {
      return
    }

    const plCategory = getAccountPlCategory(expenseCategory)
    if (plCategory === 'costOfSales') {
      next.costOfSales[expenseCategory] += adjustment.amountYen
    } else if (plCategory === 'fixedExpense') {
      next.fixedCosts[expenseCategory] += adjustment.amountYen
    } else if (plCategory === 'variableExpense') {
      next.variableExpenses[expenseCategory] += adjustment.amountYen
    }
  })

  return next
}

/**
 * 確認済み経費を category で売上原価 / 固定費 / 変動費へ振り分け。
 * 入力時は科目のみ保存し、PL側で自動集計する。
 */
export const aggregateConfirmedExpensesByPlCategory = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) => {
  const costOfSales = createEmptyExpenseBreakdown()
  const fixedCosts = createEmptyExpenseBreakdown()
  const variableExpenses = createEmptyExpenseBreakdown()
  let confirmedExpenseCount = 0

  expenses.forEach((expense) => {
    if (!isExpenseEligibleForAggregation(expense)) {
      return
    }

    if (normalizePlTreatment(expense.plTreatment) !== 'expense') {
      return
    }

    const expenseYearMonth = getExpensePostingDate(expense).slice(0, 7)
    if (expenseYearMonth !== targetYearMonth) {
      return
    }

    const category = normalizeExpenseCategory(expense.expenseCategory)
    if (!category) {
      return
    }

    const plCategory = getAccountPlCategory(category)
    const amount = expense.taxIncludedAmount
    confirmedExpenseCount += 1

    if (plCategory === 'costOfSales') {
      costOfSales[category] += amount
    } else if (plCategory === 'fixedExpense') {
      fixedCosts[category] += amount
    } else if (plCategory === 'variableExpense') {
      variableExpenses[category] += amount
    }
  })

  return { costOfSales, fixedCosts, variableExpenses, confirmedExpenseCount }
}

/** @deprecated 互換用。変動費 bucket のみ返す旧API */
export const aggregateConfirmedExpenses = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) => {
  const { variableExpenses, confirmedExpenseCount } = aggregateConfirmedExpensesByPlCategory(
    expenses,
    targetYearMonth,
  )
  return { breakdown: variableExpenses, confirmedExpenseCount }
}

export const aggregateDeferredCandidateExpenses = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) => {
  const breakdown = createEmptyExpenseBreakdown()
  let deferredCandidateCount = 0

  expenses.forEach((expense) => {
    if (!isExpenseEligibleForAggregation(expense)) {
      return
    }

    if (normalizePlTreatment(expense.plTreatment) !== 'deferredCandidate') {
      return
    }

    const expenseYearMonth = getExpensePostingDate(expense).slice(0, 7)
    if (expenseYearMonth !== targetYearMonth) {
      return
    }

    const category = normalizeExpenseCategory(expense.expenseCategory)
    if (!category) {
      return
    }

    breakdown[category] += expense.taxIncludedAmount
    deferredCandidateCount += 1
  })

  return { breakdown, deferredCandidateCount }
}

const mergeExpenseBreakdowns = (
  left: ExpenseCategoryBreakdown,
  right: ExpenseCategoryBreakdown,
): ExpenseCategoryBreakdown => {
  const next = createEmptyExpenseBreakdown()

  EXPENSE_CATEGORIES.forEach((category) => {
    next[category] = left[category] + right[category]
  })

  return next
}

export const aggregateFixedCosts = (
  fixedCosts: StoredAccountingFixedCost[],
  targetYearMonth: string,
) => {
  const breakdown = createEmptyExpenseBreakdown()
  let fixedCostCount = 0

  fixedCosts.forEach((fixedCost) => {
    if (!isFixedCostActiveForMonth(fixedCost, targetYearMonth)) {
      return
    }

    const category = normalizeExpenseCategory(fixedCost.expenseCategory)
    if (!category) {
      return
    }

    // 固定費マスタは原則固定費。万一の科目違いでも固定費小計へ寄せる
    breakdown[category] += fixedCost.monthlyAmountYen
    fixedCostCount += 1
  })

  return { breakdown, fixedCostCount }
}

export const aggregateExpensesByTaxCategory = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) => {
  const totals: Record<TaxCategory, number> = {
    taxable: 0,
    non_taxable: 0,
    out_of_scope: 0,
  }

  expenses.forEach((expense) => {
    if (!isExpenseEligibleForAggregation(expense)) {
      return
    }

    if (getExpensePostingDate(expense).slice(0, 7) !== targetYearMonth) {
      return
    }

    if (normalizePlTreatment(expense.plTreatment) !== 'expense') {
      return
    }

    const category = expense.taxCategory ?? 'taxable'
    totals[category] += expense.taxIncludedAmount
  })

  return totals
}

export const aggregateExpensesByInvoiceStatus = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) => {
  const totals: Record<InvoiceStatus, number> = {
    verified: 0,
    none: 0,
    not_required: 0,
    unknown: 0,
  }

  expenses.forEach((expense) => {
    if (!isExpenseEligibleForAggregation(expense)) {
      return
    }

    if (getExpensePostingDate(expense).slice(0, 7) !== targetYearMonth) {
      return
    }

    if (normalizePlTreatment(expense.plTreatment) !== 'expense') {
      return
    }

    const status = expense.invoiceStatus ?? 'unknown'
    totals[status] += expense.taxIncludedAmount
  })

  return totals
}

export const formatTaxCategoryAggregationLabel = (category: TaxCategory) => TAX_CATEGORY_LABELS[category]

export const formatInvoiceStatusAggregationLabel = (status: InvoiceStatus) => INVOICE_STATUS_LABELS[status]

export const calculateMonthlyProfitLoss = ({
  adjustments,
  caseRecords,
  expenses,
  fixedCosts = [],
  targetYearMonth,
}: {
  adjustments: StoredAccountingAdjustment[]
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  fixedCosts?: StoredAccountingFixedCost[]
  targetYearMonth: string
}): MonthlyProfitLoss => {
  const monthCaseRecords = filterCaseRecordsByYearMonth(caseRecords, targetYearMonth)
  const monthAdjustments = adjustments.filter((adjustment) => adjustment.targetYearMonth === targetYearMonth)

  const sales = applySalesAdjustments(aggregateSalesBreakdown(monthCaseRecords), monthAdjustments)
  const {
    costOfSales: costOfSalesFromExpenses,
    fixedCosts: fixedFromExpenses,
    variableExpenses: variableFromExpenses,
    confirmedExpenseCount,
  } = aggregateConfirmedExpensesByPlCategory(expenses, targetYearMonth)

  const { breakdown: deferredCandidate, deferredCandidateCount } = aggregateDeferredCandidateExpenses(
    expenses,
    targetYearMonth,
  )

  const adjustedBuckets = applyExpenseAdjustmentsByPlCategory(
    {
      costOfSales: costOfSalesFromExpenses,
      fixedCosts: fixedFromExpenses,
      variableExpenses: variableFromExpenses,
    },
    monthAdjustments,
  )

  const { breakdown: fixedCostsFromMaster, fixedCostCount } = aggregateFixedCosts(fixedCosts, targetYearMonth)
  const fixedCostsBreakdown = mergeExpenseBreakdowns(adjustedBuckets.fixedCosts, fixedCostsFromMaster)
  const costOfSales = adjustedBuckets.costOfSales
  const variableExpenses = adjustedBuckets.variableExpenses
  const expensesMerged = mergeExpenseBreakdowns(
    mergeExpenseBreakdowns(costOfSales, fixedCostsBreakdown),
    variableExpenses,
  )

  const salesTotalYen = sumSalesBreakdown(sales)
  const costOfSalesTotalYen = sumExpenseBreakdown(costOfSales)
  const fixedCostsTotalYen = sumExpenseBreakdown(fixedCostsBreakdown)
  const variableExpensesTotalYen = sumExpenseBreakdown(variableExpenses)
  const expensesTotalYen = sumExpenseBreakdown(expensesMerged)
  const deferredCandidateTotalYen = sumExpenseBreakdown(deferredCandidate)
  const grossProfitYen = salesTotalYen - costOfSalesTotalYen
  const operatingProfitYen = grossProfitYen - fixedCostsTotalYen - variableExpensesTotalYen

  return {
    targetYearMonth,
    sales,
    salesTotalYen,
    costOfSales,
    costOfSalesTotalYen,
    grossProfitYen,
    variableExpenses,
    variableExpensesTotalYen,
    fixedCosts: fixedCostsBreakdown,
    fixedCostsTotalYen,
    fixedCostCount,
    expenses: expensesMerged,
    expensesTotalYen,
    deferredCandidate,
    deferredCandidateTotalYen,
    deferredCandidateCount,
    operatingProfitYen,
    caseRecordCount: monthCaseRecords.length,
    confirmedExpenseCount,
  }
}

const createEmptyMonthlyProfitLoss = (targetYearMonth: string): MonthlyProfitLoss => ({
  targetYearMonth,
  sales: SALES_CATEGORIES.reduce((breakdown, category) => {
    breakdown[category] = 0
    return breakdown
  }, {} as SalesCategoryBreakdown),
  salesTotalYen: 0,
  costOfSales: createEmptyExpenseBreakdown(),
  costOfSalesTotalYen: 0,
  grossProfitYen: 0,
  variableExpenses: createEmptyExpenseBreakdown(),
  variableExpensesTotalYen: 0,
  fixedCosts: createEmptyExpenseBreakdown(),
  fixedCostsTotalYen: 0,
  fixedCostCount: 0,
  expenses: createEmptyExpenseBreakdown(),
  expensesTotalYen: 0,
  deferredCandidate: createEmptyExpenseBreakdown(),
  deferredCandidateTotalYen: 0,
  deferredCandidateCount: 0,
  operatingProfitYen: 0,
  caseRecordCount: 0,
  confirmedExpenseCount: 0,
})

const sumMonthlyProfitLosses = (
  targetYearMonth: string,
  months: MonthlyProfitLoss[],
): MonthlyProfitLoss => {
  if (months.length === 0) {
    return createEmptyMonthlyProfitLoss(targetYearMonth)
  }

  return months.reduce((total, month) => {
    const sales = mergeSalesBreakdowns(total.sales, month.sales)
    const costOfSales = mergeExpenseBreakdowns(total.costOfSales, month.costOfSales)
    const fixedCosts = mergeExpenseBreakdowns(total.fixedCosts, month.fixedCosts)
    const variableExpenses = mergeExpenseBreakdowns(total.variableExpenses, month.variableExpenses)
    const deferredCandidate = mergeExpenseBreakdowns(total.deferredCandidate, month.deferredCandidate)
    const expenses = mergeExpenseBreakdowns(total.expenses, month.expenses)
    const salesTotalYen = sumSalesBreakdown(sales)
    const costOfSalesTotalYen = sumExpenseBreakdown(costOfSales)
    const fixedCostsTotalYen = sumExpenseBreakdown(fixedCosts)
    const variableExpensesTotalYen = sumExpenseBreakdown(variableExpenses)
    const grossProfitYen = salesTotalYen - costOfSalesTotalYen

    return {
      targetYearMonth,
      sales,
      salesTotalYen,
      costOfSales,
      costOfSalesTotalYen,
      grossProfitYen,
      fixedCosts,
      fixedCostsTotalYen,
      fixedCostCount: total.fixedCostCount + month.fixedCostCount,
      variableExpenses,
      variableExpensesTotalYen,
      expenses,
      expensesTotalYen: sumExpenseBreakdown(expenses),
      deferredCandidate,
      deferredCandidateTotalYen: sumExpenseBreakdown(deferredCandidate),
      deferredCandidateCount: total.deferredCandidateCount + month.deferredCandidateCount,
      operatingProfitYen: grossProfitYen - fixedCostsTotalYen - variableExpensesTotalYen,
      caseRecordCount: total.caseRecordCount + month.caseRecordCount,
      confirmedExpenseCount: total.confirmedExpenseCount + month.confirmedExpenseCount,
    }
  }, createEmptyMonthlyProfitLoss(targetYearMonth))
}

const YEARLY_MONTH_KEYS: YearlyProfitLossColumnKey[] = [
  'm01',
  'm02',
  'm03',
  'm04',
  'm05',
  'm06',
  'm07',
  'm08',
  'm09',
  'm10',
  'm11',
  'm12',
]

/**
 * 同一PLレイアウトで前々期・前期・月別・年間合計を返す。
 * カレンダー年（1〜12月）基準。将来の店舗別等でも同じ関数を使い回せる。
 */
export const calculateYearlyProfitLoss = ({
  adjustments,
  caseRecords,
  expenses,
  fixedCosts = [],
  targetYear,
}: {
  adjustments: StoredAccountingAdjustment[]
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  fixedCosts?: StoredAccountingFixedCost[]
  targetYear: number
}): YearlyProfitLoss => {
  const buildMonth = (year: number, month: number) => {
    const targetYearMonth = `${year}-${String(month).padStart(2, '0')}`
    return calculateMonthlyProfitLoss({
      adjustments,
      caseRecords,
      expenses,
      fixedCosts,
      targetYearMonth,
    })
  }

  const months = Array.from({ length: 12 }, (_, index) => buildMonth(targetYear, index + 1))
  const previousYearMonths = Array.from({ length: 12 }, (_, index) => buildMonth(targetYear - 1, index + 1))
  const twoYearsAgoMonths = Array.from({ length: 12 }, (_, index) => buildMonth(targetYear - 2, index + 1))

  const columns: Record<YearlyProfitLossColumnKey, MonthlyProfitLoss> = {
    twoYearsAgo: sumMonthlyProfitLosses(`${targetYear - 2}`, twoYearsAgoMonths),
    previousYear: sumMonthlyProfitLosses(`${targetYear - 1}`, previousYearMonths),
    m01: months[0],
    m02: months[1],
    m03: months[2],
    m04: months[3],
    m05: months[4],
    m06: months[5],
    m07: months[6],
    m08: months[7],
    m09: months[8],
    m10: months[9],
    m11: months[10],
    m12: months[11],
    yearTotal: sumMonthlyProfitLosses(`${targetYear}`, months),
  }

  const columnLabels: Record<YearlyProfitLossColumnKey, string> = {
    twoYearsAgo: `${targetYear - 2}年（前々期）`,
    previousYear: `${targetYear - 1}年（前期）`,
    m01: '1月',
    m02: '2月',
    m03: '3月',
    m04: '4月',
    m05: '5月',
    m06: '6月',
    m07: '7月',
    m08: '8月',
    m09: '9月',
    m10: '10月',
    m11: '11月',
    m12: '12月',
    yearTotal: `${targetYear}年 年間合計`,
  }

  return { targetYear, columns, columnLabels }
}

export const getYearlyProfitLossColumnOrder = (): YearlyProfitLossColumnKey[] => [
  'twoYearsAgo',
  'previousYear',
  ...YEARLY_MONTH_KEYS,
  'yearTotal',
]

export { calculateConsumptionTaxFromIncluded } from './accountingTax'

export const formatYearMonthLabel = (targetYearMonth: string) => {
  const [year, month] = targetYearMonth.split('-')
  if (!year || !month) {
    return targetYearMonth
  }

  return `${year}年${Number(month)}月`
}

export const getCurrentYearMonthInJapan = () => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  return `${year}-${month}`
}

export const getCurrentCalendarYearInJapan = () => Number(getCurrentYearMonthInJapan().slice(0, 4))

export const buildYearMonthOptions = (count = 12) => {
  const options: string[] = []
  const now = new Date()

  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1))
    const parts = new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      timeZone: 'Asia/Tokyo',
    }).formatToParts(date)
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
    const month = parts.find((part) => part.type === 'month')?.value ?? '01'
    options.push(`${year}-${month}`)
  }

  return options
}

export const buildCalendarYearOptions = (count = 5) => {
  const currentYear = getCurrentCalendarYearInJapan()
  return Array.from({ length: count }, (_, index) => currentYear - index)
}

export { mergeSalesBreakdowns, SALES_CATEGORIES, EXPENSE_CATEGORIES }
