import type { StoredCaseRecord } from '../services/caseRecords'
import type {
  ExpenseCategoryBreakdown,
  MonthlyProfitLoss,
  SalesCategory,
  SalesCategoryBreakdown,
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
  ExpenseCategory,
} from '../types/accounting'
import {
  EXPENSE_CATEGORIES,
  getExpensePostingDate,
  INVOICE_STATUS_LABELS,
  isConfirmedForPl,
  isExpenseCategorySelected,
  isExpenseEligibleForReporting,
  normalizePlTreatment,
  SALES_CATEGORIES,
  TAX_CATEGORY_LABELS,
  type InvoiceStatus,
  type TaxCategory,
} from '../types/accounting'

/** 経費が PL / 集計対象か。確認済み + 科目選択 + 未削除が必須。 */
export const isExpenseEligibleForAggregation = (
  expense: Pick<StoredAccountingExpense, 'confirmationStatus' | 'expenseCategory' | 'isDeleted'>,
): expense is Pick<StoredAccountingExpense, 'confirmationStatus' | 'expenseCategory' | 'isDeleted'> & {
  expenseCategory: ExpenseCategory
} =>
  isExpenseEligibleForReporting(expense) && isExpenseCategorySelected(expense.expenseCategory)
import { isFixedCostActiveForMonth } from './accountingFixedCost'
import {
  aggregateSalesBreakdown,
  filterCaseRecordsByYearMonth,
  mergeSalesBreakdowns,
  sumSalesBreakdown,
} from './accountingSalesMapping'

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
    if (
      adjustment.adjustmentType !== 'sales' ||
      !isConfirmedForPl(adjustment.confirmationStatus) ||
      !adjustment.salesCategory
    ) {
      return
    }

    next[adjustment.salesCategory as SalesCategory] += adjustment.amountYen
  })

  return next
}

const applyExpenseAdjustments = (
  breakdown: ExpenseCategoryBreakdown,
  adjustments: StoredAccountingAdjustment[],
) => {
  const next = { ...breakdown }

  adjustments.forEach((adjustment) => {
    if (
      adjustment.adjustmentType !== 'expense' ||
      !isConfirmedForPl(adjustment.confirmationStatus) ||
      !isExpenseCategorySelected(adjustment.expenseCategory)
    ) {
      return
    }

    next[adjustment.expenseCategory] += adjustment.amountYen
  })

  return next
}

export const aggregateConfirmedExpenses = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
) => {
  const breakdown = createEmptyExpenseBreakdown()
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

    const category = expense.expenseCategory as ExpenseCategory
    breakdown[category] += expense.taxIncludedAmount
    confirmedExpenseCount += 1
  })

  return { breakdown, confirmedExpenseCount }
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

    breakdown[expense.expenseCategory as ExpenseCategory] += expense.taxIncludedAmount
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
    if (!isFixedCostActiveForMonth(fixedCost, targetYearMonth) || !isExpenseCategorySelected(fixedCost.expenseCategory)) {
      return
    }

    breakdown[fixedCost.expenseCategory] += fixedCost.monthlyAmountYen
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
  const { breakdown: variableExpensesBreakdown, confirmedExpenseCount } = aggregateConfirmedExpenses(
    expenses,
    targetYearMonth,
  )
  const { breakdown: deferredCandidate, deferredCandidateCount } = aggregateDeferredCandidateExpenses(
    expenses,
    targetYearMonth,
  )
  const variableExpensesWithAdjustments = applyExpenseAdjustments(variableExpensesBreakdown, monthAdjustments)
  const { breakdown: fixedCostsBreakdown, fixedCostCount } = aggregateFixedCosts(fixedCosts, targetYearMonth)
  const expensesWithAdjustments = mergeExpenseBreakdowns(variableExpensesWithAdjustments, fixedCostsBreakdown)

  const salesTotalYen = sumSalesBreakdown(sales)
  const variableExpensesTotalYen = sumExpenseBreakdown(variableExpensesWithAdjustments)
  const fixedCostsTotalYen = sumExpenseBreakdown(fixedCostsBreakdown)
  const expensesTotalYen = sumExpenseBreakdown(expensesWithAdjustments)
  const deferredCandidateTotalYen = sumExpenseBreakdown(deferredCandidate)

  return {
    targetYearMonth,
    sales,
    salesTotalYen,
    variableExpenses: variableExpensesWithAdjustments,
    variableExpensesTotalYen,
    fixedCosts: fixedCostsBreakdown,
    fixedCostsTotalYen,
    fixedCostCount,
    expenses: expensesWithAdjustments,
    expensesTotalYen,
    deferredCandidate,
    deferredCandidateTotalYen,
    deferredCandidateCount,
    operatingProfitYen: salesTotalYen - expensesTotalYen,
    caseRecordCount: monthCaseRecords.length,
    confirmedExpenseCount,
  }
}

export const calculateConsumptionTaxFromIncluded = (taxIncludedAmount: number, taxRate: number) => {
  if (taxIncludedAmount <= 0 || taxRate <= 0) {
    return 0
  }

  return Math.round((taxIncludedAmount * taxRate) / (100 + taxRate))
}

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

export { mergeSalesBreakdowns, SALES_CATEGORIES, EXPENSE_CATEGORIES }
