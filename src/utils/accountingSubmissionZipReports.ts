import type { TaxAdvisorPackage } from '../types/accountingTaxAdvisor'
import type { FilingCheckSummary } from '../types/accountingFilingCheck'
import type { FiscalPeriod } from '../types/accountingFiscalPeriod'
import type { StoredCaseRecord } from '../services/caseRecords'
import { buildAuditTablePdfBlob } from './accountingAuditPdf'
import { buildSalesCsv } from './accountingCsv'
import { buildAccountingSalesRows } from './accountingSalesMapping'
import { getFiscalPeriodMonths } from './accountingFiscalPeriod'
import { formatFareYen } from '../services/fare'
import {
  buildTaxAdvisorAccountBreakdownCsv,
  buildTaxAdvisorExpensesCsv,
} from './accountingTaxAdvisorExport'
import { escapeSpreadsheetFormula } from './accountingSubmissionPackage'
import {
  COST_OF_SALES_CATEGORIES,
  FIXED_EXPENSE_CATEGORIES,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../types/accounting'

export type SubmissionReportFile = {
  relativePath: string
  blob: Blob
  required: boolean
}

const csvBlob = (content: string): Blob =>
  new Blob([content], { type: 'text/csv;charset=utf-8' })

const CSV_EOL = '\r\n'

const escapeCsv = (value: string | number) => {
  const stringValue = typeof value === 'string' ? escapeSpreadsheetFormula(value) : String(value)
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue
  }
  return `"${stringValue.replaceAll('"', '""')}"`
}

const csvLine = (values: Array<string | number>) => values.map(escapeCsv).join(',')

/** Public ZIP receipts CSV — no download URLs / storage paths / Firestore ids */
const buildPublicReceiptsCsvForZip = (pkg: TaxAdvisorPackage): string => {
  const lines = [
    csvLine([`領収書一覧 ${pkg.header.fiscalYearLabel}`]),
    csvLine(['証憑日', '取引先候補', '金額候補', '経費登録済み', '原本あり']),
    ...pkg.fiscalYearReceipts.map((receipt) =>
      csvLine([
        receipt.receiptDate ?? '',
        receipt.vendorNameCandidate ?? receipt.confirmed?.vendorName ?? '',
        receipt.amountTotalCandidate ?? receipt.confirmed?.amount ?? '',
        receipt.linkedExpenseId ? 'はい' : 'いいえ',
        receipt.originalStoragePath || receipt.storagePath || receipt.downloadUrl || receipt.originalDownloadUrl
          ? 'はい'
          : 'いいえ',
      ]),
    ),
  ]
  return `\uFEFF${lines.join(CSV_EOL)}${CSV_EOL}`
}

const linesToPdfRows = (
  lines: Array<{ label: string; displayValue: string; amountYen?: number | null }>,
) => lines.map((row) => [row.label, row.displayValue, row.amountYen != null ? String(row.amountYen) : ''])

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

const buildFiscalSalesCsv = (caseRecords: StoredCaseRecord[], fiscalPeriod: FiscalPeriod): string => {
  const months = new Set(getFiscalPeriodMonths(fiscalPeriod))
  const filtered = caseRecords.filter((record) => {
    const month = (record.caseDate || record.closedAt || '').slice(0, 7)
    return Boolean(month) && months.has(month)
  })
  const rows = buildAccountingSalesRows(filtered)
  return buildSalesCsv(rows, fiscalPeriod.endYearMonth)
}

/**
 * Build ZIP report/CSV blobs that existing exporters can already produce.
 * Does not invent empty PDFs for unimplemented documents.
 */
export async function buildSubmissionZipReportFiles(input: {
  taxAdvisorPackage: TaxAdvisorPackage
  fiscalPeriod: FiscalPeriod
  caseRecords: StoredCaseRecord[]
  filingSummary: FilingCheckSummary
  catalogCsv: string
  missingVoucherCsv: string
  unlinkedVoucherCsv?: string
}): Promise<SubmissionReportFile[]> {
  const { taxAdvisorPackage: tip } = input
  const files: SubmissionReportFile[] = []

  files.push({
    relativePath: '00_資料一覧.csv',
    blob: csvBlob(input.catalogCsv),
    required: true,
  })

  files.push({
    relativePath: '01_決算サマリー.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `決算サマリー ${tip.header.fiscalYearLabel}`,
      headers: ['項目', '値', '金額(円)'],
      rows: linesToPdfRows(tip.etax.summary),
      orientation: 'portrait',
    }),
    required: false,
  })

  files.push({
    relativePath: '02_損益計算書.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `損益計算書 ${tip.header.fiscalYearLabel}`,
      headers: ['区分', '科目', '金額(円)'],
      rows: plPdfRows(tip),
      orientation: 'portrait',
    }),
    required: false,
  })

  files.push({
    relativePath: '03_貸借対照表.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `貸借対照表 ${tip.header.fiscalYearLabel}`,
      headers: ['項目', '値', '金額(円)'],
      rows: linesToPdfRows(tip.etax.balanceSheet),
      orientation: 'portrait',
    }),
    required: false,
  })

  files.push({
    relativePath: '04_売上一覧.csv',
    blob: csvBlob(buildFiscalSalesCsv(input.caseRecords, input.fiscalPeriod)),
    required: false,
  })

  files.push({
    relativePath: '05_経費一覧.csv',
    blob: csvBlob(buildTaxAdvisorExpensesCsv(tip)),
    required: false,
  })

  files.push({
    relativePath: '06_領収書一覧.csv',
    blob: csvBlob(buildPublicReceiptsCsvForZip(tip)),
    required: false,
  })

  files.push({
    relativePath: '07_固定資産台帳.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `固定資産台帳 ${tip.header.fiscalYearLabel}`,
      headers: ['購入日', '資産名', '区分', '取得価額', '耐用年数', '月額償却', '残高'],
      rows: tip.ledgerAssets.map((asset) => [
        asset.purchaseDate,
        asset.assetName,
        asset.assetCategory,
        formatFareYen(asset.acquisitionCost),
        String(asset.appliedUsefulLifeYears),
        formatFareYen(asset.monthlyDepreciationYen),
        formatFareYen(asset.remainingBookValue),
      ]),
      orientation: 'landscape',
    }),
    required: false,
  })

  files.push({
    relativePath: '08_減価償却明細.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `減価償却明細 ${tip.header.fiscalYearLabel}`,
      headers: ['対象月', '資産名', '区分', '当月償却', '累計', '残高'],
      rows: tip.depreciationRows.map((row) => [
        row.targetYearMonth,
        row.assetName,
        row.assetCategory,
        String(row.depreciationYen),
        String(row.cumulativeDepreciationYen),
        String(row.remainingBookValue),
      ]),
      orientation: 'landscape',
    }),
    required: false,
  })

  files.push({
    relativePath: '09_消費税集計.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `消費税集計 ${tip.header.fiscalYearLabel}`,
      headers: ['項目', '値', '金額(円)'],
      rows: linesToPdfRows(tip.etax.consumptionTax),
      orientation: 'portrait',
    }),
    required: false,
  })

  files.push({
    relativePath: '10_勘定科目内訳.csv',
    blob: csvBlob(buildTaxAdvisorAccountBreakdownCsv(tip)),
    required: false,
  })

  files.push({
    relativePath: '11_申告前チェック.pdf',
    blob: await buildAuditTablePdfBlob({
      title: `申告前チェック ${tip.header.fiscalYearLabel}`,
      headers: ['区分', '項目', '状態', '詳細'],
      rows: input.filingSummary.items.map((item) => [
        item.category,
        item.label,
        item.status,
        item.summary ?? item.detail ?? '',
      ]),
      orientation: 'landscape',
    }),
    required: false,
  })

  files.push({
    relativePath: '12_不足証憑一覧.csv',
    blob: csvBlob(input.missingVoucherCsv),
    required: true,
  })

  if (input.unlinkedVoucherCsv) {
    files.push({
      relativePath: '未紐付け一覧.csv',
      blob: csvBlob(input.unlinkedVoucherCsv),
      required: false,
    })
  }

  return files
}
