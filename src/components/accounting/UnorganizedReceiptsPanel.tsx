import { formatFareYen } from '../../services/fare'
import type { StoredAccountingReceipt } from '../../services/accountingReceipts'
import {
  getAccountingReceiptOriginalFileUrl,
  getAccountingReceiptPreviewImageUrl,
} from '../../services/accountingReceipts'
import {
  ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  TAX_CATEGORY_LABELS,
} from '../../types/accounting'
import { formatReceiptSavedAt, hasStoredAccountingReceiptOcrImage } from '../../utils/accountingExpenseForm'
import { isAccountingReceiptPdfMime } from '../../utils/accountingReceiptFile'

type UnorganizedReceiptsPanelProps = {
  receipts: StoredAccountingReceipt[]
  ocrRunningReceiptId: string
  ocrStatusByReceiptId: Record<string, string>
  onRegisterAsExpense: (receipt: StoredAccountingReceipt) => void
  onRunOcr: (receipt: StoredAccountingReceipt) => void
  onConfirm: (receipt: StoredAccountingReceipt) => void
  onReject: (receipt: StoredAccountingReceipt) => void
  onDelete: (receiptId: string) => void
}

const isPdfReceipt = (receipt: StoredAccountingReceipt) =>
  receipt.documentType === 'pdf' ||
  isAccountingReceiptPdfMime(receipt.mimeType) ||
  isAccountingReceiptPdfMime(receipt.originalMimeType)

export function UnorganizedReceiptsPanel({
  receipts,
  ocrRunningReceiptId,
  ocrStatusByReceiptId,
  onRegisterAsExpense,
  onRunOcr,
  onConfirm,
  onReject,
  onDelete,
}: UnorganizedReceiptsPanelProps) {
  return (
    <section className="accounting-panel accounting-unorganized-panel" aria-label="未整理の領収書">
      <h2>未整理の領収書 ({receipts.length})</h2>
      <p className="accounting-note">
        スマホで一時保存した領収書です（draft / ocr_ready）。PL・集計には反映されません。
        「編集する」で経費登録へ移動し、内容を確認して「確定する」で経費登録してください。
      </p>
      {receipts.length > 0 ? (
        <>
          <div className="accounting-unorganized-cards">
            {receipts.map((receipt) => {
              const previewUrl = getAccountingReceiptPreviewImageUrl(receipt)
              const originalUrl = getAccountingReceiptOriginalFileUrl(receipt)
              const pdf = isPdfReceipt(receipt)

              return (
                <article key={receipt.id} className="accounting-unorganized-card">
                  {previewUrl ? (
                    <div className="accounting-unorganized-thumb-wrap">
                      <img alt="領収書サムネイル" className="accounting-unorganized-thumb" src={previewUrl} />
                      {pdf ? (
                        <span className="accounting-unorganized-pdf-badge">
                          {receipt.pdfPageCount != null ? `PDF・全${receipt.pdfPageCount}ページ` : 'PDF'}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="accounting-unorganized-thumb accounting-unorganized-thumb--empty">
                      {pdf ? 'PDF（プレビューなし）' : '画像なし'}
                    </div>
                  )}
                  <div className="accounting-unorganized-body">
                    <header>
                      <strong>
                        {receipt.confirmed?.vendorName ||
                          receipt.ocrCandidates?.vendorName ||
                          receipt.vendorNameCandidate ||
                          '（仕入先候補なし）'}
                      </strong>
                      <span>
                        {ACCOUNTING_RECEIPT_WORKFLOW_STATUS_LABELS[receipt.receiptStatus ?? 'draft'] ||
                          RECEIPT_STATUS_LABELS[receipt.status]}
                      </span>
                    </header>
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
                              receipt.confirmed?.invoiceStatus || receipt.ocrCandidates?.invoiceStatus || 'unknown'
                            ]
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>税区分</dt>
                        <dd>
                          {
                            TAX_CATEGORY_LABELS[
                              receipt.confirmed?.taxCategory || receipt.ocrCandidates?.taxCategory || 'taxable'
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
                    <div className="accounting-unorganized-primary-actions">
                      <button className="primary-action" type="button" onClick={() => onRegisterAsExpense(receipt)}>
                        編集する
                      </button>
                      <button className="secondary-action" type="button" onClick={() => onDelete(receipt.id)}>
                        削除
                      </button>
                      {pdf && originalUrl ? (
                        <a
                          className="secondary-action accounting-receipt-pdf-open"
                          href={originalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          PDF原本を開く
                        </a>
                      ) : null}
                    </div>
                    <div className="accounting-unorganized-actions">
                      <button
                        className="secondary-action"
                        disabled={!hasStoredAccountingReceiptOcrImage(receipt) || ocrRunningReceiptId === receipt.id}
                        type="button"
                        onClick={() => onRunOcr(receipt)}
                      >
                        {ocrRunningReceiptId === receipt.id ? 'OCR読取中…' : 'OCR読取'}
                      </button>
                      <button className="primary-action" type="button" onClick={() => onConfirm(receipt)}>
                        確定する
                      </button>
                      <button className="secondary-action" type="button" onClick={() => onReject(receipt)}>
                        登録しない
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="accounting-table-wrap accounting-table-wrap--desktop accounting-unorganized-table-wrap">
            <table className="accounting-table accounting-table--desktop">
              <thead>
                <tr>
                  <th>保存日</th>
                  <th>仕入先候補</th>
                  <th>金額候補</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{formatReceiptSavedAt(receipt)}</td>
                    <td>{receipt.vendorNameCandidate || '―'}</td>
                    <td>
                      {receipt.amountTotalCandidate != null ? formatFareYen(receipt.amountTotalCandidate) : '―'}
                    </td>
                    <td>{RECEIPT_STATUS_LABELS[receipt.status]}</td>
                    <td>
                      <div className="accounting-unorganized-table-actions">
                        <button className="primary-action" type="button" onClick={() => onRegisterAsExpense(receipt)}>
                          編集する
                        </button>
                        <button className="secondary-action" type="button" onClick={() => onDelete(receipt.id)}>
                          削除
                        </button>
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
