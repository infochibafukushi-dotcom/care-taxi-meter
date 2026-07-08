import type { MonthlyProfitLoss } from '../types/accounting'
import { EXPENSE_CATEGORIES, getExpensePostingDate, getExpenseReceiptDate, getPlTreatmentLabel, normalizePlTreatment, SALES_CATEGORIES } from '../types/accounting'
import type { AccountingSalesRow } from './accountingSalesMapping'
import { formatYearMonthLabel } from './accountingPl'
import { formatFareYen } from '../services/fare'

const escapeCsv = (value: string | number) => {
  const stringValue = String(value)
  if (!/[",\n]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replaceAll('"', '""')}"`
}

const csvLine = (values: Array<string | number>) => values.map(escapeCsv).join(',')

export const buildMonthlyPlCsv = (profitLoss: MonthlyProfitLoss) => {
  const deferredRows = EXPENSE_CATEGORIES.filter((category) => profitLoss.deferredCandidate[category] > 0).map(
    (category) => csvLine(['繰延資産候補', category, profitLoss.deferredCandidate[category]]),
  )

  const lines = [
    csvLine(['月次PL', formatYearMonthLabel(profitLoss.targetYearMonth)]),
    csvLine(['区分', '科目', '金額(円)']),
    ...SALES_CATEGORIES.map((category) => csvLine(['売上', category, profitLoss.sales[category]])),
    csvLine(['売上', '売上合計', profitLoss.salesTotalYen]),
    ...EXPENSE_CATEGORIES.filter((category) => profitLoss.variableExpenses[category] > 0).map((category) =>
      csvLine(['変動費', category, profitLoss.variableExpenses[category]]),
    ),
    csvLine(['変動費', '変動費合計', profitLoss.variableExpensesTotalYen]),
    ...EXPENSE_CATEGORIES.filter((category) => profitLoss.fixedCosts[category] > 0).map((category) =>
      csvLine(['固定費', category, profitLoss.fixedCosts[category]]),
    ),
    csvLine(['固定費', '固定費合計', profitLoss.fixedCostsTotalYen]),
    csvLine(['経費', '経費合計', profitLoss.expensesTotalYen]),
    ...deferredRows,
    csvLine(['繰延資産候補', '合計', profitLoss.deferredCandidateTotalYen]),
    csvLine(['利益', '営業利益', profitLoss.operatingProfitYen]),
  ]

  return `\uFEFF${lines.join('\n')}`
}

export const buildSalesCsv = (rows: AccountingSalesRow[], targetYearMonth: string) => {
  const lines = [
    csvLine(['確定売上一覧', formatYearMonthLabel(targetYearMonth)]),
    csvLine([
      '案件番号',
      '精算日時',
      '店舗',
      'ドライバー',
      '合計(円)',
      ...SALES_CATEGORIES,
    ]),
    ...rows.map((row) =>
      csvLine([
        row.caseNumber,
        row.closedAt,
        row.storeName,
        row.staffName,
        row.totalFareYen,
        ...SALES_CATEGORIES.map((category) => row.breakdown[category]),
      ]),
    ),
  ]

  return `\uFEFF${lines.join('\n')}`
}

export const buildExpensesCsv = (
  expenses: Array<{
    receiptDate?: string
    postingDate?: string
    transactionDate: string
    vendorName: string
    description: string
    expenseCategory: string
    plTreatment?: string
    taxIncludedAmount: number
    taxRate: number
    consumptionTaxAmount: number
    paymentMethod: string
    invoiceNumber?: string
    confirmationStatus: string
    memo?: string
  }>,
  targetYearMonth: string,
) => {
  const lines = [
    csvLine(['経費一覧', formatYearMonthLabel(targetYearMonth)]),
    csvLine([
      '証憑日',
      '計上日',
      '仕入先',
      '内容',
      '経費科目',
      'PL反映区分',
      '税込金額(円)',
      '税率(%)',
      '消費税額(円)',
      '支払方法',
      'インボイス番号',
      '確認状態',
      'メモ',
    ]),
    ...expenses.map((expense) =>
      csvLine([
        getExpenseReceiptDate(expense),
        getExpensePostingDate(expense),
        expense.vendorName,
        expense.description,
        expense.expenseCategory,
        getPlTreatmentLabel(normalizePlTreatment(expense.plTreatment)),
        expense.taxIncludedAmount,
        expense.taxRate,
        expense.consumptionTaxAmount,
        expense.paymentMethod,
        expense.invoiceNumber ?? '',
        expense.confirmationStatus,
        expense.memo ?? '',
      ]),
    ),
  ]

  return `\uFEFF${lines.join('\n')}`
}

export const downloadCsvFile = (fileName: string, csvContent: string) => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export const formatPlAmount = (amountYen: number) => `${formatFareYen(amountYen)}円`
