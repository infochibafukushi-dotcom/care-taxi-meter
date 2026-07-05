import type { MonthlyProfitLoss } from '../types/accounting'
import { EXPENSE_CATEGORIES, SALES_CATEGORIES } from '../types/accounting'
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
  const lines = [
    csvLine(['月次PL', formatYearMonthLabel(profitLoss.targetYearMonth)]),
    csvLine(['区分', '科目', '金額(円)']),
    ...SALES_CATEGORIES.map((category) => csvLine(['売上', category, profitLoss.sales[category]])),
    csvLine(['売上', '売上合計', profitLoss.salesTotalYen]),
    ...EXPENSE_CATEGORIES.map((category) => csvLine(['経費', category, profitLoss.expenses[category]])),
    csvLine(['経費', '経費合計', profitLoss.expensesTotalYen]),
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
    transactionDate: string
    vendorName: string
    description: string
    expenseCategory: string
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
      '取引日',
      '仕入先',
      '内容',
      '経費科目',
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
        expense.transactionDate,
        expense.vendorName,
        expense.description,
        expense.expenseCategory,
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
