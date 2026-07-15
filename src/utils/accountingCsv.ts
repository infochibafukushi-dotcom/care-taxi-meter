import type { MonthlyProfitLoss, YearlyProfitLoss } from '../types/accounting'
import {
  COST_OF_SALES_CATEGORIES,
  EXPENSE_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  getPlTreatmentLabel,
  normalizePlTreatment,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../types/accounting'
import type { AccountingSalesRow } from './accountingSalesMapping'
import {
  formatYearMonthLabel,
  getYearlyProfitLossColumnOrder,
} from './accountingPl'
import { ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS } from '../types/accountingReceiptWorkflow'
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
export const buildYearlyPlCsv = (yearly: YearlyProfitLoss, targetYear?: number) => {
  const columnOrder = getYearlyProfitLossColumnOrder()
  const calendarLabel = targetYear ? `${targetYear}年（暦年・管理会計）` : ''
  const lines = [
    ...(calendarLabel ? [csvLine(['年次管理会計PL', calendarLabel])] : []),
    csvLine([...YEARLY_CSV_HEADERS]),
  ]

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
    receiptImageUrl?: string
    memo?: string
    normalExpenseOverrideReason?: string
  }>,
  targetYearMonth: string,
) => {
  const lines = [
    csvLine(['経費一覧', formatYearMonthLabel(targetYearMonth)]),
    csvLine([
      '日付',
      '取引先',
      '内容',
      '勘定科目',
      '補助科目',
      '金額(円)',
      '税率(%)',
      '税額(円)',
      'インボイス番号',
      '領収書画像有無',
      'PL反映区分',
      '備考',
    ]),
    ...expenses.map((expense) => {
      const memoParts = [expense.memo?.trim(), expense.normalExpenseOverrideReason?.trim()].filter(Boolean)
      return csvLine([
        getExpensePostingDate(expense),
        expense.vendorName,
        expense.description,
        expense.expenseCategory,
        '',
        expense.taxIncludedAmount,
        expense.taxRate ?? '',
        expense.consumptionTaxAmount,
        expense.invoiceNumber ?? '',
        expense.receiptImageUrl ? '有' : '無',
        getPlTreatmentLabel(normalizePlTreatment(expense.plTreatment)),
        memoParts.join(' / '),
      ])
    }),
  ]

  return `\uFEFF${lines.join(CSV_EOL)}`
}

export const buildFixedAssetsCsv = (
  assets: Array<{
    purchaseDate: string
    useStartDate: string
    assetName: string
    assetCategory: string
    condition: string
    firstRegistrationYearMonth?: string
    acquisitionCost: number
    standardUsefulLifeYears: number
    appliedUsefulLifeYears: number
    monthlyDepreciationYen: number
    depreciationStartYearMonth: string
    depreciationEndYearMonth: string
    remainingBookValue: number
    status: string
    notes?: string
  }>,
) => {
  const lines = [
    csvLine(['固定資産台帳']),
    csvLine([
      '購入日',
      '使用開始日',
      '資産名',
      '資産区分',
      '新品中古',
      '初度登録年月',
      '取得価額(円)',
      '標準耐用年数',
      '適用耐用年数',
      '月額償却費(円)',
      '償却開始月',
      '償却終了月',
      '未償却残高(円)',
      '状態',
      '備考',
    ]),
    ...assets.map((asset) =>
      csvLine([
        asset.purchaseDate,
        asset.useStartDate,
        asset.assetName,
        asset.assetCategory,
        asset.condition,
        asset.firstRegistrationYearMonth ?? '',
        asset.acquisitionCost,
        asset.standardUsefulLifeYears,
        asset.appliedUsefulLifeYears,
        asset.monthlyDepreciationYen,
        asset.depreciationStartYearMonth,
        asset.depreciationEndYearMonth,
        asset.remainingBookValue,
        asset.status,
        asset.notes ?? '',
      ]),
    ),
  ]

  return `\uFEFF${lines.join(CSV_EOL)}`
}

export const buildSmallAssetsCsv = (
  assets: Array<{
    purchaseDate: string
    useStartDate: string
    assetName: string
    assetCategory: string
    acquisitionCost: number
    plPostingYearMonth: string
    notes?: string
  }>,
) => {
  const lines = [
    csvLine(['少額資産一覧']),
    csvLine([
      '購入日',
      '使用開始日',
      '資産名',
      '資産区分',
      '取得価額(円)',
      '処理区分',
      '年間300万円枠対象',
      'PL反映月',
      '備考',
    ]),
    ...assets.map((asset) =>
      csvLine([
        asset.purchaseDate,
        asset.useStartDate,
        asset.assetName,
        asset.assetCategory,
        asset.acquisitionCost,
        '少額資産',
        asset.acquisitionCost >= 100_000 ? '対象' : '対象外',
        asset.plPostingYearMonth,
        asset.notes ?? '',
      ]),
    ),
  ]

  return `\uFEFF${lines.join(CSV_EOL)}`
}

export const buildDepreciationCsv = (
  rows: Array<{
    targetYearMonth: string
    assetName: string
    assetCategory: string
    acquisitionCost: number
    monthlyDepreciationYen: number
    depreciationYen: number
    cumulativeDepreciationYen: number
    remainingBookValue: number
    plExpenseCategory: string
  }>,
) => {
  const lines = [
    csvLine(['減価償却一覧']),
    csvLine([
      '対象年月',
      '資産名',
      '資産区分',
      '取得価額(円)',
      '月額償却費(円)',
      '当月償却費(円)',
      '累計償却額(円)',
      '未償却残高(円)',
      'PL反映科目',
    ]),
    ...rows.map((row) =>
      csvLine([
        row.targetYearMonth,
        row.assetName,
        row.assetCategory,
        row.acquisitionCost,
        row.monthlyDepreciationYen,
        row.depreciationYen,
        row.cumulativeDepreciationYen,
        row.remainingBookValue,
        row.plExpenseCategory,
      ]),
    ),
  ]

  return `\uFEFF${lines.join(CSV_EOL)}`
}

const buildReceiptRowsCsv = (
  title: string,
  receipts: Array<{
    savedAt?: string
    receiptDate?: string
    vendorNameCandidate?: string
    amountTotalCandidate?: number
    ocrStatus: string
    confirmationStatus: string
    linkedToExpense: string
    imageReference: string
  }>,
) => {
  const lines = [
    csvLine([title]),
    csvLine([
      '保存日',
      '証憑日',
      '取引先候補',
      '金額候補(円)',
      'OCR状態',
      '確認状態',
      '経費登録済みか',
      '画像URLまたは画像有無',
    ]),
    ...receipts.map((receipt) =>
      csvLine([
        receipt.savedAt ?? '',
        receipt.receiptDate ?? '',
        receipt.vendorNameCandidate ?? '',
        receipt.amountTotalCandidate ?? '',
        receipt.ocrStatus,
        receipt.confirmationStatus,
        receipt.linkedToExpense,
        receipt.imageReference,
      ]),
    ),
  ]

  return `\uFEFF${lines.join(CSV_EOL)}`
}

export const buildAllReceiptsCsv = (
  receipts: Array<{
    savedAt?: string
    receiptDate?: string
    vendorNameCandidate?: string
    amountTotalCandidate?: number
    ocrProcessedAt?: string
    receiptStatus?: string
    linkedExpenseId?: string
    downloadUrl?: string
    imageUrl?: string
  }>,
) =>
  buildReceiptRowsCsv(
    '領収書一覧',
    receipts.map((receipt) => ({
      savedAt: receipt.savedAt,
      receiptDate: receipt.receiptDate,
      vendorNameCandidate: receipt.vendorNameCandidate,
      amountTotalCandidate: receipt.amountTotalCandidate,
      ocrStatus: receipt.ocrProcessedAt ? 'OCR済み' : '未OCR',
      confirmationStatus:
        ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS[
          (receipt.receiptStatus ?? 'draft') as keyof typeof ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS
        ] ?? receipt.receiptStatus ?? '',
      linkedToExpense: receipt.linkedExpenseId ? 'はい' : 'いいえ',
      imageReference: receipt.downloadUrl || receipt.imageUrl || '無',
    })),
  )

export const buildUnorganizedReceiptsCsv = (
  receipts: Array<{
    savedAt?: string
    receiptDate?: string
    vendorNameCandidate?: string
    amountTotalCandidate?: number
    ocrProcessedAt?: string
    receiptStatus?: string
    linkedExpenseId?: string
    downloadUrl?: string
    imageUrl?: string
  }>,
) =>
  buildReceiptRowsCsv(
    '未整理領収書一覧',
    receipts.map((receipt) => ({
      savedAt: receipt.savedAt,
      receiptDate: receipt.receiptDate,
      vendorNameCandidate: receipt.vendorNameCandidate,
      amountTotalCandidate: receipt.amountTotalCandidate,
      ocrStatus: receipt.ocrProcessedAt ? 'OCR済み' : '未OCR',
      confirmationStatus:
        ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS[
          (receipt.receiptStatus ?? 'draft') as keyof typeof ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS
        ] ?? receipt.receiptStatus ?? '',
      linkedToExpense: receipt.linkedExpenseId ? 'はい' : 'いいえ',
      imageReference: receipt.downloadUrl || receipt.imageUrl || '無',
    })),
  )

/** @deprecated buildAllReceiptsCsv を使用 */
export const buildReceiptsCsv = buildAllReceiptsCsv

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
