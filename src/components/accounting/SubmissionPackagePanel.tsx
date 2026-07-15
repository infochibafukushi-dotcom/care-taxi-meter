import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoredCaseRecord } from '../../services/caseRecords'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import { fetchCompanyById } from '../../services/companies'
import { subscribeMeterSettings, type MeterSettings } from '../../services/meterSettings'
import {
  downloadBlobFile,
  estimateSubmissionZipFileCount,
  estimateSubmissionZipVoucherCount,
  generateAccountingSubmissionZip,
  loadSubmissionReceiptBlob,
} from '../../services/accountingSubmissionZip'
import type {
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
} from '../../types/accounting'
import type { StoredAccountingFixedAsset } from '../../types/accountingFixedAssets'
import type { StoredAccountingSettlementAuxiliary } from '../../types/accountingSettlementAuxiliary'
import type { AccountingExportPackageRecordPayload } from '../../types/accountingExportHistory'
import { ACCOUNTING_EXPORT_SCHEMA_VERSION } from '../../types/accountingExportHistory'
import type { Company } from '../../types/work'
import { SUBMISSION_ITEM_AVAILABILITY_LABELS } from '../../types/accountingSubmissionPackage'
import type { SubmissionZipProgress } from '../../types/accountingSubmissionZip'
import {
  SubmissionZipCancelledError,
  SubmissionZipFatalError,
} from '../../types/accountingSubmissionZip'
import { COMPANY_FISCAL_POLICY } from '../../constants/companyFiscalPolicy'
import {
  SUBMISSION_ZIP_CLIENT_LIMITS,
  SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE,
} from '../../constants/accountingSubmissionZipLimits'
import { getCompanyFiscalPeriod } from '../../utils/accountingFiscalPeriod'
import {
  buildAccountingFilingChecks,
  buildReadinessSnapshot,
} from '../../utils/accountingFilingCheck'
import { buildCalendarYearOptions } from '../../utils/accountingPl'
import { downloadCsvFile } from '../../utils/accountingCsv'
import {
  buildAccountingSubmissionPackage,
  buildMissingVoucherCsv,
  buildSubmissionCatalogCsv,
  buildSubmissionPackageTreeNodes,
  buildUnlinkedVoucherCsv,
} from '../../utils/accountingSubmissionPackage'
import { buildSubmissionZipReportFiles } from '../../utils/accountingSubmissionZipReports'
import { buildTaxAdvisorPackage } from '../../utils/accountingTaxAdvisorData'
import {
  buildDefaultSettlementAuxiliary,
  mergeSettlementAuxiliary,
} from '../../utils/accountingSettlementAuxiliaryForm'
import {
  buildAccountingExportSourceFingerprint,
  buildETaxExportFingerprintInput,
  toFiscalPeriodSnapshot,
} from '../../utils/accountingExportFingerprint'
import { mapCaseRecordToSalesBreakdown } from '../../utils/accountingSalesMapping'
import { FilingExportCautionBanner } from './FilingCheckPanel'

type SubmissionPackagePanelProps = {
  franchiseeId?: string
  storeId?: string
  storeName?: string
  initialTargetYear: number
  staffId?: string
  staffName?: string
  expenses: StoredAccountingExpense[]
  adjustments?: StoredAccountingAdjustment[]
  fixedCosts?: StoredAccountingFixedCost[]
  receipts: StoredAccountingReceipt[]
  unorganizedReceipts?: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  caseRecords: StoredCaseRecord[]
  settlementAuxiliary: StoredAccountingSettlementAuxiliary | null
  settlementAuxiliaryLoadError?: string
  companyName?: string
  onExportPackageRecorded?: (payload: AccountingExportPackageRecordPayload) => Promise<void>
  onStatus?: (message: string) => void
  onError?: (message: string) => void
  onNavigateAccountingTab?: (
    tab: 'expenses' | 'unorganized-receipts' | 'fixed-assets' | 'etax' | 'tax-advisor' | 'submission',
    options?: { focusReceiptId?: string },
  ) => void
}

const STAGE_LABELS: Record<SubmissionZipProgress['stage'], string> = {
  preparing: '準備中',
  generatingReports: '帳票生成',
  fetchingVouchers: '証憑取得',
  hashing: 'ハッシュ計算',
  compressing: 'ZIP圧縮',
  downloading: 'ダウンロード',
  completed: '完了',
  cancelled: 'キャンセル',
  failed: '失敗',
}

export function SubmissionPackagePanel({
  franchiseeId,
  storeId = '',
  storeName = '',
  initialTargetYear,
  staffId = '',
  staffName = '',
  expenses,
  adjustments = [],
  fixedCosts = [],
  receipts,
  unorganizedReceipts = [],
  fixedAssets,
  caseRecords,
  settlementAuxiliary,
  settlementAuxiliaryLoadError = '',
  companyName,
  onExportPackageRecorded,
  onStatus,
  onError,
  onNavigateAccountingTab,
}: SubmissionPackagePanelProps) {
  const [selectedYear, setSelectedYear] = useState(initialTargetYear)
  const [company, setCompany] = useState<Company | null>(null)
  const [meterSettings, setMeterSettings] = useState<MeterSettings | null>(null)
  const [isZipping, setIsZipping] = useState(false)
  const [progress, setProgress] = useState<SubmissionZipProgress | null>(null)
  const [zipWarnings, setZipWarnings] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const yearOptions = useMemo(() => buildCalendarYearOptions(), [])

  useEffect(() => {
    setSelectedYear(initialTargetYear)
  }, [initialTargetYear])

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

  useEffect(() => {
    if (!franchiseeId || !storeId) {
      setMeterSettings(null)
      return
    }
    const unsubscribe = subscribeMeterSettings({ franchiseeId, storeId }, (settings: MeterSettings) => {
      setMeterSettings(settings)
    })
    return unsubscribe
  }, [franchiseeId, storeId])

  const fiscalPeriod = useMemo(
    () => getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, selectedYear),
    [selectedYear],
  )

  const auxiliary = useMemo(
    () =>
      mergeSettlementAuxiliary(
        settlementAuxiliary,
        buildDefaultSettlementAuxiliary({
          franchiseeId: franchiseeId ?? '',
          storeId,
          targetYear: selectedYear,
          company,
          meterSettings,
          staffId,
          staffName,
        }),
      ),
    [company, franchiseeId, meterSettings, selectedYear, settlementAuxiliary, staffId, staffName, storeId],
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
        settlementAuxiliary: settlementAuxiliaryLoadError ? null : auxiliary,
        company,
        settlementAuxiliaryLoadError: settlementAuxiliaryLoadError || null,
      }),
    [
      selectedYear,
      fiscalPeriod,
      expenses,
      receipts,
      unorganizedReceipts,
      fixedAssets,
      auxiliary,
      company,
      settlementAuxiliaryLoadError,
    ],
  )

  const taxAdvisorPackage = useMemo(
    () =>
      buildTaxAdvisorPackage({
        targetYear: selectedYear,
        storeName: storeName || companyName || '',
        company,
        meterSettings,
        caseRecords,
        expenses,
        adjustments,
        fixedCosts,
        fixedAssets,
        auxiliary,
        allReceipts: receipts,
        unorganizedReceipts,
      }),
    [
      selectedYear,
      storeName,
      companyName,
      company,
      meterSettings,
      caseRecords,
      expenses,
      adjustments,
      fixedCosts,
      fixedAssets,
      auxiliary,
      receipts,
      unorganizedReceipts,
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
        settlementAuxiliary: auxiliary,
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
      auxiliary,
      filingSummary,
      companyName,
      company,
      selectedYear,
    ],
  )

  const treeNodes = useMemo(() => buildSubmissionPackageTreeNodes(pkg), [pkg])
  const hasUnlinkedList = pkg.items.some((item) => item.type === 'unlinkedList')
  const estimatedFiles = estimateSubmissionZipFileCount(pkg)
  const estimatedVouchers = estimateSubmissionZipVoucherCount(pkg)
  const zipButtonLabel = pkg.summary.isSubmissionReady ? '税務確認ZIPを作成' : '確認用ZIPを作成'
  const zipPurposeLabel = pkg.summary.isSubmissionReady ? '提出準備済みZIP' : '確認用ZIP'

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

  const handleCancelZip = () => {
    abortRef.current?.abort()
    setProgress((current) =>
      current
        ? {
            ...current,
            cancelRequested: true,
            message: 'キャンセル処理中です…',
          }
        : current,
    )
  }

  const handleCreateZip = async () => {
    if (isZipping) {
      return
    }
    if (!pkg.summary.canGenerateZip || !fiscalPeriod) {
      onError?.('パッケージを構築できないためZIPを作成できません。')
      return
    }
    if (estimatedFiles > SUBMISSION_ZIP_CLIENT_LIMITS.maxFiles) {
      onError?.(SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE)
      return
    }

    const confirmLines = [
      `証憑原本${estimatedVouchers}件を取得してZIPを作成します。`,
      pkg.summary.missingVoucherCount > 0
        ? `不足証憑が${pkg.summary.missingVoucherCount}件あるため、確認用ZIPとして作成されます。`
        : pkg.summary.isSubmissionReady
          ? '提出準備が整っているため、確認用表記なしのZIP名になります。'
          : '提出準備が未完了のため、確認用ZIPとして作成されます。',
      `申告前 blocking: ${pkg.summary.filingBlockingCount}件`,
      `クライアント暫定上限: ファイル${SUBMISSION_ZIP_CLIENT_LIMITS.maxFiles}件 / 合計約${Math.round(
        SUBMISSION_ZIP_CLIENT_LIMITS.maxTotalEstimatedBytes / (1024 * 1024),
      )}MB`,
    ]
    if (!window.confirm(confirmLines.join('\n'))) {
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setIsZipping(true)
    setZipWarnings([])
    setProgress({
      stage: 'preparing',
      message: '確認用ZIPを作成しています',
      reportsDone: 0,
      reportsTotal: 0,
      vouchersDone: 0,
      vouchersTotal: estimatedVouchers,
    })

    try {
      const catalogCsv = buildSubmissionCatalogCsv(pkg)
      const unlinkedCsv = hasUnlinkedList ? buildUnlinkedVoucherCsv(pkg) : undefined

      const reportFiles = await buildSubmissionZipReportFiles({
        taxAdvisorPackage,
        fiscalPeriod,
        caseRecords,
        filingSummary,
        catalogCsv,
        // Placeholder only — discarded; finalizeMissingVoucherCsv rebuilds after fetch
        missingVoucherCsv: buildMissingVoucherCsv(pkg),
        unlinkedVoucherCsv: unlinkedCsv,
      })

      const result = await generateAccountingSubmissionZip({
        packageData: pkg,
        reportFiles,
        receiptLoader: loadSubmissionReceiptBlob,
        signal: controller.signal,
        onProgress: setProgress,
        finalizeMissingVoucherCsv: (failedPaths) => {
          // Always rebuild from post-fetch state — never ship the pre-fetch CSV as-is
          const rebuiltBase = buildMissingVoucherCsv(pkg)
          if (failedPaths.length === 0) {
            return rebuiltBase
          }
          const extraLines = failedPaths.map((row) =>
            [
              '',
              '',
              '',
              '',
              '',
              `取得失敗: ${row.reason}`,
              '',
              'blocking',
              '証憑取得',
            ]
              .map((cell) => {
                const value = String(cell)
                return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
              })
              .join(','),
          )
          const trimmed = rebuiltBase.replace(/\r?\n$/, '')
          return `${trimmed}\r\n${extraLines.join('\r\n')}\r\n`
        },
      })

      downloadBlobFile(result.fileName, result.blob)
      setZipWarnings(result.warnings)
      setProgress({
        stage: 'completed',
        message: result.isConfirmationZip
          ? '確認用ZIPのダウンロードを呼び出しました'
          : '税務確認ZIPのダウンロードを呼び出しました',
        reportsDone: 1,
        reportsTotal: 1,
        vouchersDone: estimatedVouchers,
        vouchersTotal: estimatedVouchers,
      })

      onStatus?.(
        `${result.fileName} を出力しました（ZIP内 ${result.archiveEntryCount} エントリ` +
          (result.warnings.length > 0 ? ` / 警告 ${result.warnings.length}件` : '') +
          '）。端末保存の完了は保証されません。',
      )

      if (onExportPackageRecorded) {
        try {
          const periodSnapshot = toFiscalPeriodSnapshot(fiscalPeriod)
          let sourceFingerprint: string | undefined
          try {
            sourceFingerprint = await buildAccountingExportSourceFingerprint(
              buildETaxExportFingerprintInput({
                fiscalPeriod: periodSnapshot,
                exportType: 'submission-zip',
                exportSchemaVersion: ACCOUNTING_EXPORT_SCHEMA_VERSION,
                expenses,
                receipts,
                fixedAssets,
                adjustments,
                fixedCosts,
                settlementAuxiliary: auxiliary,
                caseRecords: caseRecords.map((record) => ({
                  id: record.id,
                  updatedAt: record.createdAt,
                  closedAt: record.closedAt,
                  totalFareYen:
                    typeof record.actualFareYen === 'number' && Number.isFinite(record.actualFareYen)
                      ? record.actualFareYen
                      : record.totalFareYen,
                  actualFareYen: record.actualFareYen,
                  salesCategoryAmounts: mapCaseRecordToSalesBreakdown(record),
                })),
                company: company
                  ? {
                      corporateName: company.corporateName,
                      name: company.name,
                      invoiceNumber: company.invoiceNumber,
                      address: company.address,
                      representativeName: company.representativeName,
                    }
                  : null,
              }),
            )
          } catch {
            sourceFingerprint = undefined
          }

          const filingReadiness = buildReadinessSnapshot(filingSummary)
          await onExportPackageRecorded({
            exportType: 'submission-zip',
            files: [
              {
                fileName: result.fileName,
                format: 'zip',
                documentType: 'submission-package',
                byteSize: result.byteSize,
                contentHash: result.contentHash,
              },
            ],
            fiscalPeriod: periodSnapshot,
            readiness: {
              ...filingReadiness,
              blockingCount: filingReadiness.blockingCount + result.fetchFailureCount,
              isFilingReady: result.isSubmissionReady && filingReadiness.isFilingReady,
            },
            sourceFingerprint,
            sourceRecordCounts: {
              expenses: expenses.length,
              receipts: receipts.length,
              fixedCosts: fixedCosts.length,
              fixedAssets: fixedAssets.length,
              adjustments: adjustments.length,
              sales: caseRecords.length,
            },
            targetYearMonth: fiscalPeriod.endYearMonth,
            submissionPurpose: result.isConfirmationZip ? 'confirmation' : 'submission',
            archiveEntryCount: result.archiveEntryCount,
          })
        } catch {
          // History failure must not fail ZIP success
          onStatus?.(
            `${result.fileName} の出力は完了しましたが、出力操作履歴の保存に失敗しました。`,
          )
        }
      }
    } catch (error) {
      if (error instanceof SubmissionZipCancelledError) {
        setProgress({
          stage: 'cancelled',
          message: 'ZIP生成をキャンセルしました（ダウンロード・成功履歴は作成していません）',
          reportsDone: 0,
          reportsTotal: 0,
          vouchersDone: 0,
          vouchersTotal: estimatedVouchers,
          cancelRequested: true,
        })
        onStatus?.('ZIP生成をキャンセルしました。')
      } else {
        const message =
          error instanceof SubmissionZipFatalError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'ZIP生成に失敗しました。'
        setProgress({
          stage: 'failed',
          message,
          reportsDone: 0,
          reportsTotal: 0,
          vouchersDone: 0,
          vouchersTotal: estimatedVouchers,
        })
        onError?.(message)
      }
    } finally {
      setIsZipping(false)
      abortRef.current = null
    }
  }

  return (
    <section className="accounting-panel accounting-submission-panel" aria-label="税務確認提出パッケージ">
      <header className="accounting-etax-header-card">
        <h2>税務確認提出パッケージ</h2>
        <p className="accounting-note">
          確認用ZIPをブラウザで生成できます。証憑原本やPDFはZIP生成時に同梱します。大容量は
          Phase 2C 対応予定です。端末への保存完了は保証しません。
        </p>
        <p className="accounting-note">
          経費と領収書の対応は現状 1:1 です。パッケージ型は将来の複数証憑に備え receiptRefs
          配列を持ちます。
        </p>

        <div className="accounting-tax-advisor-year-select">
          <label htmlFor="submission-target-year">対象年度</label>
          <select
            id="submission-target-year"
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
            disabled={isZipping}
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
          <div>
            <dt>ZIP用途</dt>
            <dd>{zipPurposeLabel}</dd>
          </div>
        </dl>
        {settlementAuxiliaryLoadError ? (
          <p className="accounting-error" role="alert">
            決算補助データの取得に失敗したため、提出準備を完了扱いできません。ZIPは確認用ZIPとして作成されます。
            <br />
            {settlementAuxiliaryLoadError}
          </p>
        ) : null}
      </header>

      <FilingExportCautionBanner visible={filingSummary.blockingCount > 0} />

      <section className="accounting-submission-summary" aria-label="パッケージ集計">
        <h3>出力予定</h3>
        <ul className="accounting-submission-counts">
          <li>推定ファイル数 {estimatedFiles}件</li>
          <li>証憑原本 {estimatedVouchers}件</li>
          <li>不足証憑 {pkg.summary.missingVoucherCount}件</li>
          <li>未紐付け {pkg.summary.unlinkedVoucherCount}件</li>
          <li>申告 要修正 {pkg.summary.filingBlockingCount}</li>
          <li>
            クライアント暫定上限 ファイル{SUBMISSION_ZIP_CLIENT_LIMITS.maxFiles} / 合計
            {Math.round(SUBMISSION_ZIP_CLIENT_LIMITS.maxTotalEstimatedBytes / (1024 * 1024))}MB /
            単体
            {Math.round(SUBMISSION_ZIP_CLIENT_LIMITS.maxSingleFileBytes / (1024 * 1024))}MB
          </li>
        </ul>
      </section>

      {pkg.issues.length > 0 ? (
        <section className="accounting-submission-issues" aria-label="パッケージ課題">
          <h3>課題</h3>
          <ul>
            {pkg.issues.slice(0, 20).map((issue, index) => {
              const receiptNo = issue.relatedTemporaryNos?.find((value) => value.startsWith('RCP-'))
              const sourceReceiptId = receiptNo
                ? pkg.items.find(
                    (item) =>
                      item.receiptTemporaryNo === receiptNo ||
                      item.temporaryNumbers?.includes(receiptNo),
                  )?.sourceReceiptId
                : undefined
              const canOpenReceipt =
                issue.code === 'receipts.orphanLinkedExpense' &&
                Boolean(sourceReceiptId) &&
                Boolean(onNavigateAccountingTab)

              return (
                <li key={`${issue.code}-${index}`} className={`is-${issue.severity}`}>
                  <strong>{issue.severity === 'blocking' ? '要修正' : '要確認'}</strong>
                  {' · '}
                  {issue.message}
                  {canOpenReceipt ? (
                    <>
                      {' '}
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() =>
                          onNavigateAccountingTab?.('unorganized-receipts', {
                            focusReceiptId: sourceReceiptId,
                          })
                        }
                      >
                        証憑を確認
                      </button>
                    </>
                  ) : null}
                </li>
              )
            })}
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

      {(progress || zipWarnings.length > 0) && (
        <section className="accounting-submission-progress" aria-live="polite">
          <h3>ZIP進捗</h3>
          {progress ? (
            <ul className="accounting-submission-counts">
              <li>
                状態 {STAGE_LABELS[progress.stage]} — {progress.message}
              </li>
              {progress.currentVoucherFileName ? (
                <li>対象ファイル {progress.currentVoucherFileName}</li>
              ) : null}
              <li>
                帳票生成 {progress.reportsDone} / {progress.reportsTotal}
              </li>
              <li>
                証憑取得 {progress.vouchersDone} / {progress.vouchersTotal}
                {progress.stage === 'fetchingVouchers' && progress.currentVoucherIndex
                  ? `（現在 ${progress.currentVoucherIndex}/${progress.vouchersTotal}）`
                  : ''}
              </li>
              {progress.stage === 'compressing' ? <li>ZIP圧縮 実行中</li> : null}
            </ul>
          ) : null}
          {zipWarnings.length > 0 ? (
            <ul className="accounting-submission-issues">
              {zipWarnings.slice(0, 10).map((warning, index) => (
                <li key={`warn-${index}`} className="is-warning">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
          {!isZipping && progress ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setProgress(null)
                setZipWarnings([])
              }}
            >
              進捗をクリア
            </button>
          ) : null}
        </section>
      )}

      <div className="accounting-export-actions accounting-submission-actions">
        <button className="primary-action" type="button" onClick={handleDownloadCatalog} disabled={isZipping}>
          00_資料一覧.csv
        </button>
        <button className="secondary-action" type="button" onClick={handleDownloadMissing} disabled={isZipping}>
          12_不足証憑一覧.csv
        </button>
        {hasUnlinkedList ? (
          <button
            className="secondary-action"
            type="button"
            onClick={handleDownloadUnlinked}
            disabled={isZipping}
          >
            未紐付け一覧.csv
          </button>
        ) : null}
        <button
          className="primary-action"
          type="button"
          onClick={() => void handleCreateZip()}
          disabled={isZipping || !pkg.summary.canGenerateZip}
        >
          {isZipping ? 'ZIP作成中…' : zipButtonLabel}
        </button>
        {isZipping ? (
          <button className="secondary-action" type="button" onClick={handleCancelZip}>
            キャンセル
          </button>
        ) : null}
      </div>
      {isZipping && progress?.cancelRequested ? (
        <p className="accounting-note" role="status">
          キャンセル処理中です。取得待ちはすぐに終了します（Storageの実通信は裏側で残る場合があります）。
        </p>
      ) : null}
      <p className="accounting-note">
        ZIPには公開manifestのみ同梱します。内部manifest・Storageパス・Firestore
        IDは含めません。クライアント上限は暫定値です。大容量は Phase 2C 予定です。
      </p>

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
