import type { StoredCaseRecord } from '../services/caseRecords'
import type {
  ExpenseCategoryBreakdown,
  MonthlyProfitLoss,
  SalesCategory,
  SalesCategoryBreakdown,
  StoredAccountingAdjustment,
  StoredAccountingExpense,
} from '../types/accounting'
import {
  EXPENSE_CATEGORIES,
  isConfirmedForPl,
  isExpenseCategorySelected,
  SALES_CATEGORIES,
} from '../types/accounting'
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
    if (!isConfirmedForPl(expense.confirmationStatus) || !isExpenseCategorySelected(expense.expenseCategory)) {
      return
    }

    const expenseYearMonth = expense.transactionDate.slice(0, 7)
    if (expenseYearMonth !== targetYearMonth) {
      return
    }

    breakdown[expense.expenseCategory] += expense.taxIncludedAmount
    confirmedExpenseCount += 1
  })

  return { breakdown, confirmedExpenseCount }
}

export const calculateMonthlyProfitLoss = ({
  adjustments,
  caseRecords,
  expenses,
  targetYearMonth,
}: {
  adjustments: StoredAccountingAdjustment[]
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  targetYearMonth: string
}): MonthlyProfitLoss => {
  const monthCaseRecords = filterCaseRecordsByYearMonth(caseRecords, targetYearMonth)
  const monthAdjustments = adjustments.filter((adjustment) => adjustment.targetYearMonth === targetYearMonth)

  const sales = applySalesAdjustments(aggregateSalesBreakdown(monthCaseRecords), monthAdjustments)
  const { breakdown: expensesBreakdown, confirmedExpenseCount } = aggregateConfirmedExpenses(expenses, targetYearMonth)
  const expensesWithAdjustments = applyExpenseAdjustments(expensesBreakdown, monthAdjustments)

  const salesTotalYen = sumSalesBreakdown(sales)
  const expensesTotalYen = sumExpenseBreakdown(expensesWithAdjustments)

  return {
    targetYearMonth,
    sales,
    salesTotalYen,
    expenses: expensesWithAdjustments,
    expensesTotalYen,
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
