import { useMemo } from 'react'
import type { StoredAccountingExpense } from '../../types/accounting'
import type { StoredAccountingFixedAsset } from '../../types/accountingFixedAssets'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import type { MonthlyProfitLoss, YearlyProfitLoss } from '../../types/accounting'
import {
  buildDepreciationCsv,
  buildExpensesCsv,
  buildFixedAssetsCsv,
  buildMonthlyPlCsv,
  buildReceiptsCsv,
  buildSalesCsv,
  buildSmallAssetsCsv,
  buildYearlyPlCsv,
  buildYearlyPlCsvFileName,
  downloadCsvFile,
} from '../../utils/accountingCsv'
import { getDepreciationAmountForMonth } from '../../utils/accountingDepreciation'
import type { AccountingSalesRow } from '../../utils/accountingSalesMapping'
import { FIXED_ASSET_STATUS_LABELS } from '../../types/accountingFixedAssets'

export type AuditExportType =
  | 'expenses'
  | 'receipts'
  | 'small-assets'
  | 'fixed-assets'
  | 'depreciation'
  | 'monthly-pl'
  | 'yearly-pl'
  | 'monthly-pl-pdf'
  | 'yearly-pl-pdf'

type AuditMaterialsPanelProps = {
  expenses: StoredAccountingExpense[]
  receipts: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  salesRows: AccountingSalesRow[]
  profitLoss: MonthlyProfitLoss
  yearlyProfitLoss: YearlyProfitLoss
  targetYearMonth: string
  targetYear: number
  onExportRecorded: (fileName: string) => void
}

const downloadSimplePdf = async (fileName: string, title: string, lines: string[]) => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = 14

  pdf.setFontSize(14)
  pdf.text(title, 14, y)
  y += 8
  pdf.setFontSize(10)

  lines.forEach((line) => {
    if (y > 280) {
      pdf.addPage()
      y = 14
    }

    pdf.text(line, 14, y)
    y += 6
  })

  pdf.save(fileName)
}

export function AuditMaterialsPanel({
  expenses,
  receipts,
  fixedAssets,
  salesRows,
  profitLoss,
  yearlyProfitLoss,
  targetYearMonth,
  targetYear,
  onExportRecorded,
}: AuditMaterialsPanelProps) {
  const reportingExpenses = useMemo(
    () => expenses.filter((expense) => expense.confirmationStatus === '確認済み' && !expense.isDeleted),
    [expenses],
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
        .map((asset) => ({
          targetYearMonth: month,
          assetName: asset.assetName,
          assetCategory: asset.assetCategory,
          depreciationYen: getDepreciationAmountForMonth(asset, month),
        }))
        .filter((row) => row.depreciationYen > 0),
    )
  }, [ledgerAssets, targetYear])

  const handleExport = async (exportType: AuditExportType) => {
    if (exportType === 'expenses') {
      const fileName = `audit-expenses-${targetYearMonth}.csv`
      downloadCsvFile(fileName, buildExpensesCsv(reportingExpenses, targetYearMonth))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'receipts') {
      const fileName = `audit-receipts-${targetYearMonth}.csv`
      downloadCsvFile(
        fileName,
        buildReceiptsCsv(
          receipts.map((receipt) => ({
            savedAt: receipt.createdAt,
            receiptDate: receipt.receiptDate,
            vendorNameCandidate: receipt.vendorNameCandidate,
            amountTotalCandidate: receipt.amountTotalCandidate,
            status: receipt.status,
            memo: receipt.memo,
          })),
        ),
      )
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'small-assets') {
      const fileName = `audit-small-assets-${targetYear}.csv`
      downloadCsvFile(fileName, buildSmallAssetsCsv(smallAssets))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'fixed-assets') {
      const fileName = `audit-fixed-assets-${targetYear}.csv`
      downloadCsvFile(fileName, buildFixedAssetsCsv(
        ledgerAssets.map((asset) => ({
          ...asset,
          status: FIXED_ASSET_STATUS_LABELS[asset.status],
        })),
      ))
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
      downloadCsvFile(fileName, buildYearlyPlCsv(yearlyProfitLoss))
      onExportRecorded(fileName)
      return
    }

    if (exportType === 'monthly-pl-pdf') {
      const fileName = `audit-monthly-pl-${targetYearMonth}.pdf`
      await downloadSimplePdf(fileName, `月次PL ${targetYearMonth}`, [
        `売上小計: ${profitLoss.salesTotalYen}`,
        `売上原価小計: ${profitLoss.costOfSalesTotalYen}`,
        `粗利益: ${profitLoss.grossProfitYen}`,
        `固定費小計: ${profitLoss.fixedCostsTotalYen}`,
        `減価償却費: ${profitLoss.fixedCosts['減価償却費'] ?? 0}`,
        `変動費小計: ${profitLoss.variableExpensesTotalYen}`,
        `営業利益: ${profitLoss.operatingProfitYen}`,
      ])
      onExportRecorded(fileName)
      return
    }

    const fileName = buildYearlyPlCsvFileName(targetYear).replace('.csv', '.pdf')
    await downloadSimplePdf(fileName, `年次PL ${targetYear}`, [
      `年間売上小計: ${yearlyProfitLoss.columns.yearTotal.salesTotalYen}`,
      `年間固定費小計: ${yearlyProfitLoss.columns.yearTotal.fixedCostsTotalYen}`,
      `年間減価償却費: ${yearlyProfitLoss.columns.yearTotal.fixedCosts['減価償却費'] ?? 0}`,
      `年間営業利益: ${yearlyProfitLoss.columns.yearTotal.operatingProfitYen}`,
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
        <button className="secondary-action" type="button" onClick={() => void handleExport('monthly-pl-pdf')}>
          月次PL PDF
        </button>
        <button className="secondary-action" type="button" onClick={() => void handleExport('yearly-pl-pdf')}>
          年次PL PDF
        </button>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            const fileName = `audit-sales-${targetYearMonth}.csv`
            downloadCsvFile(fileName, buildSalesCsv(salesRows, targetYearMonth))
            onExportRecorded(fileName)
          }}
        >
          確定売上 CSV
        </button>
      </div>
    </section>
  )
}
