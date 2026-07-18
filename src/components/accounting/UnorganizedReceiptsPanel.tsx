import { useEffect, useMemo, useRef, useState } from 'react'
import { formatFareYen } from '../../services/fare'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import {
  getAccountingReceiptOriginalFileUrl,
  getAccountingReceiptPreviewImageUrl,
} from '../../services/accountingReceipts'
import { fetchAccountingReceiptAccessUrl } from '../../services/accountingReceiptAccess'
import type { StoredAccountingExpense } from '../../types/accounting'
import {
  ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  TAX_CATEGORY_LABELS,
  isExpenseDeleted,
} from '../../types/accounting'
import { formatReceiptSavedAt, hasStoredAccountingReceiptOcrImage } from '../../utils/accountingExpenseForm'
import { isAccountingReceiptPdfMime } from '../../utils/accountingReceiptFile'
import {
  ORPHAN_RECEIPT_WARNING,
  type AccountingReceiptInboxEntry,
} from '../../utils/accountingReceiptLink'

type UnorganizedReceiptsPanelProps = {
  entries: AccountingReceiptInboxEntry[]
  expenses: StoredAccountingExpense[]
  focusReceiptId?: string
  ocrRunningReceiptId: string
  ocrStatusByReceiptId: Record<string, string>
  onRegisterAsExpense: (receipt: StoredAccountingReceipt) => void
  onRunOcr: (receipt: StoredAccountingReceipt) => void
  onConfirm: (receipt: StoredAccountingReceipt) => void
  onReject: (receipt: StoredAccountingReceipt) => void
  onUnlinkOrphan: (receipt: StoredAccountingReceipt) => void
  onRelinkOrphan: (receipt: StoredAccountingReceipt, expenseId: string) => void
  onInvalidateOrphan: (receipt: StoredAccountingReceipt) => void
  onDelete: (receipt: StoredAccountingReceipt, kind: AccountingReceiptInboxEntry['kind']) => void
  isBusy?: boolean
}

const isPdfReceipt = (receipt: StoredAccountingReceipt) =>
  receipt.documentType === 'pdf' ||
  isAccountingReceiptPdfMime(receipt.mimeType) ||
  isAccountingReceiptPdfMime(receipt.originalMimeType)

const hasThumbSourcePath = (receipt: StoredAccountingReceipt) =>
  Boolean(receipt.ocrImageStoragePath?.trim() || (!isPdfReceipt(receipt) && receipt.storagePath?.trim()))

/**
 * 未整理領収書のサムネイル。
 * receiptId 経由の短期署名 URL（getAccountingReceiptAccessUrl）を優先し、
 * 失敗時のみ旧データの永続 URL を後方互換として使う。
 */
function ReceiptThumb({ receipt }: { receipt: StoredAccountingReceipt }) {
  const [accessUrl, setAccessUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const legacyUrl = getAccountingReceiptPreviewImageUrl(receipt)
  const canFetchAccessUrl = hasThumbSourcePath(receipt)

  useEffect(() => {
    setAccessUrl('')
    setStatus('idle')

    if (!canFetchAccessUrl) {
      return
    }

    let cancelled = false
    setStatus('loading')

    fetchAccountingReceiptAccessUrl({ receiptId: receipt.id, variant: 'preview' })
      .then((result) => {
        if (cancelled) {
          return
        }
        if (result.url) {
          setAccessUrl(result.url)
          setStatus('ready')
        } else {
          setStatus('error')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- receipt.id で十分
  }, [receipt.id, canFetchAccessUrl])

  const displayUrl = accessUrl || (status === 'error' || !canFetchAccessUrl ? legacyUrl : '')

  if (status === 'loading') {
    return (
      <div className="accounting-unorganized-thumb accounting-unorganized-thumb--empty">
        読込中…
      </div>
    )
  }

  if (!displayUrl) {
    return (
      <div className="accounting-unorganized-thumb accounting-unorganized-thumb--empty">
        {isPdfReceipt(receipt) ? 'PDF（プレビューなし）' : '画像なし'}
      </div>
    )
  }

  return <img alt="領収書サムネイル" className="accounting-unorganized-thumb" src={displayUrl} />
}

/**
 * PDF原本を開くリンク。href に永続 URL を持たせず、クリック時に
 * receiptId 経由の短期署名 URL を取得してから window.open する。
 * 旧データで永続 URL しかない場合のみ互換的に使用する。
 */
function PdfOriginalOpenButton({ receipt }: { receipt: StoredAccountingReceipt }) {
  const [isBusy, setIsBusy] = useState(false)
  const legacyOriginalUrl = getAccountingReceiptOriginalFileUrl(receipt)
  const hasOriginalPath = Boolean(receipt.originalStoragePath?.trim() || receipt.storagePath?.trim())

  if (!hasOriginalPath && !legacyOriginalUrl) {
    return null
  }

  const handleOpen = async () => {
    if (isBusy) {
      return
    }
    setIsBusy(true)
    try {
      if (hasOriginalPath) {
        const result = await fetchAccountingReceiptAccessUrl({
          receiptId: receipt.id,
          variant: 'original',
        })
        if (result.url) {
          window.open(result.url, '_blank', 'noopener,noreferrer')
          return
        }
      }
      if (legacyOriginalUrl) {
        window.open(legacyOriginalUrl, '_blank', 'noopener,noreferrer')
      }
    } catch {
      if (legacyOriginalUrl) {
        window.open(legacyOriginalUrl, '_blank', 'noopener,noreferrer')
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <button
      className="secondary-action accounting-receipt-pdf-open"
      type="button"
      disabled={isBusy}
      onClick={() => void handleOpen()}
    >
      {isBusy ? '開いています…' : 'PDF原本を開く'}
    </button>
  )
}

export function UnorganizedReceiptsPanel({
  entries,
  expenses,
  focusReceiptId = '',
  ocrRunningReceiptId,
  ocrStatusByReceiptId,
  onRegisterAsExpense,
  onRunOcr,
  onConfirm,
  onReject,
  onUnlinkOrphan,
  onRelinkOrphan,
  onInvalidateOrphan,
  onDelete,
  isBusy = false,
}: UnorganizedReceiptsPanelProps) {
  const [relinkReceiptId, setRelinkReceiptId] = useState('')
  const [relinkExpenseId, setRelinkExpenseId] = useState('')
  const focusRef = useRef<HTMLElement | null>(null)

  const unorganizedCount = entries.filter((entry) => entry.kind === 'unorganized').length
  const orphanCount = entries.filter((entry) => entry.kind === 'orphan').length

  const relinkCandidates = useMemo(
    () =>
      expenses.filter(
        (expense) =>
          !isExpenseDeleted(expense) &&
          expense.confirmationStatus !== '無効' &&
          !expense.receiptId?.trim(),
      ),
    [expenses],
  )

  useEffect(() => {
    if (!focusReceiptId || !focusRef.current) {
      return
    }
    focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusReceiptId, entries])

  return (
    <section className="accounting-panel accounting-unorganized-panel" aria-label="未整理の領収書">
      <h2>
        未整理の領収書 ({entries.length}
        {orphanCount > 0 ? ` / リンク切れ ${orphanCount}` : ''})
      </h2>
      <p className="accounting-note">
        スマホで一時保存した領収書（通常未整理 {unorganizedCount}件）です。PL・集計には反映されません。
        「編集する」で経費登録へ移動し、内容を確認して「確定する」で経費登録してください。
        {orphanCount > 0
          ? ` リンク切れ ${orphanCount}件は参照先経費が無い／無効／不一致の証憑です。`
          : ''}
      </p>
      {entries.length > 0 ? (
        <>
          <div className="accounting-unorganized-cards">
            {entries.map((entry) => {
              const { receipt, kind } = entry
              const pdf = isPdfReceipt(receipt)
              const isFocused = focusReceiptId === receipt.id
              const isOrphan = kind === 'orphan'

              return (
                <article
                  key={receipt.id}
                  className={`accounting-unorganized-card${isOrphan ? ' is-orphan' : ''}${
                    isFocused ? ' is-focused' : ''
                  }`}
                  ref={isFocused ? focusRef : undefined}
                  data-receipt-id={receipt.id}
                >
                  <div className="accounting-unorganized-thumb-wrap">
                    <ReceiptThumb receipt={receipt} />
                    {pdf ? (
                      <span className="accounting-unorganized-pdf-badge">
                        {receipt.pdfPageCount != null ? `PDF・全${receipt.pdfPageCount}ページ` : 'PDF'}
                      </span>
                    ) : null}
                  </div>
                  <div className="accounting-unorganized-body">
                    <header>
                      <strong>
                        {receipt.confirmed?.vendorName ||
                          receipt.ocrCandidates?.vendorName ||
                          receipt.vendorNameCandidate ||
                          '（仕入先候補なし）'}
                      </strong>
                      <span>
                        {isOrphan
                          ? 'リンク切れ'
                          : ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS[receipt.receiptStatus ?? 'draft'] ||
                            RECEIPT_STATUS_LABELS[receipt.status]}
                      </span>
                    </header>
                    {isOrphan ? (
                      <p className="accounting-warning" role="alert">
                        {ORPHAN_RECEIPT_WARNING}
                      </p>
                    ) : null}
                    <dl>
                      <div>
                        <dt>保存日</dt>
                        <dd>{formatReceiptSavedAt(receipt)}</dd>
                      </div>
                      <div>
                        <dt>金額候補</dt>
                        <dd>
                          {(receipt.confirmed?.amount ??
                            receipt.ocrCandidates?.amount ??
                            receipt.amountTotalCandidate) != null
                            ? formatFareYen(
                                receipt.confirmed?.amount ??
                                  receipt.ocrCandidates?.amount ??
                                  receipt.amountTotalCandidate ??
                                  0,
                              )
                            : '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>科目候補</dt>
                        <dd>
                          {receipt.confirmed?.accountTitle ||
                            receipt.ocrCandidates?.accountTitle ||
                            receipt.suggestedExpenseCategory ||
                            '―'}
                        </dd>
                      </div>
                      <div>
                        <dt>インボイス</dt>
                        <dd>
                          {
                            INVOICE_STATUS_LABELS[
                              receipt.confirmed?.invoiceStatus ||
                                receipt.ocrCandidates?.invoiceStatus ||
                                'unknown'
                            ]
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>税区分</dt>
                        <dd>
                          {
                            TAX_CATEGORY_LABELS[
                              receipt.confirmed?.taxCategory ||
                                receipt.ocrCandidates?.taxCategory ||
                                'taxable'
                            ]
                          }
                        </dd>
                      </div>
                    </dl>
                    {ocrStatusByReceiptId[receipt.id] ? (
                      <p className="accounting-note accounting-ocr-status" role="status">
                        {ocrStatusByReceiptId[receipt.id]}
                      </p>
                    ) : null}

                    {isOrphan ? (
                      <div className="accounting-unorganized-orphan-actions">
                        <button
                          className="primary-action"
                          type="button"
                          onClick={() => onUnlinkOrphan(receipt)}
                        >
                          リンクを解除して未整理へ戻す
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => {
                            setRelinkReceiptId(receipt.id)
                            setRelinkExpenseId(relinkCandidates[0]?.id ?? '')
                          }}
                        >
                          既存経費へ再紐付け
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => onInvalidateOrphan(receipt)}
                        >
                          証憑を無効化
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={isBusy}
                          onClick={() => onDelete(receipt, 'orphan')}
                        >
                          削除
                        </button>
                        {relinkReceiptId === receipt.id ? (
                          <div className="accounting-unorganized-relink">
                            <label htmlFor={`orphan-relink-${receipt.id}`}>再紐付け先経費</label>
                            <select
                              id={`orphan-relink-${receipt.id}`}
                              value={relinkExpenseId}
                              onChange={(event) => setRelinkExpenseId(event.target.value)}
                            >
                              <option value="">選択してください</option>
                              {relinkCandidates.map((expense) => (
                                <option key={expense.id} value={expense.id}>
                                  {expense.vendorName || '（仕入先なし）'} /{' '}
                                  {formatFareYen(expense.taxIncludedAmount ?? 0)} /{' '}
                                  {expense.postingDate || expense.transactionDate || ''}
                                </option>
                              ))}
                            </select>
                            <div className="accounting-unorganized-table-actions">
                              <button
                                className="primary-action"
                                type="button"
                                disabled={!relinkExpenseId}
                                onClick={() => {
                                  if (!relinkExpenseId) {
                                    return
                                  }
                                  onRelinkOrphan(receipt, relinkExpenseId)
                                  setRelinkReceiptId('')
                                  setRelinkExpenseId('')
                                }}
                              >
                                再紐付けを実行
                              </button>
                              <button
                                className="secondary-action"
                                type="button"
                                onClick={() => {
                                  setRelinkReceiptId('')
                                  setRelinkExpenseId('')
                                }}
                              >
                                キャンセル
                              </button>
                            </div>
                            {relinkCandidates.length === 0 ? (
                              <p className="accounting-note">
                                証憑未設定の経費がありません。先に経費側の証憑を外すか、新規経費として登録してください。
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className="accounting-unorganized-primary-actions">
                          <button
                            className="primary-action"
                            type="button"
                            onClick={() => onRegisterAsExpense(receipt)}
                          >
                            編集する
                          </button>
                          <button
                            className="secondary-action"
                            type="button"
                            disabled={isBusy}
                            onClick={() => onDelete(receipt, 'unorganized')}
                          >
                            削除
                          </button>
                          {pdf ? <PdfOriginalOpenButton receipt={receipt} /> : null}
                        </div>
                        <div className="accounting-unorganized-actions">
                          <button
                            className="secondary-action"
                            disabled={
                              !hasStoredAccountingReceiptOcrImage(receipt) ||
                              ocrRunningReceiptId === receipt.id
                            }
                            type="button"
                            onClick={() => onRunOcr(receipt)}
                          >
                            {ocrRunningReceiptId === receipt.id ? 'OCR読取中…' : 'OCR読取'}
                          </button>
                          <button
                            className="primary-action"
                            type="button"
                            onClick={() => onConfirm(receipt)}
                          >
                            確定する
                          </button>
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => onReject(receipt)}
                          >
                            登録しない
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          <div className="accounting-table-wrap accounting-table-wrap--desktop accounting-unorganized-table-wrap">
            <table className="accounting-table accounting-table--desktop">
              <thead>
                <tr>
                  <th>区分</th>
                  <th>保存日</th>
                  <th>仕入先候補</th>
                  <th>金額候補</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={`table-${entry.receipt.id}`}
                    className={entry.kind === 'orphan' ? 'is-orphan' : undefined}
                  >
                    <td>{entry.kind === 'orphan' ? 'リンク切れ' : '未整理'}</td>
                    <td>{formatReceiptSavedAt(entry.receipt)}</td>
                    <td>{entry.receipt.vendorNameCandidate || '―'}</td>
                    <td>
                      {entry.receipt.amountTotalCandidate != null
                        ? formatFareYen(entry.receipt.amountTotalCandidate)
                        : '―'}
                    </td>
                    <td>
                      {entry.kind === 'orphan'
                        ? 'リンク切れ'
                        : RECEIPT_STATUS_LABELS[entry.receipt.status]}
                    </td>
                    <td>
                      <div className="accounting-unorganized-table-actions">
                        {entry.kind === 'orphan' ? (
                          <>
                            <button
                              className="primary-action"
                              type="button"
                              onClick={() => onUnlinkOrphan(entry.receipt)}
                            >
                              リンク解除
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              disabled={isBusy}
                              onClick={() => onDelete(entry.receipt, 'orphan')}
                            >
                              削除
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="primary-action"
                              type="button"
                              onClick={() => onRegisterAsExpense(entry.receipt)}
                            >
                              編集する
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              disabled={isBusy}
                              onClick={() => onDelete(entry.receipt, 'unorganized')}
                            >
                              削除
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="accounting-note">未整理の領収書はありません。</p>
      )}
    </section>
  )
}
