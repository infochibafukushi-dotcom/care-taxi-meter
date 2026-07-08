import type { MonthlyProfitLoss, YearlyProfitLoss } from '../types/accounting'
import {
  COST_OF_SALES_CATEGORIES,
  EXPENSE_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  getExpenseReceiptDate,
  getPlTreatmentLabel,
  normalizePlTreatment,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../types/accounting'
import type { AccountingSalesRow } from './accountingSalesMapping'
import { formatYearMonthLabel, getYearlyProfitLossColumnOrder } from './accountingPl'
import { formatFareYen } from '../services/fare'

const CSV_EOL = '\r\n'

const escapeCsv = (value: string | number) => {
  const stringValue = String(value)
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replaceAll('"', '""')}"`
}

const csvLine = (values: Array<string | number>) => values.map(escapeCsv).join(',')

const YEARLY_CSV_HEADERS = [
  '区分',
  '科目',
  '前々期',
  '前期',
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
  '年間合計',
] as const

const appendPositiveExpenseRows = (
  lines: string[],
  sectionLabel: string,
  categories: readonly (typeof EXPENSE_CATEGORIES)[number][],
  breakdown: MonthlyProfitLoss['costOfSales'],
) => {
  categories
    .filter((category) => breakdown[category] > 0)
    .forEach((category) => {
      lines.push(csvLine([sectionLabel, category, breakdown[category]]))
    })
}

export const buildMonthlyPlCsv = (profitLoss: MonthlyProfitLoss) => {
  const deferredRows = EXPENSE_CATEGORIES.filter((category) => profitLoss.deferredCandidate[category] > 0).map(
    (category) => csvLine(['繰延資産候補', category, profitLoss.deferredCandidate[category]]),
  )

  const lines = [
    csvLine(['管理会計PL', formatYearMonthLabel(profitLoss.targetYearMonth)]),
    csvLine(['区分', '科目', '金額(円)']),
    ...SALES_CATEGORIES.map((category) => csvLine(['売上', category, profitLoss.sales[category]])),
    csvLine(['売上', '売上小計', profitLoss.salesTotalYen]),
  ]

  appendPositiveExpenseRows(lines, '売上原価', COST_OF_SALES_CATEGORIES, profitLoss.costOfSales)
  lines.push(csvLine(['売上原価', '売上原価小計', profitLoss.costOfSalesTotalYen]))
  lines.push(csvLine(['粗利益', '粗利益', profitLoss.grossProfitYen]))

  appendPositiveExpenseRows(lines, '固定費', FIXED_EXPENSE_CATEGORIES, profitLoss.fixedCosts)
  lines.push(csvLine(['固定費', '固定費小計', profitLoss.fixedCostsTotalYen]))

  appendPositiveExpenseRows(lines, '変動費', VARIABLE_EXPENSE_CATEGORIES, profitLoss.variableExpenses)
  lines.push(csvLine(['変動費', '変動費小計', profitLoss.variableExpensesTotalYen]))

  lines.push(...deferredRows)
  lines.push(csvLine(['繰延資産候補', '合計', profitLoss.deferredCandidateTotalYen]))
  lines.push(csvLine(['利益', '営業利益（純利益）', profitLoss.operatingProfitYen]))

  return `\uFEFF${lines.join(CSV_EOL)}`
}

/**
 * 年間管理会計PL CSV。画面と同じ calculateYearlyProfitLoss 結果を出力する。
 * ファイル名推奨: management-pl-yearly-YYYY.csv
 */
export const buildYearlyPlCsv = (yearly: YearlyProfitLoss) => {
  const columnOrder = getYearlyProfitLossColumnOrder()
  const lines = [csvLine([...YEARLY_CSV_HEADERS])]

  const pushRow = (section: string, label: string, pick: (pl: MonthlyProfitLoss) => number) => {
    lines.push(
      csvLine([
        section,
        label,
        ...columnOrder.map((key) => pick(yearly.columns[key])),
      ]),
    )
  }

  SALES_CATEGORIES.forEach((category) => {
    pushRow('売上', category, (pl) => pl.sales[category])
  })
  pushRow('売上', '売上小計', (pl) => pl.salesTotalYen)

  COST_OF_SALES_CATEGORIES.forEach((category) => {
    pushRow('売上原価', category, (pl) => pl.costOfSales[category])
  })
  pushRow('売上原価', '売上原価小計', (pl) => pl.costOfSalesTotalYen)
  pushRow('粗利益', '粗利益', (pl) => pl.grossProfitYen)

  FIXED_EXPENSE_CATEGORIES.forEach((category) => {
    pushRow('固定費', category, (pl) => pl.fixedCosts[category])
  })
  pushRow('固定費', '固定費小計', (pl) => pl.fixedCostsTotalYen)

  VARIABLE_EXPENSE_CATEGORIES.forEach((category) => {
    pushRow('変動費', category, (pl) => pl.variableExpenses[category])
  })
  pushRow('変動費', '変動費小計', (pl) => pl.variableExpensesTotalYen)
  pushRow('利益', '営業利益（純利益）', (pl) => pl.operatingProfitYen)

  return `\uFEFF${lines.join(CSV_EOL)}`
}

export const buildYearlyPlCsvFileName = (targetYear: number) => `management-pl-yearly-${targetYear}.csv`

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

  return `\uFEFF${lines.join(CSV_EOL)}`
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
    taxRate: number | null
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
        expense.taxRate ?? '',
        expense.consumptionTaxAmount,
        expense.paymentMethod,
        expense.invoiceNumber ?? '',
        expense.confirmationStatus,
        expense.memo ?? '',
      ]),
    ),
  ]

  return `\uFEFF${lines.join(CSV_EOL)}`
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
