import { useEffect, useMemo, useState } from 'react'
import type { StoredCaseRecord } from '../../services/caseRecords'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import { fetchCompanyById } from '../../services/companies'
import type { StoredAccountingExpense } from '../../types/accounting'
import type { StoredAccountingFixedAsset } from '../../types/accountingFixedAssets'
import type { StoredAccountingSettlementAuxiliary } from '../../types/accountingSettlementAuxiliary'
import type { Company } from '../../types/work'
import { SUBMISSION_ITEM_AVAILABILITY_LABELS } from '../../types/accountingSubmissionPackage'
import { COMPANY_FISCAL_POLICY } from '../../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from '../../utils/accountingFiscalPeriod'
import { buildAccountingFilingChecks } from '../../utils/accountingFilingCheck'
import { buildCalendarYearOptions } from '../../utils/accountingPl'
import { downloadCsvFile } from '../../utils/accountingCsv'
import {
  buildAccountingSubmissionPackage,
  buildMissingVoucherCsv,
  buildSubmissionCatalogCsv,
  buildSubmissionPackageTreeNodes,
  buildUnlinkedVoucherCsv,
} from '../../utils/accountingSubmissionPackage'
import { FilingExportCautionBanner } from './FilingCheckPanel'

type SubmissionPackagePanelProps = {
  franchiseeId?: string
  initialTargetYear: number
  expenses: StoredAccountingExpense[]
  receipts: StoredAccountingReceipt[]
  unorganizedReceipts?: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  caseRecords: StoredCaseRecord[]
  settlementAuxiliary: StoredAccountingSettlementAuxiliary | null
  companyName?: string
  onStatus?: (message: string) => void
  onError?: (message: string) => void
  onNavigateAccountingTab?: (
    tab: 'expenses' | 'unorganized-receipts' | 'fixed-assets' | 'etax' | 'tax-advisor' | 'submission',
  ) => void
}

export function SubmissionPackagePanel({
  franchiseeId,
  initialTargetYear,
  expenses,
  receipts,
  unorganizedReceipts = [],
  fixedAssets,
  caseRecords,
  settlementAuxiliary,
  companyName,
  onStatus,
  onError,
  onNavigateAccountingTab,
}: SubmissionPackagePanelProps) {
  const [selectedYear, setSelectedYear] = useState(initialTargetYear)
  const [company, setCompany] = useState<Company | null>(null)
  const yearOptions = useMemo(() => buildCalendarYearOptions(), [])

  useEffect(() => {
    if (!franchiseeId) {
      setCompany(null)
      return
    }
    let cancelled = false
    void fetchCompanyById(franchiseeId).then((row) => {
      if (!cancelled) {
        setCompany(row)
      }
    })
    return () => {
      cancelled = true
    }
  }, [franchiseeId])

  const fiscalPeriod = useMemo(
    () => getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, selectedYear),
    [selectedYear],
  )

  const filingSummary = useMemo(
    () =>
      buildAccountingFilingChecks({
        targetYear: selectedYear,
        fiscalPeriod,
        expenses,
        receipts,
        unorganizedReceipts,
        fixedAssets,
        settlementAuxiliary,
        company,
      }),
    [
      selectedYear,
      fiscalPeriod,
      expenses,
      receipts,
      unorganizedReceipts,
      fixedAssets,
      settlementAuxiliary,
      company,
    ],
  )

  const pkg = useMemo(
    () =>
      buildAccountingSubmissionPackage({
        fiscalPeriod,
        expenses,
        receipts,
        fixedAssets,
        caseRecords,
        settlementAuxiliary,
        filingSummary,
        companyName: companyName || company?.name,
        targetYear: selectedYear,
      }),
    [
      fiscalPeriod,
      expenses,
      receipts,
      fixedAssets,
      caseRecords,
      settlementAuxiliary,
      filingSummary,
      companyName,
      company,
      selectedYear,
    ],
  )

  const treeNodes = useMemo(() => buildSubmissionPackageTreeNodes(pkg), [pkg])
  const hasUnlinkedList = pkg.items.some((item) => item.type === 'unlinkedList')

  const handleDownloadCatalog = () => {
    try {
      downloadCsvFile(`00_資料一覧_${selectedYear}.csv`, buildSubmissionCatalogCsv(pkg))
      onStatus?.('00_資料一覧.csv をダウンロードしました。')
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '資料一覧CSVの出力に失敗しました。')
    }
  }

  const handleDownloadMissing = () => {
    try {
      downloadCsvFile(`12_不足証憑一覧_${selectedYear}.csv`, buildMissingVoucherCsv(pkg))
      onStatus?.('12_不足証憑一覧.csv をダウンロードしました。')
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '不足証憑CSVの出力に失敗しました。')
    }
  }

  const handleDownloadUnlinked = () => {
    try {
      downloadCsvFile(`未紐付け一覧_${selectedYear}.csv`, buildUnlinkedVoucherCsv(pkg))
      onStatus?.('未紐付け一覧.csv をダウンロードしました。')
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '未紐付け一覧CSVの出力に失敗しました。')
    }
  }

  return (
    <section className="accounting-panel accounting-submission-panel" aria-label="税務確認提出パッケージ">
      <header className="accounting-etax-header-card">
        <h2>税務確認提出パッケージ</h2>
        <p className="accounting-note">
          Phase 2A：提出フォルダ構成のプレビューです。証憑原本付きZIPは Phase 2B
          で対応予定です（Storage取得・ZIP生成は行いません）。
        </p>
        <p className="accounting-note">
          経費と領収書の対応は現状 1:1（任意の receiptId / linkedExpenseId）です。パッケージ型は将来の複数証憑に備え
          receiptRefs 配列を持ちます。
        </p>

        <div className="accounting-tax-advisor-year-select">
          <label htmlFor="submission-target-year">対象年度</label>
          <select
            id="submission-target-year"
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}年
              </option>
            ))}
          </select>
        </div>

        <dl className="accounting-etax-header-grid">
          <div>
            <dt>会計年度</dt>
            <dd>{pkg.fiscalPeriodLabel ?? '（利用不可）'}</dd>
          </div>
          <div>
            <dt>会社名</dt>
            <dd>{pkg.companyName || '（未設定）'}</dd>
          </div>
          <div>
            <dt>スキーマ</dt>
            <dd>{pkg.schemaVersion}</dd>
          </div>
          <div>
            <dt>確認用ZIP</dt>
            <dd>{pkg.summary.canGenerateZip ? '生成可能' : '不可'}</dd>
          </div>
          <div>
            <dt>提出準備</dt>
            <dd>
              {pkg.summary.isSubmissionReady
                ? '完了'
                : `未完了（要修正${
                    pkg.summary.filingBlockingCount + pkg.summary.blockingIssueCount
                  }件）`}
            </dd>
          </div>
        </dl>
      </header>

      <FilingExportCautionBanner visible={filingSummary.blockingCount > 0} />

      <section className="accounting-submission-summary" aria-label="パッケージ集計">
        <h3>出力予定</h3>
        <ul className="accounting-submission-counts">
          <li>帳票 {pkg.summary.reportItemCount}件</li>
          <li>
            CSV{' '}
            {
              pkg.items.filter(
                (item) =>
                  item.format === 'csv' &&
                  (item.type === 'catalog' ||
                    item.type === 'report' ||
                    item.type === 'missingVoucherList' ||
                    item.type === 'unlinkedList'),
              ).length
            }
            件
          </li>
          <li>証憑原本 {pkg.summary.linkedVoucherCount}件</li>
          <li>未紐付け {pkg.summary.unlinkedVoucherCount}件</li>
          <li>不足証憑 {pkg.summary.missingVoucherCount}件</li>
          <li>経費 {pkg.summary.expenseCount}</li>
          <li>領収書 {pkg.summary.receiptCount}</li>
          <li>申告 要修正 {pkg.summary.filingBlockingCount}</li>
          <li>申告 要確認 {pkg.summary.filingWarningCount}</li>
          <li>
            パッケージ課題 blocking {pkg.summary.blockingIssueCount} / warning{' '}
            {pkg.summary.warningIssueCount}
          </li>
        </ul>
      </section>

      {pkg.issues.length > 0 ? (
        <section className="accounting-submission-issues" aria-label="パッケージ課題">
          <h3>課題</h3>
          <ul>
            {pkg.issues.slice(0, 20).map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={`is-${issue.severity}`}>
                <strong>{issue.severity === 'blocking' ? '要修正' : '要確認'}</strong>
                {' · '}
                {issue.message}
              </li>
            ))}
            {pkg.issues.length > 20 ? <li>…ほか {pkg.issues.length - 20} 件</li> : null}
          </ul>
        </section>
      ) : null}

      <section className="accounting-submission-tree" aria-label="構成プレビュー">
        <h3>フォルダ構成プレビュー</h3>
        <ul className="accounting-submission-tree-list">
          <li className="accounting-submission-tree-root">税務確認提出パッケージ/{pkg.targetYear}/</li>
          {treeNodes.map((node) => (
            <li key={node.path}>
              <code>{node.path}</code>
              <span className={`accounting-submission-avail is-${node.availability}`}>
                {SUBMISSION_ITEM_AVAILABILITY_LABELS[node.availability]}
              </span>
              <span className="accounting-submission-tree-label">{node.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="accounting-export-actions accounting-submission-actions">
        <button className="primary-action" type="button" onClick={handleDownloadCatalog}>
          00_資料一覧.csv
        </button>
        <button className="secondary-action" type="button" onClick={handleDownloadMissing}>
          12_不足証憑一覧.csv
        </button>
        {hasUnlinkedList ? (
          <button className="secondary-action" type="button" onClick={handleDownloadUnlinked}>
            未紐付け一覧.csv
          </button>
        ) : null}
        <button className="secondary-action" type="button" disabled title="Phase 2B で対応予定">
          証憑原本付きZIP（準備中）
        </button>
      </div>
      <p className="accounting-note">証憑原本付きZIPは Phase 2B で対応予定です。</p>

      {onNavigateAccountingTab ? (
        <p className="accounting-note accounting-submission-links">
          関連:{' '}
          <button
            className="secondary-action"
            type="button"
            onClick={() => onNavigateAccountingTab('tax-advisor')}
          >
            税理士相談用 一式資料
          </button>{' '}
          <button className="secondary-action" type="button" onClick={() => onNavigateAccountingTab('expenses')}>
            経費登録
          </button>{' '}
          <button
            className="secondary-action"
            type="button"
            onClick={() => onNavigateAccountingTab('unorganized-receipts')}
          >
            未整理の領収書
          </button>
        </p>
      ) : null}
    </section>
  )
}
