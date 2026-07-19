import { useMemo } from 'react'
import type { StoredAccountingExpense } from '../../types/accounting'
import type { StoredAccountingFixedAsset } from '../../types/accountingFixedAssets'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import type { MonthlyProfitLoss, YearlyProfitLoss } from '../../types/accounting'
import type { TenantAccessScope } from '../../services/tenancy'
import {
  COST_OF_SALES_CATEGORIES,
  filterReportingExpensesByPostingYearMonth,
  FIXED_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  SALES_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../../types/accounting'
import {
  buildAllReceiptsCsv,
  buildDepreciationCsv,
  buildExpensesCsv,
  buildFixedAssetsCsv,
  buildMonthlyPlCsv,
  buildSmallAssetsCsv,
  buildUnorganizedReceiptsCsv,
  buildYearlyPlCsv,
  buildYearlyPlCsvFileName,
  downloadCsvFile,
} from '../../utils/accountingCsv'
import {
  calculateCumulativeDepreciationYen,
  calculateRemainingBookValue,
  getDepreciationAmountForMonth,
} from '../../utils/accountingDepreciation'
import { downloadAuditLinePdf, downloadAuditTablePdf } from '../../utils/accountingAuditPdf'
import { formatYearMonthLabel } from '../../utils/accountingPl'
import type { AccountingSalesRow } from '../../utils/accountingSalesMapping'
import { FIXED_ASSET_STATUS_LABELS } from '../../types/accountingFixedAssets'
import { InvoiceLookupHistoryPanel } from './InvoiceLookupHistoryPanel'

export type AuditExportType =
  | 'expenses'
  | 'receipts'
  | 'unorganized-receipts'
  | 'small-assets'
  | 'fixed-assets'
  | 'depreciation'
  | 'monthly-pl'
  | 'yearly-pl'
  | 'expenses-pdf'
  | 'fixed-assets-pdf'
  | 'depreciation-pdf'
  | 'monthly-pl-pdf'
  | 'yearly-pl-pdf'

type AuditMaterialsPanelProps = {
  expenses: StoredAccountingExpense[]
  allReceipts: StoredAccountingReceipt[]
  unorganizedReceipts: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  salesRows: AccountingSalesRow[]
  profitLoss: MonthlyProfitLoss
  yearlyProfitLoss: YearlyProfitLoss
  targetYearMonth: string
  targetYear: number
  accessScope: TenantAccessScope
  onExportRecorded: (fileName: string) => void
}

const buildMonthlyPlPdfRows = (profitLoss: MonthlyProfitLoss) => {
  const rows: string[][] = []

  SALES_CATEGORIES.forEach((category) => {
    if (profitLoss.sales[category] > 0) {
      rows.push(['売上', category, String(profitLoss.sales[category])])
    }
  })
  rows.push(['売上', '売上小計', String(profitLoss.salesTotalYen)])

  COST_OF_SALES_CATEGORIES.forEach((category) => {
    if (profitLoss.costOfSales[category] > 0) {
      rows.push(['売上原価', category, String(profitLoss.costOfSales[category])])
    }
  })
  rows.push(['売上原価', '売上原価小計', String(profitLoss.costOfSalesTotalYen)])
  rows.push(['粗利益', '粗利益', String(profitLoss.grossProfitYen)])

  FIXED_EXPENSE_CATEGORIES.forEach((category) => {
    if (profitLoss.fixedCosts[category] > 0) {
      rows.push(['固定費', category, String(profitLoss.fixedCosts[category])])
    }
  })
  rows.push(['固定費', '固定費小計', String(profitLoss.fixedCostsTotalYen)])

  VARIABLE_EXPENSE_CATEGORIES.forEach((category) => {
    if (profitLoss.variableExpenses[category] > 0) {
      rows.push(['変動費', category, String(profitLoss.variableExpenses[category])])
    }
  })
  rows.push(['変動費', '変動費小計', String(profitLoss.variableExpensesTotalYen)])
  rows.push(['利益', '営業利益', String(profitLoss.operatingProfitYen)])

  return rows
}

export function AuditMaterialsPanel({
  expenses,
  allReceipts,
  unorganizedReceipts,
  fixedAssets,
  profitLoss,
  yearlyProfitLoss,
  targetYearMonth,
  targetYear,
  accessScope,
  onExportRecorded,
}: AuditMaterialsPanelProps) {
  const reportingMonthExpenses = useMemo(
    () => filterReportingExpensesByPostingYearMonth(expenses, targetYearMonth),
    [expenses, targetYearMonth],
  )

  const smallAssets = useMemo(
    () => fixedAssets.filter((asset) => asset.assetKind === 'small' && !asset.isDeleted),
    [fixedAssets],
  )

  const ledgerAssets = useMemo(
    () => fixedAssets.filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted),
    [fixedAssets],
  )

  const depreciationRows = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, index) => `${targetYear}-${String(index + 1).padStart(2, '0')}`)
    return months.flatMap((month) =>
      ledgerAssets
        .map((asset) => {
          const depreciationYen = getDepreciationAmountForMonth(asset, month)
          if (depreciationYen <= 0) {
            return null
          }

          return {
            targetYearMonth: month,
            assetName: asset.assetName,
            assetCategory: asset.assetCategory,
            acquisitionCost: asset.acquisitionCost,
            monthlyDepreciationYen: asset.monthlyDepreciationYen,
            depreciationYen,
            cumulativeDepreciationYen: calculateCumulativeDepreciationYen(asset, month),
            remainingBookValue: calculateRemainingBookValue(asset, month),
            plExpenseCategory: '減価償却費',
          }
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
    )
  }, [ledgerAssets, targetYear])

  const handleExport = async (exportType: AuditExportType) => {
    if (exportType === 'expenses') {
      const fileName = `audit-expenses-${targetYearMonth}.csv`
      downloadCsvFile(fileName, buildExpensesCsv(reportingMonthExpenses, targetYearMonth))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'receipts') {
      const fileName = `audit-receipts-${targetYearMonth}.csv`
      downloadCsvFile(fileName, buildAllReceiptsCsv(allReceipts))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'unorganized-receipts') {
      const fileName = `audit-unorganized-receipts-${targetYearMonth}.csv`
      downloadCsvFile(fileName, buildUnorganizedReceiptsCsv(unorganizedReceipts))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'small-assets') {
      const fileName = `audit-small-assets-${targetYear}.csv`
      downloadCsvFile(
        fileName,
        buildSmallAssetsCsv(
          smallAssets.map((asset) => ({
            purchaseDate: asset.purchaseDate,
            useStartDate: asset.useStartDate,
            assetName: asset.assetName,
            assetCategory: asset.assetCategory,
            acquisitionCost: asset.acquisitionCost,
            plPostingYearMonth: asset.depreciationStartYearMonth,
            notes: asset.notes,
          })),
        ),
      )
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'fixed-assets') {
      const fileName = `audit-fixed-assets-${targetYear}.csv`
      downloadCsvFile(
        fileName,
        buildFixedAssetsCsv(
          ledgerAssets.map((asset) => ({
            ...asset,
            remainingBookValue: calculateRemainingBookValue(asset, targetYearMonth),
            status: FIXED_ASSET_STATUS_LABELS[asset.status],
          })),
        ),
      )
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'depreciation') {
      const fileName = `audit-depreciation-${targetYear}.csv`
      downloadCsvFile(fileName, buildDepreciationCsv(depreciationRows))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'monthly-pl') {
      const fileName = `audit-monthly-pl-${targetYearMonth}.csv`
      downloadCsvFile(fileName, buildMonthlyPlCsv(profitLoss))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'yearly-pl') {
      const fileName = buildYearlyPlCsvFileName(targetYear)
      downloadCsvFile(fileName, buildYearlyPlCsv(yearlyProfitLoss, targetYear))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'expenses-pdf') {
      const fileName = `audit-expenses-${targetYearMonth}.pdf`
      await downloadAuditTablePdf({
        fileName,
        title: `経費一覧 ${formatYearMonthLabel(targetYearMonth)}`,
        headers: ['日付', '取引先', '内容', '科目', '金額', 'PL区分', '備考'],
        rows: reportingMonthExpenses.map((expense) => [
          getExpensePostingDate(expense),
          expense.vendorName,
          expense.description,
          expense.expenseCategory,
          String(expense.taxIncludedAmount),
          expense.plTreatment ?? 'expense',
          [expense.memo, expense.normalExpenseOverrideReason].filter(Boolean).join(' / '),
        ]),
      })
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'fixed-assets-pdf') {
      const fileName = `audit-fixed-assets-${targetYear}.pdf`
      await downloadAuditTablePdf({
        fileName,
        title: `固定資産台帳 ${targetYear}年`,
        headers: ['購入日', '資産名', '区分', '取得価額', '耐用年数', '月額償却', '残高', '状態'],
        rows: ledgerAssets.map((asset) => [
          asset.purchaseDate,
          asset.assetName,
          asset.assetCategory,
          String(asset.acquisitionCost),
          String(asset.appliedUsefulLifeYears),
          String(asset.monthlyDepreciationYen),
          String(calculateRemainingBookValue(asset, targetYearMonth)),
          FIXED_ASSET_STATUS_LABELS[asset.status],
        ]),
      })
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'depreciation-pdf') {
      const fileName = `audit-depreciation-${targetYear}.pdf`
      await downloadAuditTablePdf({
        fileName,
        title: `減価償却一覧 ${targetYear}年`,
        headers: ['対象月', '資産名', '区分', '当月償却', '累計', '残高'],
        rows: depreciationRows.map((row) => [
          row.targetYearMonth,
          row.assetName,
          row.assetCategory,
          String(row.depreciationYen),
          String(row.cumulativeDepreciationYen),
          String(row.remainingBookValue),
        ]),
      })
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'monthly-pl-pdf') {
      const fileName = `audit-monthly-pl-${targetYearMonth}.pdf`
      await downloadAuditTablePdf({
        fileName,
        title: `月次PL ${formatYearMonthLabel(targetYearMonth)}`,
        headers: ['区分', '科目', '金額(円)'],
        rows: buildMonthlyPlPdfRows(profitLoss),
        orientation: 'portrait',
      })
      onExportRecorded(fileName)
      return
    }

    const fileName = buildYearlyPlCsvFileName(targetYear).replace('.csv', '.pdf')
    await downloadAuditLinePdf(fileName, `年次PL ${targetYear}年（暦年・管理会計）`, [
      `集計区分: ${targetYear}年（暦年・管理会計・1〜12月）`,
      `年間売上小計: ${yearlyProfitLoss.columns.yearTotal.salesTotalYen}円`,
      `年間売上原価小計: ${yearlyProfitLoss.columns.yearTotal.costOfSalesTotalYen}円`,
      `年間粗利益: ${yearlyProfitLoss.columns.yearTotal.grossProfitYen}円`,
      `年間固定費小計: ${yearlyProfitLoss.columns.yearTotal.fixedCostsTotalYen}円`,
      `年間減価償却費: ${yearlyProfitLoss.columns.yearTotal.fixedCosts['減価償却費'] ?? 0}円`,
      `年間変動費小計: ${yearlyProfitLoss.columns.yearTotal.variableExpensesTotalYen}円`,
      `年間営業利益: ${yearlyProfitLoss.columns.yearTotal.operatingProfitYen}円`,
    ])
    onExportRecorded(fileName)
  }

  return (
    <section className="accounting-panel" aria-label="監査資料">
      <h2>監査資料</h2>
      <p className="accounting-note">
        経費・領収書・資産台帳・減価償却・PLを監査用にCSVまたはPDFで出力します。
      </p>
      <div className="accounting-audit-export-grid">
        <button className="secondary-action" type="button" onClick={() => void handleExport('expenses')}>
          経費一覧 CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('receipts')}>
          領収書一覧 CSV
        </button>
        <button
          className="secondary-action"
          type="button"
          onClick={() => void handleExport('unorganized-receipts')}
        >
          未整理領収書 CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('small-assets')}>
          少額資産一覧 CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('fixed-assets')}>
          固定資産台帳 CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('depreciation')}>
          減価償却一覧 CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('monthly-pl')}>
          月次PL CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('yearly-pl')}>
          年次PL CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('expenses-pdf')}>
          経費一覧 PDF
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('fixed-assets-pdf')}>
          固定資産台帳 PDF
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('depreciation-pdf')}>
          減価償却一覧 PDF
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('monthly-pl-pdf')}>
          月次PL PDF
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('yearly-pl-pdf')}>
          年次PL PDF
        </button>
      </div>

      <InvoiceLookupHistoryPanel accessScope={accessScope} />
    </section>
  )
}
