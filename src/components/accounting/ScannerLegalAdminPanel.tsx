import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatFareYen } from '../../services/fare'
import { fetchAccountingReceiptAccessUrl } from '../../services/accountingReceiptAccess'
import {
  confirmScannerReceiptAccounting,
  hardDeletePreTimestampScannerReceipt,
  softDeleteIssuedScannerReceipt,
  verifyStoredMasterHash,
} from '../../services/accountingReceiptLegalLifecycle'
import { issueAccountingReceiptTimestampClient } from '../../services/accountingReceiptTimestamp'
import { verifyAccountingReceiptTimestampClient } from '../../services/accountingReceiptTimestampVerify'
import { searchAccountingScannerReceipts } from '../../services/accountingScannerSearch'
import { buildScannerLegalExportZip } from '../../services/accountingScannerExportZip'
import type { StoredAccountingReceipt } from '../../types/accounting'
import {
  ACCOUNTING_RECEIPT_LEGAL_STATUSES,
  ACCOUNTING_RECEIPT_TIMESTAMP_STATUSES,
  LEGAL_PENDING_TIMESTAMP_USER_LABELS,
  LEGAL_TIMESTAMP_UNCONFIGURED_LABELS,
  SCANNER_DELETE_REASON_LABELS,
  type AccountingReceiptLegalStatus,
  type ScannerDeleteReason,
  requiresPaperOriginalRetention,
} from '../../types/accountingReceiptLegal'
import { evaluateScannerDeadline } from '../../utils/accountingScannerDeadline'
import {
  DEFAULT_SCANNER_RECEIPT_LIST_FILTERS,
  type ScannerReceiptListFilters,
} from '../../utils/accountingScannerSearchQuery'
import { canHardDeleteScannerReceipt } from '../../utils/receiptLegalStatus'
import type { StaffRole } from '../../types/work'
import type { AuditActor } from '../../services/auditLogs'
import type { TenantAccessScope } from '../../services/tenancy'

export type ScannerLegalExpenseHint = {
  id: string
  receiptId?: string
  vendorName?: string
  taxIncludedAmount?: number
  description?: string
}

export type ScannerLegalAdminActor = {
  userId: string
  userName: string
  role: StaffRole | ''
  franchiseeId: string
  storeId: string
}

type ScannerLegalAdminPanelProps = {
  accessScope: TenantAccessScope
  actor: ScannerLegalAdminActor
  canManageLegal: boolean
  expenses: ScannerLegalExpenseHint[]
  onOpenExpense?: (expenseId: string) => void
  onStatusMessage?: (message: string) => void
  onErrorMessage?: (message: string) => void
}

const LEGAL_STATUS_LABELS: Record<AccountingReceiptLegalStatus, string> = {
  draft: '下書き',
  image_review: '画像確認中',
  legal_pending_timestamp: 'タイムスタンプ待ち',
  legal_saved_accounting_pending: '保存済・経理待ち',
  accounting_confirmed: '経理確認済',
  late_saved: '期限超過保存',
  deleted: '削除済',
}

const TIMESTAMP_STATUS_LABELS: Record<
  (typeof ACCOUNTING_RECEIPT_TIMESTAMP_STATUSES)[number],
  string
> = {
  none: '未処理',
  pending: '発行中',
  issued: '発行済',
  failed: '失敗',
  verification_failed: '検証失敗',
}

const getReceiptVendor = (receipt: StoredAccountingReceipt) =>
  receipt.confirmed?.vendorName?.trim() ||
  receipt.vendorNameCandidate?.trim() ||
  '（未入力）'

const getReceiptAmount = (receipt: StoredAccountingReceipt) => {
  const amount = receipt.confirmed?.amount ?? receipt.amountTotalCandidate
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null
}

function MasterPreview({ receiptId }: { receiptId: string }) {
  const [imageUrl, setImageUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setImageUrl('')

    fetchAccountingReceiptAccessUrl({ receiptId, variant: 'master' })
      .then((result) => {
        if (cancelled) {
          return
        }
        if (result.url) {
          setImageUrl(result.url)
          setStatus('ready')
        } else {
          setStatus('error')
        }
      })
      .catch(() => {
        if (!cancelled) {
          fetchAccountingReceiptAccessUrl({ receiptId, variant: 'thumbnail' })
            .then((fallback) => {
              if (!cancelled && fallback.url) {
                setImageUrl(fallback.url)
                setStatus('ready')
              } else if (!cancelled) {
                setStatus('error')
              }
            })
            .catch(() => {
              if (!cancelled) {
                setStatus('error')
              }
            })
        }
      })

    return () => {
      cancelled = true
    }
  }, [receiptId])

  if (status === 'loading') {
    return <p className="accounting-note">法定マスター画像を読み込み中…</p>
  }
  if (status === 'error' || !imageUrl) {
    return <p className="accounting-note">法定マスター画像を表示できません。</p>
  }
  return (
    <img
      src={imageUrl}
      alt="法定スキャナ保存マスター"
      className="scanner-legal-admin-master-image"
    />
  )
}

export function ScannerLegalAdminPanel({
  accessScope,
  actor,
  canManageLegal,
  expenses,
  onOpenExpense,
  onStatusMessage,
  onErrorMessage,
}: ScannerLegalAdminPanelProps) {
  const [filters, setFilters] = useState<ScannerReceiptListFilters>(DEFAULT_SCANNER_RECEIPT_LIST_FILTERS)
  const [searchResult, setSearchResult] = useState<Awaited<
    ReturnType<typeof searchAccountingScannerReceipts>
  > | null>(null)
  const [selectedReceiptId, setSelectedReceiptId] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [deleteReason, setDeleteReason] = useState<ScannerDeleteReason>('wrong_receipt')
  const [confirmExpenseId, setConfirmExpenseId] = useState('')
  const [hashCheckMessage, setHashCheckMessage] = useState('')
  const [verifyMessage, setVerifyMessage] = useState('')

  const selectedReceipt = useMemo(
    () => searchResult?.items.find((item) => item.id === selectedReceiptId) ?? null,
    [searchResult?.items, selectedReceiptId],
  )

  const expenseByReceiptId = useMemo(() => {
    const map = new Map<string, ScannerLegalExpenseHint>()
    for (const expense of expenses) {
      const receiptId = expense.receiptId?.trim()
      if (receiptId) {
        map.set(receiptId, expense)
      }
    }
    return map
  }, [expenses])

  const auditActor = useMemo<AuditActor>(
    () => ({
      userId: actor.userId,
      userName: actor.userName,
      role: actor.role,
      franchiseeId: actor.franchiseeId,
      storeId: actor.storeId,
    }),
    [actor],
  )

  const linkedExpense = selectedReceipt
    ? expenseByReceiptId.get(selectedReceipt.id) ??
      (selectedReceipt.linkedExpenseId
        ? expenses.find((row) => row.id === selectedReceipt.linkedExpenseId)
        : undefined)
    : undefined

  const deadline = useMemo(() => {
    if (!selectedReceipt) {
      return null
    }
    return evaluateScannerDeadline({
      receivedDate: selectedReceipt.receivedDate,
      foundDate: selectedReceipt.foundDate,
      mode: selectedReceipt.scannerInputMode,
      todayIso: new Date().toISOString().slice(0, 10),
    })
  }, [selectedReceipt])

  const paperRetentionRequired = selectedReceipt
    ? requiresPaperOriginalRetention({
        captureMode: selectedReceipt.captureMode,
        legalStatus: selectedReceipt.legalStatus,
        timestampStatus: selectedReceipt.timestampStatus,
        requiresPaperOriginal: selectedReceipt.requiresPaperOriginal,
        receivedDate: selectedReceipt.receivedDate,
        foundDate: selectedReceipt.foundDate,
      })
    : false

  const runSearch = useCallback(async () => {
    setIsSearching(true)
    setHashCheckMessage('')
    setVerifyMessage('')
    try {
      const result = await searchAccountingScannerReceipts({
        scope: accessScope,
        filters,
      })
      setSearchResult(result)
      if (result.items.length === 0) {
        setSelectedReceiptId('')
        onStatusMessage?.('該当するスキャナ保存証憑はありません。')
      } else {
        setSelectedReceiptId((current) =>
          current && result.items.some((item) => item.id === current)
            ? current
            : result.items[0].id,
        )
        onStatusMessage?.(`${result.totalCount} 件を表示しています。`)
      }
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : '検索に失敗しました。')
    } finally {
      setIsSearching(false)
    }
  }, [accessScope, filters, onErrorMessage, onStatusMessage])

  const initialSearchDone = useRef(false)

  useEffect(() => {
    if (initialSearchDone.current) {
      return
    }
    initialSearchDone.current = true
    void runSearch()
  }, [runSearch])

  useEffect(() => {
    if (linkedExpense?.id) {
      setConfirmExpenseId(linkedExpense.id)
    } else if (selectedReceipt?.linkedExpenseId) {
      setConfirmExpenseId(selectedReceipt.linkedExpenseId)
    }
  }, [linkedExpense?.id, selectedReceipt?.linkedExpenseId])

  const refreshSelected = async () => {
    if (!selectedReceiptId) {
      await runSearch()
      return
    }
    const result = await searchAccountingScannerReceipts({
      scope: accessScope,
      filters: { ...filters, receiptId: selectedReceiptId },
    })
    if (result.items[0]) {
      setSearchResult((prev) => {
        if (!prev) {
          return result
        }
        const others = prev.items.filter((item) => item.id !== selectedReceiptId)
        return {
          ...prev,
          items: [...others, result.items[0]].sort((a, b) =>
            (b.transactionDate || '').localeCompare(a.transactionDate || ''),
          ),
          totalCount: prev.totalCount,
        }
      })
    } else {
      await runSearch()
    }
  }

  const handleIssueTimestamp = async () => {
    if (!selectedReceipt || !canManageLegal) {
      return
    }
    setActionBusy('timestamp')
    try {
      const version = selectedReceipt.activeVersion ?? selectedReceipt.version ?? 1
      const fileHash = (selectedReceipt.fileHash || selectedReceipt.imageHash || '').trim()
      const legalMasterStoragePath = selectedReceipt.legalMasterStoragePath?.trim() || ''
      if (!fileHash || !legalMasterStoragePath) {
        throw new Error('fileHash または master パスがありません。')
      }
      const result = await issueAccountingReceiptTimestampClient({
        receiptId: selectedReceipt.id,
        version,
        fileHash,
        legalMasterStoragePath,
        franchiseeId: selectedReceipt.franchiseeId,
        storeId: selectedReceipt.storeId,
        actor: auditActor,
      })
      if (!result.ok) {
        onErrorMessage?.(result.message)
      } else {
        onStatusMessage?.('タイムスタンプを発行しました。')
      }
      await refreshSelected()
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : 'タイムスタンプ発行に失敗しました。')
    } finally {
      setActionBusy('')
    }
  }

  const handleVerifyTimestamp = async () => {
    if (!selectedReceipt || !canManageLegal) {
      return
    }
    setActionBusy('verify')
    try {
      const result = await verifyAccountingReceiptTimestampClient({
        receiptId: selectedReceipt.id,
        version: selectedReceipt.activeVersion ?? selectedReceipt.version,
      })
      setVerifyMessage(result.message)
      if (result.ok) {
        onStatusMessage?.(result.message)
      } else {
        onErrorMessage?.(result.message)
      }
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : 'タイムスタンプ検証に失敗しました。')
    } finally {
      setActionBusy('')
    }
  }

  const handleHashCheck = async () => {
    if (!selectedReceipt) {
      return
    }
    setActionBusy('hash')
    try {
      const result = await verifyStoredMasterHash(selectedReceipt)
      const message = result.ok
        ? '保存画像のハッシュは一致しています。'
        : `ハッシュ不一致: 現在=${result.currentHash || '—'} / 期待=${result.expectedHash || '—'}`
      setHashCheckMessage(message)
      if (result.ok) {
        onStatusMessage?.(message)
      } else {
        onErrorMessage?.(message)
      }
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : 'ハッシュ照合に失敗しました。')
    } finally {
      setActionBusy('')
    }
  }

  const handleDelete = async () => {
    if (!selectedReceipt || !canManageLegal) {
      return
    }
    const hard = canHardDeleteScannerReceipt({
      legalStatus: selectedReceipt.legalStatus,
      timestampStatus: selectedReceipt.timestampStatus,
    })
    const label = hard ? '完全削除' : '論理削除'
    if (!window.confirm(`この証憑を${label}します。よろしいですか？`)) {
      return
    }
    setActionBusy('delete')
    try {
      if (hard) {
        await hardDeletePreTimestampScannerReceipt({
          receipt: selectedReceipt,
          actor: auditActor,
          reason: deleteReason,
        })
        onStatusMessage?.('証憑を完全削除しました。')
        setSelectedReceiptId('')
        await runSearch()
      } else {
        await softDeleteIssuedScannerReceipt({
          receipt: selectedReceipt,
          actor: auditActor,
          reason: deleteReason,
        })
        onStatusMessage?.('証憑を論理削除しました。')
        await refreshSelected()
      }
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : '削除に失敗しました。')
    } finally {
      setActionBusy('')
    }
  }

  const handleConfirmAccounting = async () => {
    if (!selectedReceipt || !canManageLegal) {
      return
    }
    const expenseId = confirmExpenseId.trim() || linkedExpense?.id || selectedReceipt.linkedExpenseId || ''
    if (!expenseId) {
      onErrorMessage?.('経理確認には経費 ID が必要です。')
      return
    }
    setActionBusy('confirm')
    try {
      await confirmScannerReceiptAccounting({
        receipt: selectedReceipt,
        expenseId,
        actor: auditActor,
      })
      onStatusMessage?.('経理確認済みに更新しました。')
      await refreshSelected()
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : '経理確認に失敗しました。')
    } finally {
      setActionBusy('')
    }
  }

  const handleExportZip = async () => {
    if (!searchResult?.items.length) {
      onErrorMessage?.('出力対象がありません。先に検索してください。')
      return
    }
    setIsExporting(true)
    try {
      const { blob, fileName } = await buildScannerLegalExportZip({
        receipts: searchResult.items,
        actor: auditActor,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      URL.revokeObjectURL(url)
      onStatusMessage?.(`${fileName} をダウンロードしました。`)
    } catch (error) {
      onErrorMessage?.(error instanceof Error ? error.message : 'ZIP 出力に失敗しました。')
    } finally {
      setIsExporting(false)
    }
  }

  const updateFilter = <K extends keyof ScannerReceiptListFilters>(
    key: K,
    value: ScannerReceiptListFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <section className="accounting-panel scanner-legal-admin-panel" aria-label="スキャナ保存（税務）">
      <header className="scanner-legal-admin-header">
        <div>
          <h2>スキャナ保存（税務）</h2>
          <p className="accounting-note">
            電子帳簿保存法に基づくスキャナ保存証憑の検索・確認・出力です。
          </p>
        </div>
        <div className="receipt-scanner-actions">
          <button type="button" className="secondary-action" disabled={isSearching} onClick={() => void runSearch()}>
            {isSearching ? '検索中…' : '再検索'}
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={isExporting || !searchResult?.items.length}
            onClick={() => void handleExportZip()}
          >
            {isExporting ? 'ZIP 出力中…' : '検索結果を ZIP 出力'}
          </button>
        </div>
      </header>

      <section className="scanner-legal-admin-search">
        <h3>検索条件</h3>
        <div className="accounting-form-grid">
          <label>
            取引日（開始）
            <input
              type="date"
              value={filters.transactionDateFrom}
              onChange={(event) => updateFilter('transactionDateFrom', event.target.value)}
            />
          </label>
          <label>
            取引日（終了）
            <input
              type="date"
              value={filters.transactionDateTo}
              onChange={(event) => updateFilter('transactionDateTo', event.target.value)}
            />
          </label>
          <label>
            金額（下限）
            <input
              type="text"
              inputMode="numeric"
              value={filters.amountMin}
              onChange={(event) => updateFilter('amountMin', event.target.value)}
            />
          </label>
          <label>
            金額（上限）
            <input
              type="text"
              inputMode="numeric"
              value={filters.amountMax}
              onChange={(event) => updateFilter('amountMax', event.target.value)}
            />
          </label>
          <label>
            支払先（部分一致）
            <input
              type="text"
              value={filters.vendorQuery}
              onChange={(event) => updateFilter('vendorQuery', event.target.value)}
            />
          </label>
          <label>
            法定状態
            <select
              value={filters.legalStatus}
              onChange={(event) =>
                updateFilter('legalStatus', event.target.value as ScannerReceiptListFilters['legalStatus'])
              }
            >
              <option value="all">すべて</option>
              {ACCOUNTING_RECEIPT_LEGAL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEGAL_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            receiptId
            <input
              type="text"
              value={filters.receiptId}
              onChange={(event) => updateFilter('receiptId', event.target.value)}
            />
          </label>
          <label>
            書類種別
            <select
              value={filters.documentType}
              onChange={(event) =>
                updateFilter('documentType', event.target.value as ScannerReceiptListFilters['documentType'])
              }
            >
              <option value="">すべて</option>
              <option value="image">画像</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <label>
            勘定科目（部分一致）
            <input
              type="text"
              value={filters.accountCategory}
              onChange={(event) => updateFilter('accountCategory', event.target.value)}
            />
          </label>
          <label className="scanner-legal-admin-checkbox">
            <input
              type="checkbox"
              checked={filters.includeDeleted}
              onChange={(event) => updateFilter('includeDeleted', event.target.checked)}
            />
            削除済みを含む
          </label>
        </div>
        <div className="receipt-scanner-actions">
          <button type="button" className="primary-action" disabled={isSearching} onClick={() => void runSearch()}>
            {isSearching ? '検索中…' : '検索'}
          </button>
        </div>
        {searchResult?.activeConditionLabels.length ? (
          <p className="accounting-note">条件: {searchResult.activeConditionLabels.join(' / ')}</p>
        ) : null}
        {searchResult?.truncated ? (
          <p className="scanner-legal-admin-warning" role="status">
            検索結果が上限を超えています。条件を絞るか receiptId で直接指定してください。
          </p>
        ) : null}
      </section>

      <div className="scanner-legal-admin-layout">
        <section className="scanner-legal-admin-results">
          <h3>検索結果 ({searchResult?.totalCount ?? 0} 件)</h3>
          <div className="accounting-table-wrap">
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>取引日</th>
                  <th>金額</th>
                  <th>支払先</th>
                  <th>法定状態</th>
                  <th>TS</th>
                  <th>receiptId</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>
                {(searchResult?.items ?? []).map((receipt) => {
                  const amount = getReceiptAmount(receipt)
                  const paperRequired = requiresPaperOriginalRetention({
                    captureMode: receipt.captureMode,
                    legalStatus: receipt.legalStatus,
                    timestampStatus: receipt.timestampStatus,
                    requiresPaperOriginal: receipt.requiresPaperOriginal,
                    receivedDate: receipt.receivedDate,
                  })
                  const isDeleted =
                    receipt.legalStatus === 'deleted' || receipt.isDeleted === true
                  return (
                    <tr
                      key={receipt.id}
                      className={selectedReceiptId === receipt.id ? 'scanner-legal-admin-row-selected' : ''}
                      onClick={() => setSelectedReceiptId(receipt.id)}
                    >
                      <td>{receipt.transactionDate || '—'}</td>
                      <td>{amount != null ? formatFareYen(amount) : '—'}</td>
                      <td>{getReceiptVendor(receipt)}</td>
                      <td>
                        {receipt.legalStatus
                          ? LEGAL_STATUS_LABELS[receipt.legalStatus]
                          : '—'}
                      </td>
                      <td>
                        {receipt.timestampStatus
                          ? TIMESTAMP_STATUS_LABELS[receipt.timestampStatus]
                          : '—'}
                      </td>
                      <td>
                        <code>{receipt.id}</code>
                      </td>
                      <td>
                        {paperRequired ? (
                          <span className="scanner-legal-admin-badge scanner-legal-admin-badge-paper">
                            紙原本
                          </span>
                        ) : null}
                        {isDeleted ? (
                          <span className="scanner-legal-admin-badge scanner-legal-admin-badge-deleted">
                            削除
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="scanner-legal-admin-detail">
          <h3>詳細</h3>
          {!selectedReceipt ? (
            <p className="accounting-note">行を選択してください。</p>
          ) : (
            <>
              {paperRetentionRequired ? (
                <div className="receipt-scanner-legal-banner" role="status">
                  {selectedReceipt.legalStatus === 'legal_pending_timestamp' &&
                  selectedReceipt.timestampStatus !== 'issued' ? (
                    <>
                      <strong>{LEGAL_PENDING_TIMESTAMP_USER_LABELS.title}</strong>
                      <p>{LEGAL_PENDING_TIMESTAMP_USER_LABELS.subtitle}</p>
                      <p>{LEGAL_PENDING_TIMESTAMP_USER_LABELS.notice}</p>
                    </>
                  ) : selectedReceipt.timestampStatus !== 'issued' ? (
                    <>
                      <strong>{LEGAL_TIMESTAMP_UNCONFIGURED_LABELS.title}</strong>
                      <p>{LEGAL_TIMESTAMP_UNCONFIGURED_LABELS.subtitle}</p>
                      <p>{LEGAL_TIMESTAMP_UNCONFIGURED_LABELS.notice}</p>
                    </>
                  ) : (
                    <p>紙原本の保管が必要です（期限超過保存など）。</p>
                  )}
                </div>
              ) : null}

              <MasterPreview receiptId={selectedReceipt.id} />

              <dl className="accounting-audit-grid scanner-legal-admin-meta">
                <div>
                  <dt>receiptId</dt>
                  <dd>
                    <code>{selectedReceipt.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>版</dt>
                  <dd>
                    v{selectedReceipt.version ?? 1} / active v
                    {selectedReceipt.activeVersion ?? selectedReceipt.version ?? 1}
                  </dd>
                </div>
                <div>
                  <dt>取引日</dt>
                  <dd>{selectedReceipt.transactionDate || '—'}</dd>
                </div>
                <div>
                  <dt>受領日</dt>
                  <dd>{selectedReceipt.receivedDate || '—'}</dd>
                </div>
                <div>
                  <dt>発見日</dt>
                  <dd>{selectedReceipt.foundDate || '—'}</dd>
                </div>
                <div>
                  <dt>金額</dt>
                  <dd>
                    {getReceiptAmount(selectedReceipt) != null
                      ? formatFareYen(getReceiptAmount(selectedReceipt)!)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>支払先</dt>
                  <dd>{getReceiptVendor(selectedReceipt)}</dd>
                </div>
                <div>
                  <dt>経費 ID</dt>
                  <dd>{linkedExpense?.id || selectedReceipt.linkedExpenseId || '—'}</dd>
                </div>
                <div>
                  <dt>DPI</dt>
                  <dd>{selectedReceipt.estimatedDpi ?? '—'}</dd>
                </div>
                <div>
                  <dt>解像度</dt>
                  <dd>
                    {selectedReceipt.legalWidthPx ?? '—'} × {selectedReceipt.legalHeightPx ?? '—'} px
                  </dd>
                </div>
                <div>
                  <dt>fileHash</dt>
                  <dd>
                    <code>{selectedReceipt.fileHash || selectedReceipt.imageHash || '—'}</code>
                  </dd>
                </div>
                <div>
                  <dt>法定状態</dt>
                  <dd>
                    {selectedReceipt.legalStatus
                      ? LEGAL_STATUS_LABELS[selectedReceipt.legalStatus]
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>タイムスタンプ</dt>
                  <dd>
                    {selectedReceipt.timestampStatus
                      ? TIMESTAMP_STATUS_LABELS[selectedReceipt.timestampStatus]
                      : '—'}
                    {selectedReceipt.timestampProvider
                      ? ` (${selectedReceipt.timestampProvider})`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt>timestampedAt</dt>
                  <dd>{selectedReceipt.timestampedAt || '—'}</dd>
                </div>
                <div>
                  <dt>verifiedAt</dt>
                  <dd>{selectedReceipt.timestampVerifiedAt || '—'}</dd>
                </div>
                <div>
                  <dt>tokenId</dt>
                  <dd>{selectedReceipt.timestampTokenId || '—'}</dd>
                </div>
                <div>
                  <dt>保存期限目安</dt>
                  <dd>{selectedReceipt.retentionUntil || '—'}</dd>
                </div>
                {deadline ? (
                  <>
                    <div>
                      <dt>入力期限</dt>
                      <dd>{deadline.dueDate || '算出不可'}</dd>
                    </div>
                    <div>
                      <dt>期限超過</dt>
                      <dd>{deadline.isOverdue ? 'はい' : 'いいえ'}</dd>
                    </div>
                    <div>
                      <dt>残営業日</dt>
                      <dd>{deadline.remainingBusinessDays ?? '—'}</dd>
                    </div>
                  </>
                ) : null}
              </dl>

              {(linkedExpense || selectedReceipt.linkedExpenseId) && onOpenExpense ? (
                <div className="receipt-scanner-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() =>
                      onOpenExpense(linkedExpense?.id || selectedReceipt.linkedExpenseId || '')
                    }
                  >
                    関連する経費を表示
                  </button>
                </div>
              ) : (
                <p className="accounting-note">関連経費: 未紐付</p>
              )}

              {canManageLegal ? (
                <section className="scanner-legal-admin-actions">
                  <h4>管理操作</h4>
                  <div className="receipt-scanner-actions">
                    <button
                      type="button"
                      className="primary-action"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void handleIssueTimestamp()}
                    >
                      {actionBusy === 'timestamp' ? '発行中…' : 'タイムスタンプを発行/再試行'}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void handleVerifyTimestamp()}
                    >
                      {actionBusy === 'verify' ? '検証中…' : 'タイムスタンプを検証'}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void handleHashCheck()}
                    >
                      {actionBusy === 'hash' ? '照合中…' : 'ハッシュ照合'}
                    </button>
                  </div>
                  {verifyMessage ? <p className="accounting-note">{verifyMessage}</p> : null}
                  {hashCheckMessage ? <p className="accounting-note">{hashCheckMessage}</p> : null}

                  <div className="accounting-form-grid">
                    <label>
                      経費 ID（経理確認）
                      <input
                        type="text"
                        value={confirmExpenseId}
                        onChange={(event) => setConfirmExpenseId(event.target.value)}
                        placeholder={linkedExpense?.id || 'expenseId'}
                      />
                    </label>
                    <label>
                      削除理由
                      <select
                        value={deleteReason}
                        onChange={(event) =>
                          setDeleteReason(event.target.value as ScannerDeleteReason)
                        }
                      >
                        {Object.entries(SCANNER_DELETE_REASON_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="receipt-scanner-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void handleConfirmAccounting()}
                    >
                      {actionBusy === 'confirm' ? '確認中…' : '経理確認'}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void handleDelete()}
                    >
                      {actionBusy === 'delete'
                        ? '削除中…'
                        : canHardDeleteScannerReceipt({
                              legalStatus: selectedReceipt.legalStatus,
                              timestampStatus: selectedReceipt.timestampStatus,
                            })
                          ? '完全削除'
                          : '論理削除'}
                    </button>
                  </div>
                </section>
              ) : (
                <p className="accounting-note">管理操作は owner / hq_admin / franchisee_owner のみ利用できます。</p>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  )
}
