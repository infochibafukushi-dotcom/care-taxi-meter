import { formatETaxCheckItemStatus } from './accountingETaxData'
import type { ETaxExportableSectionId, ETaxPackage, ETaxReportLine } from '../types/accountingETax'
import {
  COST_OF_SALES_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../types/accounting'
import { downloadCsvFile } from './accountingCsv'
import { downloadAuditLinePdf, downloadAuditTablePdf } from './accountingAuditPdf'
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

const withBom = (content: string) => `\uFEFF${content}`

const reportLinesToCsv = (title: string, lines: ETaxReportLine[]) =>
  withBom(
    [
      csvLine([title]),
      csvLine(['mappingId', '項目', '値', '金額(円)', '状態']),
      ...lines.map((row) =>
        csvLine([row.mappingId, row.label, row.displayValue, row.amountYen ?? '', row.status]),
      ),
    ].join(CSV_EOL),
  )

const buildPlCsv = (pkg: ETaxPackage) => {
  const pl = pkg.pl
  const lines = [
    csvLine(['e-Tax入力用 損益計算書', pkg.company.fiscalYearLabel]),
    csvLine(['mappingId', '区分', '科目', '金額(円)']),
  ]

  SALES_CATEGORIES.forEach((category) => {
    if (pl.sales[category] > 0) {
      lines.push(csvLine([`etax.pl.sales.${category}`, '売上', category, pl.sales[category]]))
    }
  })
  lines.push(csvLine(['etax.pl.salesTotal', '売上', '売上高', pl.salesTotalYen]))

  COST_OF_SALES_CATEGORIES.forEach((category) => {
    if (pl.costOfSales[category] > 0) {
      lines.push(csvLine([`etax.pl.cogs.${category}`, '売上原価', category, pl.costOfSales[category]]))
    }
  })
  lines.push(csvLine(['etax.pl.cogsTotal', '売上原価', '売上原価合計', pl.costOfSalesTotalYen]))
  lines.push(csvLine(['etax.pl.grossProfit', '利益', '売上総利益', pl.grossProfitYen]))

  FIXED_EXPENSE_CATEGORIES.forEach((category) => {
    if (pl.fixedCosts[category] > 0) {
      lines.push(csvLine([`etax.pl.fixed.${category}`, '販売管理費', category, pl.fixedCosts[category]]))
    }
  })

  VARIABLE_EXPENSE_CATEGORIES.forEach((category) => {
    if (pl.variableExpenses[category] > 0) {
      lines.push(csvLine([`etax.pl.variable.${category}`, '販売管理費', category, pl.variableExpenses[category]]))
    }
  })

  lines.push(csvLine(['etax.pl.operatingProfit', '利益', '営業利益', pl.operatingProfitYen]))
  return withBom(lines.join(CSV_EOL))
}

export const buildETaxSummaryCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 決算サマリー ${pkg.company.fiscalYearLabel}`, pkg.summary)

export const buildETaxPlCsv = (pkg: ETaxPackage) => buildPlCsv(pkg)

export const buildETaxBalanceSheetCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 貸借対照表 ${pkg.company.fiscalYearLabel}`, pkg.balanceSheet)

export const buildETaxBsInputCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 BS入力 ${pkg.company.fiscalYearLabel}`, pkg.bsInput)

export const buildETaxAuxiliaryDataCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 決算補助データ ${pkg.company.fiscalYearLabel}`, pkg.auxiliaryDataLines)

export const buildETaxAccountBreakdownDetailCsv = (pkg: ETaxPackage) => {
  const lines = [
    csvLine([`e-Tax入力用 勘定科目内訳明細書 ${pkg.company.fiscalYearLabel}`]),
    csvLine(['sectionId', 'sectionLabel', 'mappingId', ...Array.from({ length: 8 }, (_, index) => `col${index + 1}`)]),
  ]

  pkg.accountBreakdownDetail.forEach((section) => {
    section.rows.forEach((row) => {
      const padded = [...row.values]
      while (padded.length < 8) {
        padded.push('')
      }
      lines.push(
        csvLine([section.sectionId, section.sectionLabel, row.mappingId, ...padded.slice(0, 8)]),
      )
    })
    if (section.rows.length === 0) {
      const emptyLabel = section.emptyStatus === 'na' ? '該当なし' : '未設定'
      lines.push(csvLine([section.sectionId, section.sectionLabel, `${section.mappingIdPrefix}.empty`, emptyLabel]))
    }
  })

  return withBom(lines.join(CSV_EOL))
}

export const buildETaxInputStatusCsv = (pkg: ETaxPackage) =>
  withBom(
    [
      csvLine([`e-Tax入力用 入力状況 ${pkg.company.fiscalYearLabel}`]),
      csvLine(['mappingId', '区分', '項目', '状態', '詳細']),
      ...pkg.checkItems.map((item) =>
        csvLine([
          item.mappingId,
          item.category,
          item.label,
          formatETaxCheckItemStatus(item.status),
          item.detail ?? '',
        ]),
      ),
    ].join(CSV_EOL),
  )

export const buildETaxFixedAssetsCsv = (pkg: ETaxPackage) =>
  withBom(
    [
      csvLine([`e-Tax入力用 固定資産・減価償却明細 ${pkg.company.fiscalYearLabel}`]),
      csvLine([
        'mappingId',
        '資産名',
        '区分',
        '取得日',
        '取得価額',
        '耐用年数',
        '償却方法',
        '月額償却',
        '年間償却',
        '累計償却',
        '未償却残高',
      ]),
      ...pkg.fixedAssets.map((row) =>
        csvLine([
          row.mappingId,
          row.assetName,
          row.assetCategory,
          row.purchaseDate,
          row.acquisitionCost,
          row.usefulLifeYears,
          row.depreciationMethod,
          row.monthlyDepreciationYen,
          row.annualDepreciationYen,
          row.cumulativeDepreciationYen,
          row.remainingBookValue,
        ]),
      ),
    ].join(CSV_EOL),
  )

export const buildETaxSmallAssetsCsv = (pkg: ETaxPackage) =>
  withBom(
    [
      csvLine([`e-Tax入力用 少額資産明細 ${pkg.company.fiscalYearLabel}`]),
      csvLine(['mappingId', '購入日', '資産名', '取得価額', '処理方法', 'PL反映月', '備考']),
      ...pkg.smallAssets.map((row) =>
        csvLine([
          row.mappingId,
          row.purchaseDate,
          row.assetName,
          row.acquisitionCost,
          row.treatment,
          row.plPostingYearMonth,
          row.notes,
        ]),
      ),
    ].join(CSV_EOL),
  )

export const buildETaxAccountBreakdownCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 勘定科目内訳明細 ${pkg.company.fiscalYearLabel}`, pkg.accountBreakdown)

export const buildETaxBusinessOverviewCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 法人事業概況説明書 ${pkg.company.fiscalYearLabel}`, pkg.businessOverview)

export const buildETaxConsumptionTaxCsv = (pkg: ETaxPackage) =>
  reportLinesToCsv(`e-Tax入力用 消費税集計 ${pkg.company.fiscalYearLabel}`, pkg.consumptionTax)

export const buildETaxBulkCsvBundle = (pkg: ETaxPackage) => [
  { fileName: `etax-auxiliary-${pkg.company.targetYear}.csv`, content: buildETaxAuxiliaryDataCsv(pkg) },
  { fileName: `etax-bs-input-${pkg.company.targetYear}.csv`, content: buildETaxBsInputCsv(pkg) },
  { fileName: `etax-account-breakdown-detail-${pkg.company.targetYear}.csv`, content: buildETaxAccountBreakdownDetailCsv(pkg) },
  { fileName: `etax-summary-${pkg.company.targetYear}.csv`, content: buildETaxSummaryCsv(pkg) },
  { fileName: `etax-pl-${pkg.company.targetYear}.csv`, content: buildETaxPlCsv(pkg) },
  { fileName: `etax-bs-${pkg.company.targetYear}.csv`, content: buildETaxBalanceSheetCsv(pkg) },
  { fileName: `etax-fixed-assets-${pkg.company.targetYear}.csv`, content: buildETaxFixedAssetsCsv(pkg) },
  { fileName: `etax-small-assets-${pkg.company.targetYear}.csv`, content: buildETaxSmallAssetsCsv(pkg) },
  { fileName: `etax-account-breakdown-${pkg.company.targetYear}.csv`, content: buildETaxAccountBreakdownCsv(pkg) },
  { fileName: `etax-business-overview-${pkg.company.targetYear}.csv`, content: buildETaxBusinessOverviewCsv(pkg) },
  { fileName: `etax-consumption-tax-${pkg.company.targetYear}.csv`, content: buildETaxConsumptionTaxCsv(pkg) },
  { fileName: `etax-input-status-${pkg.company.targetYear}.csv`, content: buildETaxInputStatusCsv(pkg) },
]

const plPdfRows = (pkg: ETaxPackage) => {
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

const linesToPdfRows = (lines: ETaxReportLine[]) =>
  lines.map((row) => [row.label, row.displayValue, row.amountYen != null ? String(row.amountYen) : ''])

export async function exportETaxSummaryPdf(pkg: ETaxPackage) {
  const fileName = `etax-summary-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `決算サマリー ${pkg.company.fiscalYearLabel}`,
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.summary),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxPlPdf(pkg: ETaxPackage) {
  const fileName = `etax-pl-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `損益計算書 ${pkg.company.fiscalYearLabel}`,
    headers: ['区分', '科目', '金額(円)'],
    rows: plPdfRows(pkg),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxBalanceSheetPdf(pkg: ETaxPackage) {
  const fileName = `etax-bs-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `貸借対照表 ${pkg.company.fiscalYearLabel}`,
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.balanceSheet),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxBsInputPdf(pkg: ETaxPackage) {
  const fileName = `etax-bs-input-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `BS入力用 ${pkg.company.fiscalYearLabel}`,
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.bsInput),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxAuxiliaryDataPdf(pkg: ETaxPackage) {
  const fileName = `etax-auxiliary-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `決算補助データ ${pkg.company.fiscalYearLabel}`,
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.auxiliaryDataLines),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxFixedAssetsPdf(pkg: ETaxPackage) {
  const fileName = `etax-fixed-assets-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `固定資産・減価償却明細 ${pkg.company.fiscalYearLabel}`,
    headers: ['資産名', '区分', '取得価額', '月額', '累計', '残高'],
    rows: pkg.fixedAssets.map((row) => [
      row.assetName,
      row.assetCategory,
      formatFareYen(row.acquisitionCost),
      formatFareYen(row.monthlyDepreciationYen),
      formatFareYen(row.cumulativeDepreciationYen),
      formatFareYen(row.remainingBookValue),
    ]),
    orientation: 'landscape',
  })
  return fileName
}

export async function exportETaxSmallAssetsPdf(pkg: ETaxPackage) {
  const fileName = `etax-small-assets-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `少額資産明細 ${pkg.company.fiscalYearLabel}`,
    headers: ['購入日', '資産名', '取得価額', 'PL反映月', '備考'],
    rows: pkg.smallAssets.map((row) => [
      row.purchaseDate,
      row.assetName,
      formatFareYen(row.acquisitionCost),
      row.plPostingYearMonth,
      row.notes || '―',
    ]),
    orientation: 'landscape',
  })
  return fileName
}

export async function exportETaxAccountBreakdownPdf(pkg: ETaxPackage) {
  const fileName = `etax-account-breakdown-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `勘定科目内訳明細 ${pkg.company.fiscalYearLabel}`,
    headers: ['科目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.accountBreakdown),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxAccountBreakdownDetailPdf(pkg: ETaxPackage) {
  const fileName = `etax-account-breakdown-detail-${pkg.company.targetYear}.pdf`
  const rows: string[][] = []
  pkg.accountBreakdownDetail.forEach((section) => {
    rows.push([section.sectionLabel, '', ''])
    if (section.rows.length === 0) {
      rows.push(['（データなし）', '未設定', ''])
      return
    }
    section.rows.forEach((row) => {
      rows.push([row.mappingId, row.values.join(' / '), ''])
    })
  })
  await downloadAuditTablePdf({
    fileName,
    title: `勘定科目内訳明細書用資料 ${pkg.company.fiscalYearLabel}`,
    headers: ['区分/項目', '内容', ''],
    rows,
    orientation: 'landscape',
  })
  return fileName
}

export async function exportETaxBusinessOverviewPdf(pkg: ETaxPackage) {
  const fileName = `etax-business-overview-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `法人事業概況説明書用資料 ${pkg.company.fiscalYearLabel}`,
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.businessOverview),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxConsumptionTaxPdf(pkg: ETaxPackage) {
  const fileName = `etax-consumption-tax-${pkg.company.targetYear}.pdf`
  await downloadAuditTablePdf({
    fileName,
    title: `消費税集計 ${pkg.company.fiscalYearLabel}`,
    headers: ['項目', '値', '金額(円)'],
    rows: linesToPdfRows(pkg.consumptionTax),
    orientation: 'portrait',
  })
  return fileName
}

export async function exportETaxBulkPdf(pkg: ETaxPackage) {
  const files = [
    await exportETaxAuxiliaryDataPdf(pkg),
    await exportETaxBsInputPdf(pkg),
    await exportETaxAccountBreakdownDetailPdf(pkg),
    await exportETaxSummaryPdf(pkg),
    await exportETaxPlPdf(pkg),
    await exportETaxBalanceSheetPdf(pkg),
    await exportETaxFixedAssetsPdf(pkg),
    await exportETaxSmallAssetsPdf(pkg),
    await exportETaxAccountBreakdownPdf(pkg),
    await exportETaxBusinessOverviewPdf(pkg),
    await exportETaxConsumptionTaxPdf(pkg),
  ]
  return files
}

export function exportETaxBulkCsv(pkg: ETaxPackage) {
  const files = buildETaxBulkCsvBundle(pkg)
  files.forEach(({ fileName, content }) => downloadCsvFile(fileName, content.replace(/^\uFEFF/, '')))
  return files.map((file) => file.fileName)
}

export async function exportETaxSectionPdf(section: ETaxExportableSectionId, pkg: ETaxPackage) {
  switch (section) {
    case 'summary':
      return exportETaxSummaryPdf(pkg)
    case 'pl':
      return exportETaxPlPdf(pkg)
    case 'bs':
      return exportETaxBalanceSheetPdf(pkg)
    case 'bs-input':
      return exportETaxBsInputPdf(pkg)
    case 'fixed-assets':
      return exportETaxFixedAssetsPdf(pkg)
    case 'small-assets':
      return exportETaxSmallAssetsPdf(pkg)
    case 'account-breakdown':
      return exportETaxAccountBreakdownPdf(pkg)
    case 'account-breakdown-detail':
      return exportETaxAccountBreakdownDetailPdf(pkg)
    case 'business-overview':
      return exportETaxBusinessOverviewPdf(pkg)
    case 'consumption-tax':
      return exportETaxConsumptionTaxPdf(pkg)
    case 'auxiliary-data':
      return exportETaxAuxiliaryDataPdf(pkg)
    default:
      return ''
  }
}

export function exportETaxSectionCsv(section: ETaxExportableSectionId, pkg: ETaxPackage) {
  const builders: Record<string, (p: ETaxPackage) => string> = {
    summary: buildETaxSummaryCsv,
    pl: buildETaxPlCsv,
    bs: buildETaxBalanceSheetCsv,
    'bs-input': buildETaxBsInputCsv,
    'fixed-assets': buildETaxFixedAssetsCsv,
    'small-assets': buildETaxSmallAssetsCsv,
    'account-breakdown': buildETaxAccountBreakdownCsv,
    'account-breakdown-detail': buildETaxAccountBreakdownDetailCsv,
    'business-overview': buildETaxBusinessOverviewCsv,
    'consumption-tax': buildETaxConsumptionTaxCsv,
    'auxiliary-data': buildETaxAuxiliaryDataCsv,
    'input-status': buildETaxInputStatusCsv,
  }
  const build = builders[section]
  if (!build) {
    return ''
  }
  const fileName = `etax-${section}-${pkg.company.targetYear}.csv`
  downloadCsvFile(fileName, build(pkg).replace(/^\uFEFF/, ''))
  return fileName
}

export async function exportETaxCoverPdf(pkg: ETaxPackage) {
  const fileName = `etax-index-${pkg.company.targetYear}.pdf`
  await downloadAuditLinePdf(fileName, `e-Tax入力用決算資料 ${pkg.company.fiscalYearLabel}`, [
    `会社名: ${pkg.company.companyName}`,
    `法人番号: ${pkg.company.corporateNumber}`,
    `会計年度: ${pkg.company.fiscalYearLabel}`,
    '',
    'この資料はe-Tax/eLTAXへの転記用です。申告書の自動作成機能ではありません。',
  ])
  return fileName
}
