import type { TaxAdvisorPackage } from '../types/accountingTaxAdvisor'
import {
  COST_OF_SALES_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../types/accounting'
import { formatETaxCheckItemStatus } from './accountingETaxData'
import {
  buildExpensesCsv,
  buildFixedAssetsCsv,
  buildSmallAssetsCsv,
  buildDepreciationCsv,
  buildAllReceiptsCsv,
  downloadCsvFile,
} from './accountingCsv'
import { formatFareYen } from '../services/fare'
import { formatLedgerAssetStatus } from './accountingTaxAdvisorData'

const CSV_EOL = '\r\n'

const escapeCsv = (value: string | number) => {
  const stringValue = String(value)
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue
  }
  return `"${stringValue.replaceAll('"', '""')}"`
}

const csvLine = (values: Array<string | number>) => values.map(escapeCsv).join(',')

const withBom = (content: string) => `\uFEFF${content}`

const reportLinesToCsv = (title: string, lines: Array<{ label: string; displayValue: string; amountYen?: number | null; status: string }>) =>
  withBom(
    [
      csvLine([title]),
      csvLine(['項目', '値', '金額(円)', '状態']),
      ...lines.map((row) => csvLine([row.label, row.displayValue, row.amountYen ?? '', row.status])),
    ].join(CSV_EOL),
  )

const buildPlCsvContent = (pkg: TaxAdvisorPackage) => {
  const pl = pkg.pl
  const lines = [
    csvLine(['税理士相談用 損益計算書', pkg.header.fiscalYearLabel]),
    csvLine(['区分', '科目', '金額(円)']),
  ]

  SALES_CATEGORIES.forEach((category) => {
    if (pl.sales[category] > 0) {
      lines.push(csvLine(['売上', category, pl.sales[category]]))
    }
  })
  lines.push(csvLine(['売上', '売上高', pl.salesTotalYen]))

  COST_OF_SALES_CATEGORIES.forEach((category) => {
    if (pl.costOfSales[category] > 0) {
      lines.push(csvLine(['売上原価', category, pl.costOfSales[category]]))
    }
  })
  lines.push(csvLine(['売上原価', '売上原価合計', pl.costOfSalesTotalYen]))
  lines.push(csvLine(['利益', '売上総利益', pl.grossProfitYen]))

  FIXED_EXPENSE_CATEGORIES.forEach((category) => {
    if (pl.fixedCosts[category] > 0) {
      lines.push(csvLine(['販売管理費', category, pl.fixedCosts[category]]))
    }
  })
  VARIABLE_EXPENSE_CATEGORIES.forEach((category) => {
    if (pl.variableExpenses[category] > 0) {
      lines.push(csvLine(['販売管理費', category, pl.variableExpenses[category]]))
    }
  })
  lines.push(csvLine(['利益', '営業利益', pl.operatingProfitYen]))

  return withBom(lines.join(CSV_EOL))
}

export const buildTaxAdvisorSummaryCsv = (pkg: TaxAdvisorPackage) =>
  reportLinesToCsv(`税理士相談用 決算サマリー ${pkg.header.fiscalYearLabel}`, pkg.etax.summary)

export const buildTaxAdvisorPlCsv = (pkg: TaxAdvisorPackage) => buildPlCsvContent(pkg)

export const buildTaxAdvisorBsCsv = (pkg: TaxAdvisorPackage) =>
  reportLinesToCsv(`税理士相談用 貸借対照表 ${pkg.header.fiscalYearLabel}`, pkg.etax.balanceSheet)

export const buildTaxAdvisorExpensesCsv = (pkg: TaxAdvisorPackage) =>
  buildExpensesCsv(pkg.fiscalYearExpenses, pkg.fiscalYearEndYearMonth).replace(
    '経費一覧',
    `税理士相談用 経費一覧 ${pkg.header.fiscalYearLabel}`,
  )

export const buildTaxAdvisorReceiptsCsv = (pkg: TaxAdvisorPackage) =>
  buildAllReceiptsCsv(pkg.fiscalYearReceipts).replace('領収書一覧', `税理士相談用 領収書一覧 ${pkg.header.fiscalYearLabel}`)

export const buildTaxAdvisorFixedCostsCsv = (pkg: TaxAdvisorPackage) =>
  withBom(
    [
      csvLine([`税理士相談用 固定費一覧 ${pkg.header.fiscalYearLabel}`]),
      csvLine(['固定費名', '勘定科目', '月額(円)', '会計年度合計(円)', '開始月', '終了月', '状態']),
      ...pkg.fixedCostRows.map((row) =>
        csvLine([
          row.fixedCostName,
          row.expenseCategory,
          row.monthlyAmountYen,
          row.fiscalYearTotalYen,
          row.startYearMonth,
          row.endYearMonth,
          row.status,
        ]),
      ),
    ].join(CSV_EOL),
  )

export const buildTaxAdvisorFixedAssetsCsv = (pkg: TaxAdvisorPackage) =>
  buildFixedAssetsCsv(
    pkg.ledgerAssets.map((asset) => ({
      purchaseDate: asset.purchaseDate,
      useStartDate: asset.useStartDate,
      assetName: asset.assetName,
      assetCategory: asset.assetCategory,
      condition: asset.condition,
      firstRegistrationYearMonth: asset.firstRegistrationYearMonth,
      acquisitionCost: asset.acquisitionCost,
      standardUsefulLifeYears: asset.standardUsefulLifeYears,
      appliedUsefulLifeYears: asset.appliedUsefulLifeYears,
      monthlyDepreciationYen: asset.monthlyDepreciationYen,
      depreciationStartYearMonth: asset.depreciationStartYearMonth,
      depreciationEndYearMonth: asset.depreciationEndYearMonth,
      remainingBookValue: asset.remainingBookValue,
      status: formatLedgerAssetStatus(asset.status),
      notes: asset.notes,
    })),
  ).replace('固定資産台帳', `税理士相談用 固定資産台帳 ${pkg.header.fiscalYearLabel}`)

export const buildTaxAdvisorDepreciationCsv = (pkg: TaxAdvisorPackage) =>
  buildDepreciationCsv(pkg.depreciationRows).replace('減価償却一覧', `税理士相談用 減価償却明細 ${pkg.header.fiscalYearLabel}`)

export const buildTaxAdvisorSmallAssetsCsv = (pkg: TaxAdvisorPackage) =>
  buildSmallAssetsCsv(
    pkg.smallAssets.map((asset) => ({
      purchaseDate: asset.purchaseDate,
      useStartDate: asset.useStartDate,
      assetName: asset.assetName,
      assetCategory: asset.assetCategory,
      acquisitionCost: asset.acquisitionCost,
      plPostingYearMonth: asset.depreciationStartYearMonth,
      notes: asset.notes,
    })),
  ).replace('少額資産一覧', `税理士相談用 少額資産明細 ${pkg.header.fiscalYearLabel}`)

export const buildTaxAdvisorAccountBreakdownCsv = (pkg: TaxAdvisorPackage) =>
  reportLinesToCsv(
    `税理士相談用 勘定科目内訳明細 ${pkg.header.fiscalYearLabel}`,
    pkg.etax.accountBreakdown,
  )

export const buildTaxAdvisorConsumptionTaxCsv = (pkg: TaxAdvisorPackage) =>
  reportLinesToCsv(`税理士相談用 消費税集計 ${pkg.header.fiscalYearLabel}`, pkg.etax.consumptionTax)

export const buildTaxAdvisorChecklistCsv = (pkg: TaxAdvisorPackage) =>
  withBom(
    [
      csvLine([`税理士相談用 要確認リスト ${pkg.header.fiscalYearLabel}`]),
      csvLine(['区分', '確認事項', '詳細']),
      ...pkg.reviewItems.map((item) => csvLine([item.category, item.label, item.detail ?? ''])),
      csvLine([]),
      csvLine(['入力状況チェック']),
      csvLine(['区分', '項目', '状態', '詳細']),
      ...pkg.etax.checkItems.map((item) =>
        csvLine([item.category, item.label, formatETaxCheckItemStatus(item.status), item.detail ?? '']),
      ),
    ].join(CSV_EOL),
  )

export const buildTaxAdvisorBulkCsvBundle = (pkg: TaxAdvisorPackage) => {
  const year = pkg.header.targetYear
  return [
    { fileName: `tax-advisor-summary-${year}.csv`, content: buildTaxAdvisorSummaryCsv(pkg) },
    { fileName: `tax-advisor-pl-${year}.csv`, content: buildTaxAdvisorPlCsv(pkg) },
    { fileName: `tax-advisor-bs-${year}.csv`, content: buildTaxAdvisorBsCsv(pkg) },
    { fileName: `tax-advisor-expenses-${year}.csv`, content: buildTaxAdvisorExpensesCsv(pkg) },
    { fileName: `tax-advisor-receipts-${year}.csv`, content: buildTaxAdvisorReceiptsCsv(pkg) },
    { fileName: `tax-advisor-fixed-costs-${year}.csv`, content: buildTaxAdvisorFixedCostsCsv(pkg) },
    { fileName: `tax-advisor-fixed-assets-${year}.csv`, content: buildTaxAdvisorFixedAssetsCsv(pkg) },
    { fileName: `tax-advisor-depreciation-${year}.csv`, content: buildTaxAdvisorDepreciationCsv(pkg) },
    { fileName: `tax-advisor-small-assets-${year}.csv`, content: buildTaxAdvisorSmallAssetsCsv(pkg) },
    { fileName: `tax-advisor-account-breakdown-${year}.csv`, content: buildTaxAdvisorAccountBreakdownCsv(pkg) },
    { fileName: `tax-advisor-consumption-tax-${year}.csv`, content: buildTaxAdvisorConsumptionTaxCsv(pkg) },
    { fileName: `tax-advisor-checklist-${year}.csv`, content: buildTaxAdvisorChecklistCsv(pkg) },
  ]
}

export function exportTaxAdvisorBulkCsv(pkg: TaxAdvisorPackage) {
  const files = buildTaxAdvisorBulkCsvBundle(pkg)
  files.forEach(({ fileName, content }) => downloadCsvFile(fileName, content.replace(/^\uFEFF/, '')))
  return files.map((file) => file.fileName)
}

type PdfSection = {
  title: string
  headers: string[]
  rows: string[][]
  orientation?: 'portrait' | 'landscape'
}

const truncate = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value

const plPdfRows = (pkg: TaxAdvisorPackage) => {
  const pl = pkg.pl
  const rows: string[][] = []
  SALES_CATEGORIES.forEach((category) => {
    if (pl.sales[category] > 0) {
      rows.push(['売上', category, String(pl.sales[category])])
    }
  })
  rows.push(['売上', '売上高', String(pl.salesTotalYen)])
  COST_OF_SALES_CATEGORIES.forEach((category) => {
    if (pl.costOfSales[category] > 0) {
      rows.push(['売上原価', category, String(pl.costOfSales[category])])
    }
  })
  rows.push(['売上原価', '合計', String(pl.costOfSalesTotalYen)])
  rows.push(['利益', '売上総利益', String(pl.grossProfitYen)])
  FIXED_EXPENSE_CATEGORIES.forEach((category) => {
    if (pl.fixedCosts[category] > 0) {
      rows.push(['販売管理費', category, String(pl.fixedCosts[category])])
    }
  })
  VARIABLE_EXPENSE_CATEGORIES.forEach((category) => {
    if (pl.variableExpenses[category] > 0) {
      rows.push(['販売管理費', category, String(pl.variableExpenses[category])])
    }
  })
  rows.push(['利益', '営業利益', String(pl.operatingProfitYen)])
  return rows
}

const linesToPdfRows = (lines: Array<{ label: string; displayValue: string; amountYen?: number | null }>) =>
  lines.map((row) => [row.label, row.displayValue, row.amountYen != null ? String(row.amountYen) : ''])

const buildPackagePdfSections = (pkg: TaxAdvisorPackage): PdfSection[] => [
  {
    title: '決算サマリー',
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.etax.summary),
    orientation: 'portrait',
  },
  {
    title: '損益計算書（PL）',
    headers: ['区分', '科目', '金額(円)'],
    rows: plPdfRows(pkg),
    orientation: 'portrait',
  },
  {
    title: '貸借対照表（BS）',
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.etax.balanceSheet),
    orientation: 'portrait',
  },
  {
    title: '経費一覧',
    headers: ['日付', '取引先', '内容', '科目', '金額', '備考'],
    rows: pkg.fiscalYearExpenses.map((expense) => [
      getExpensePostingDate(expense),
      expense.vendorName,
      expense.description,
      expense.expenseCategory,
      String(expense.taxIncludedAmount),
      [expense.memo, expense.normalExpenseOverrideReason].filter(Boolean).join(' / '),
    ]),
    orientation: 'landscape',
  },
  {
    title: '領収書一覧',
    headers: ['証憑日', '取引先候補', '金額候補', '経費登録済み', '画像'],
    rows: pkg.fiscalYearReceipts.map((receipt) => [
      receipt.receiptDate ?? '',
      receipt.vendorNameCandidate ?? '',
      receipt.amountTotalCandidate != null ? String(receipt.amountTotalCandidate) : '',
      receipt.linkedExpenseId ? 'はい' : 'いいえ',
      receipt.downloadUrl || receipt.imageUrl ? '有' : '無',
    ]),
    orientation: 'landscape',
  },
  {
    title: '固定費一覧',
    headers: ['固定費名', '勘定科目', '月額', '年度合計', '開始月', '終了月'],
    rows: pkg.fixedCostRows.map((row) => [
      row.fixedCostName,
      row.expenseCategory,
      String(row.monthlyAmountYen),
      String(row.fiscalYearTotalYen),
      row.startYearMonth,
      row.endYearMonth,
    ]),
    orientation: 'landscape',
  },
  {
    title: '固定資産台帳',
    headers: ['購入日', '資産名', '区分', '取得価額', '耐用年数', '月額償却', '残高'],
    rows: pkg.ledgerAssets.map((asset) => [
      asset.purchaseDate,
      asset.assetName,
      asset.assetCategory,
      formatFareYen(asset.acquisitionCost),
      String(asset.appliedUsefulLifeYears),
      formatFareYen(asset.monthlyDepreciationYen),
      formatFareYen(asset.remainingBookValue),
    ]),
    orientation: 'landscape',
  },
  {
    title: '減価償却明細',
    headers: ['対象月', '資産名', '区分', '当月償却', '累計', '残高'],
    rows: pkg.depreciationRows.map((row) => [
      row.targetYearMonth,
      row.assetName,
      row.assetCategory,
      String(row.depreciationYen),
      String(row.cumulativeDepreciationYen),
      String(row.remainingBookValue),
    ]),
    orientation: 'landscape',
  },
  {
    title: '少額資産明細',
    headers: ['購入日', '資産名', '取得価額', 'PL反映月', '備考'],
    rows: pkg.smallAssets.map((asset) => [
      asset.purchaseDate,
      asset.assetName,
      formatFareYen(asset.acquisitionCost),
      asset.depreciationStartYearMonth,
      asset.notes || '―',
    ]),
    orientation: 'landscape',
  },
  {
    title: '勘定科目内訳明細',
    headers: ['科目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.etax.accountBreakdown),
    orientation: 'portrait',
  },
  {
    title: '法人事業概況説明書用資料',
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.etax.businessOverview),
    orientation: 'portrait',
  },
  {
    title: '消費税集計',
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.etax.consumptionTax),
    orientation: 'portrait',
  },
  {
    title: '入力状況チェック',
    headers: ['区分', '項目', '状態', '詳細'],
    rows: pkg.etax.checkItems.map((item) => [
      item.category,
      item.label,
      formatETaxCheckItemStatus(item.status),
      item.detail ?? '',
    ]),
    orientation: 'landscape',
  },
  {
    title: '要確認リスト',
    headers: ['区分', '確認事項', '詳細'],
    rows:
      pkg.reviewItems.length > 0
        ? pkg.reviewItems.map((item) => [item.category, item.label, item.detail ?? ''])
        : [['―', '確認事項はありません', '']],
    orientation: 'portrait',
  },
]

const appendTableSection = (
  pdf: import('jspdf').jsPDF,
  section: PdfSection,
  margin: number,
  headerHeight: number,
  rowHeight: number,
) => {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const columnCount = section.headers.length
  const columnWidth = (pageWidth - margin * 2) / columnCount
  let y = margin

  const addPageHeader = () => {
    pdf.setFontSize(13)
    pdf.text(section.title, margin, y)
    y += 8
    pdf.setFontSize(8)
    section.headers.forEach((header, index) => {
      pdf.text(truncate(header, 18), margin + index * columnWidth + 1, y)
    })
    y += headerHeight
  }

  addPageHeader()

  section.rows.forEach((row) => {
    if (y > pageHeight - margin - rowHeight) {
      pdf.addPage()
      y = margin
      addPageHeader()
    }

    row.forEach((cell, index) => {
      pdf.text(truncate(String(cell), 22), margin + index * columnWidth + 1, y)
    })
    y += rowHeight
  })
}

const buildTaxAdvisorPackagePdfDocument = async (pkg: TaxAdvisorPackage) => {
  const { jsPDF } = await import('jspdf')
  const sections = buildPackagePdfSections(pkg)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const margin = 10
  const headerHeight = 8
  const rowHeight = 6

  pdf.setFontSize(16)
  pdf.text('税理士相談用 一式資料', margin, 20)
  pdf.setFontSize(11)
  pdf.text(`対象年度: ${pkg.header.targetYear}年度`, margin, 32)
  pdf.text(`会計年度: ${pkg.header.fiscalYearLabel}`, margin, 40)
  pdf.text(`会社名: ${pkg.header.companyName}`, margin, 48)
  pdf.text(`店舗名: ${pkg.header.storeName}`, margin, 56)
  pdf.text(`作成日: ${pkg.header.createdDate}`, margin, 64)
  pdf.text('目的: 税理士相談・申告前確認用の根拠資料一式', margin, 72)

  pdf.addPage()
  pdf.setFontSize(14)
  pdf.text('目次', margin, 20)
  pdf.setFontSize(10)
  let tocY = 30
  sections.forEach((section, index) => {
    pdf.text(`${index + 1}. ${section.title}`, margin, tocY)
    tocY += 7
    if (tocY > 280) {
      pdf.addPage()
      tocY = 20
    }
  })

  sections.forEach((section) => {
    pdf.addPage()
    appendTableSection(pdf, section, margin, headerHeight, rowHeight)
  })

  return pdf
}

/** ZIP / programmatic use — PDF Blob without download. */
export async function buildTaxAdvisorPackagePdfBlob(pkg: TaxAdvisorPackage): Promise<Blob> {
  const pdf = await buildTaxAdvisorPackagePdfDocument(pkg)
  const output = pdf.output('blob')
  return output instanceof Blob ? output : new Blob([output], { type: 'application/pdf' })
}

export async function exportTaxAdvisorPackagePdf(pkg: TaxAdvisorPackage) {
  const fileName = `tax-advisor-package-${pkg.header.targetYear}.pdf`
  const pdf = await buildTaxAdvisorPackagePdfDocument(pkg)
  pdf.save(fileName)
  return fileName
}

export async function downloadTaxAdvisorPackagePdf(pkg: TaxAdvisorPackage) {
  return exportTaxAdvisorPackagePdf(pkg)
}
