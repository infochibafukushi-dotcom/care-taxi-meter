import { useEffect, useMemo, useRef, useState } from 'react'
import { LEGAL_PENDING_TIMESTAMP_USER_LABELS } from '../../types/accountingReceiptLegal'
import type { ReceiptPaperSizeType } from '../../types/accountingReceiptLegal'
import { useReceiptScanSession } from '../../hooks/useReceiptScanSession'
import { saveAccountingReceiptLegalPendingTimestamp } from '../../services/accountingReceiptLegalSave'
import { runAccountingReceiptOcr } from '../../services/accountingReceiptOcr'
import { applyOcrCandidatesToAccountingReceipt } from '../../services/accountingReceipts'
import {
  applyAccountingReceiptOcrToExpense,
  type AccountingReceiptOcrResult,
} from '../../utils/accountingExpenseForm'
import type { AccountingExpenseInput } from '../../types/accounting'
import { ReceiptCornerEditor } from './ReceiptCornerEditor'
import { PAPER_PRESETS } from '../../utils/receiptLegalDpi'

export type ReceiptScannerCompletedPayload = {
  receiptId: string
  fileHash: string
  imageHash: string
  legalMasterStoragePath: string
  thumbnailStoragePath: string
  legalStatus: 'legal_pending_timestamp'
  captureMode: 'scanner_v1'
  previewObjectUrl: string
  ocrBlob: Blob
  transactionDate: string
  receivedDate: string
  capturedAt: string
  estimatedDpi: number
  expensePatch: Partial<AccountingExpenseInput>
  ocrResult?: AccountingReceiptOcrResult
}

type Props = {
  open: boolean
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  /** 親が渡す初期ファイル（撮影/選択直後） */
  initialFile?: File | null
  onClose: () => void
  onCompleted: (payload: ReceiptScannerCompletedPayload) => void
  /** 解像度不足時に通常経費登録へフォールバック */
  onFallbackLegacy?: (file: File) => void
}

export function ReceiptScannerFlow({
  open,
  franchiseeId,
  storeId,
  staffId,
  staffName,
  initialFile,
  onClose,
  onCompleted,
  onFallbackLegacy,
}: Props) {
  const session = useReceiptScanSession()
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [orientedPreviewUrl, setOrientedPreviewUrl] = useState('')
  const [confirmWhole, setConfirmWhole] = useState(false)
  const [confirmReadable, setConfirmReadable] = useState(false)
  const [confirmSame, setConfirmSame] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [ocrMessage, setOcrMessage] = useState('')
  const [ocrResult, setOcrResult] = useState<AccountingReceiptOcrResult | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const startedFileRef = useRef<File | null>(null)

  useEffect(() => {
    if (!open) {
      startedFileRef.current = null
      session.resetSession()
      setOrientedPreviewUrl('')
      setConfirmWhole(false)
      setConfirmReadable(false)
      setConfirmSame(false)
      setZoom(1)
      setOcrMessage('')
      setOcrResult(null)
      setIsSaving(false)
      savingRef.current = false
      return
    }
    if (initialFile && startedFileRef.current !== initialFile) {
      startedFileRef.current = initialFile
      void session.beginWithFile(initialFile)
    }
    // beginWithFile / resetSession は hook 内 useCallback。open/file 変化時のみ起動する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile])

  useEffect(() => {
    if (!session.orientedCanvas) {
      setOrientedPreviewUrl('')
      return
    }
    let cancelled = false
    session.orientedCanvas.toBlob((blob) => {
      if (cancelled || !blob) {
        return
      }
      const url = URL.createObjectURL(blob)
      setOrientedPreviewUrl((current) => {
        if (current.startsWith('blob:')) {
          URL.revokeObjectURL(current)
        }
        return url
      })
    }, 'image/jpeg', 0.85)
    return () => {
      cancelled = true
    }
  }, [session.orientedCanvas])

  useEffect(
    () => () => {
      if (orientedPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(orientedPreviewUrl)
      }
    },
    [orientedPreviewUrl],
  )

  const canConfirmSave = confirmWhole && confirmReadable && confirmSame && !isSaving

  const paperOptions = useMemo(
    () => PAPER_PRESETS.filter((item) => item.type !== 'unknown' && item.type !== 'custom'),
    [],
  )

  if (!open) {
    return null
  }

  const handlePick = (file: File | null) => {
    if (!file) {
      return
    }
    void session.beginWithFile(file)
  }

  const handleRetake = () => {
    session.resetSession()
    setOcrResult(null)
    setOcrMessage('')
    setConfirmWhole(false)
    setConfirmReadable(false)
    setConfirmSame(false)
    cameraInputRef.current?.click()
  }

  const handlePrepareAndOcr = async () => {
    const prepared = await session.prepareMasterAndOcr()
    if (!prepared) {
      return
    }
    setOcrMessage('OCR読取中…')
    try {
      const result = await runAccountingReceiptOcr({
        imageBlob: prepared.ocrBlob,
        mimeType: 'image/jpeg',
        isPreparedOcrImage: true,
      })
      setOcrResult(result)
      const date =
        result.parsed.receiptDate ||
        result.parsed.transactionDate ||
        result.parsed.postingDate ||
        ''
      if (date) {
        session.setDates({ transactionDate: date, receivedSameAsTransaction: true })
      }
      setOcrMessage(result.message || 'OCR完了。内容を確認してください。')
    } catch (error) {
      setOcrMessage(error instanceof Error ? error.message : 'OCRに失敗しました。手入力できます。')
    }
  }

  const handleSave = async () => {
    if (savingRef.current || isSaving) {
      return
    }
    if (!session.legalMasterBlob || !session.thumbnailBlob || !session.paper || !session.quality) {
      return
    }
    savingRef.current = true
    setIsSaving(true)
    session.markSaving()
    try {
      const saved = await saveAccountingReceiptLegalPendingTimestamp({
        franchiseeId,
        storeId,
        uploadedBy: staffId,
        uploadedByName: staffName,
        legalMasterBlob: session.legalMasterBlob,
        thumbnailBlob: session.thumbnailBlob,
        paper: session.paper,
        widthPx: session.quality.widthPx,
        heightPx: session.quality.heightPx,
        estimatedDpi: session.quality.estimatedDpi,
        capturedAt: session.capturedAt,
        transactionDate: session.transactionDate,
        receivedDate: session.receivedDate,
      })

      let expensePatch: Partial<AccountingExpenseInput> = {
        receiptId: saved.receiptId,
        receiptFileStoragePath: saved.legalMasterStoragePath,
        receiptPreviewStoragePath: saved.thumbnailStoragePath,
        receiptStoragePath: saved.thumbnailStoragePath,
        receiptFileName: 'legal-master.jpg',
        receiptFileMimeType: 'image/jpeg',
        imageHash: saved.imageHash,
        receiptDate: session.transactionDate || undefined,
        postingDate: session.transactionDate || undefined,
        transactionDate: session.transactionDate || '',
      }

      if (ocrResult && session.ocrBlob) {
        const base = {
          franchiseeId,
          storeId,
          vendorName: '',
          description: '',
          expenseCategory: '' as const,
          taxIncludedAmount: 0,
          taxRate: null,
          consumptionTaxAmount: 0,
          paymentMethod: '' as const,
          confirmationStatus: '未確認' as const,
          createdBy: staffId,
          createdByName: staffName,
          updatedBy: staffId,
          updatedByName: staffName,
          transactionDate: session.transactionDate || '',
          companyId: franchiseeId,
        }
        expensePatch = {
          ...applyAccountingReceiptOcrToExpense(
            { ...base, ...expensePatch } as AccountingExpenseInput,
            ocrResult,
          ),
          ...expensePatch,
        }
        try {
          await applyOcrCandidatesToAccountingReceipt({
            receiptId: saved.receiptId,
            ocr: ocrResult,
            editedBy: staffId,
          })
        } catch {
          // OCR候補保存失敗でも確定画像は保持
        }
      }

      const previewObjectUrl = URL.createObjectURL(session.legalMasterBlob)
      session.markDone()
      onCompleted({
        receiptId: saved.receiptId,
        fileHash: saved.fileHash,
        imageHash: saved.imageHash,
        legalMasterStoragePath: saved.legalMasterStoragePath,
        thumbnailStoragePath: saved.thumbnailStoragePath,
        legalStatus: 'legal_pending_timestamp',
        captureMode: 'scanner_v1',
        previewObjectUrl,
        ocrBlob: session.ocrBlob ?? session.legalMasterBlob,
        transactionDate: session.transactionDate,
        receivedDate: session.receivedDate,
        capturedAt: session.capturedAt,
        estimatedDpi: session.quality.estimatedDpi,
        expensePatch,
        ocrResult: ocrResult ?? undefined,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '正式保存準備に失敗しました。'
      session.markSaveFailed(message)
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  return (
    <div className="receipt-scanner-overlay" role="dialog" aria-modal="true" aria-label="領収書スキャナ">
      <div className="receipt-scanner-panel">
        <header className="receipt-scanner-header">
          <h2>領収書スキャナ</h2>
          <button type="button" className="secondary-action" onClick={onClose} disabled={isSaving}>
            閉じる
          </button>
        </header>

        {session.errorMessage ? (
          <p className="accounting-receipt-error" role="alert">
            {session.errorMessage}
          </p>
        ) : null}

        {session.step === 'idle' || !session.orientedCanvas ? (
          <div className="receipt-scanner-section">
            <p>領収書を撮影するか、画像を選択してください。</p>
            <div className="receipt-scanner-actions">
              <label className="accounting-receipt-upload-button primary-action">
                領収書を撮影
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="accounting-hidden-input"
                  onChange={(event) => {
                    handlePick(event.target.files?.[0] ?? null)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              <label className="accounting-receipt-upload-button secondary-action">
                画像から選択
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="accounting-hidden-input"
                  onChange={(event) => {
                    handlePick(event.target.files?.[0] ?? null)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            </div>
            <p className="accounting-note">対応形式: JPG / PNG / WebP（HEICは非対応）</p>
          </div>
        ) : null}

        {session.step === 'corners' && session.orientedCanvas && session.corners && orientedPreviewUrl ? (
          <div className="receipt-scanner-section">
            <h3>領収書の範囲を確認</h3>
            {session.detectMessage ? (
              <p className="accounting-note">{session.detectMessage}</p>
            ) : null}
            <ReceiptCornerEditor
              imageUrl={orientedPreviewUrl}
              imageWidth={session.orientedCanvas.width}
              imageHeight={session.orientedCanvas.height}
              corners={session.corners}
              onChange={session.setCorners}
              disabled={session.busy}
            />
            <div className="receipt-scanner-actions">
              <button type="button" className="secondary-action" disabled={session.busy} onClick={() => void session.redetectCorners()}>
                自動検出し直す
              </button>
              <button type="button" className="secondary-action" disabled={session.busy} onClick={session.useFullImageCorners}>
                画像全体を使用
              </button>
              <button type="button" className="secondary-action" disabled={session.busy} onClick={handleRetake}>
                撮り直す
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={session.busy}
                onClick={() => void session.applyCornersAndCheckQuality()}
              >
                この範囲で補正
              </button>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="accounting-hidden-input"
              onChange={(event) => {
                handlePick(event.target.files?.[0] ?? null)
                event.currentTarget.value = ''
              }}
            />
          </div>
        ) : null}

        {session.step === 'quality' && session.correctedPreviewUrl ? (
          <div className="receipt-scanner-section">
            <h3>領収書を確認</h3>
            <div className="receipt-scanner-preview-wrap" style={{ overflow: 'auto', maxHeight: '50vh' }}>
              <img
                alt="補正後領収書"
                src={session.correctedPreviewUrl}
                style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
              />
            </div>
            <label className="receipt-scanner-zoom">
              拡大
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>

            <div className="receipt-scanner-paper">
              <p>用紙サイズ</p>
              <div className="receipt-scanner-actions">
                {paperOptions.map((preset) => (
                  <button
                    key={preset.type}
                    type="button"
                    className={
                      session.paper?.paperSizeType === preset.type
                        ? 'primary-action'
                        : 'secondary-action'
                    }
                    onClick={() => session.selectPaper(preset.type as ReceiptPaperSizeType)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {session.needsPaperConfirm ? (
                <p className="accounting-receipt-error">用紙サイズを確認してください</p>
              ) : null}
            </div>

            {session.quality ? (
              <ul className="receipt-scanner-quality">
                <li>画質: {session.quality.ok ? 'OK' : 'NG'}</li>
                <li>解像度: {Math.round(session.quality.estimatedDpi)}dpi相当</li>
                <li>カラー: {session.quality.isColor ? 'OK' : 'NG'}</li>
              </ul>
            ) : null}

            {!session.quality?.ok && session.quality ? (
              <div className="receipt-scanner-section">
                <p className="accounting-receipt-error">
                  スキャナ保存用の解像度が不足しています。もう少し領収書に近づいて撮影してください。
                </p>
                <div className="receipt-scanner-actions">
                  <button type="button" className="secondary-action" onClick={handleRetake}>
                    撮り直す
                  </button>
                  {onFallbackLegacy && session.sourceFile ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => onFallbackLegacy(session.sourceFile!)}
                    >
                      紙原本保存前提で通常経費として登録
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="receipt-scanner-actions">
              <button type="button" className="secondary-action" onClick={session.backToCorners}>
                四隅を修正
              </button>
              <button type="button" className="secondary-action" onClick={handleRetake}>
                撮り直す
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={session.busy || !session.quality?.ok || session.needsPaperConfirm}
                onClick={() => void handlePrepareAndOcr()}
              >
                OCRへ進む
              </button>
            </div>
          </div>
        ) : null}

        {(session.step === 'review' || session.step === 'saving' || session.step === 'done') &&
        session.correctedPreviewUrl ? (
          <div className="receipt-scanner-section">
            <h3>最終確認</h3>
            {session.step === 'done' || session.legalStatus === 'legal_pending_timestamp' ? (
              <div className="receipt-scanner-legal-banner" role="status">
                <strong>{LEGAL_PENDING_TIMESTAMP_USER_LABELS.title}</strong>
                <div>{LEGAL_PENDING_TIMESTAMP_USER_LABELS.subtitle}</div>
                <div>{LEGAL_PENDING_TIMESTAMP_USER_LABELS.notice}</div>
              </div>
            ) : null}

            <div className="receipt-scanner-preview-wrap" style={{ overflow: 'auto', maxHeight: '40vh' }}>
              <img
                alt="確認用領収書"
                src={session.correctedPreviewUrl}
                style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
              />
            </div>

            <label>
              取引日
              <input
                type="date"
                value={session.transactionDate}
                onChange={(event) =>
                  session.setDates({ transactionDate: event.target.value })
                }
              />
            </label>
            <label className="receipt-scanner-check">
              <input
                type="checkbox"
                checked={session.receivedSameAsTransaction}
                onChange={(event) =>
                  session.setDates({ receivedSameAsTransaction: event.target.checked })
                }
              />
              受領日は取引日と同じ
            </label>
            {!session.receivedSameAsTransaction ? (
              <label>
                受領日
                <input
                  type="date"
                  value={session.receivedDate}
                  onChange={(event) =>
                    session.setDates({
                      receivedDate: event.target.value,
                      receivedSameAsTransaction: false,
                    })
                  }
                />
              </label>
            ) : null}

            {ocrMessage ? <p className="accounting-note">{ocrMessage}</p> : null}
            {ocrResult?.parsed ? (
              <ul className="receipt-scanner-quality">
                <li>金額候補: {ocrResult.parsed.taxIncludedAmount ?? '—'}</li>
                <li>取引先候補: {ocrResult.parsed.vendorName || '—'}</li>
                <li>インボイス候補: {ocrResult.parsed.invoiceNumber || '—'}</li>
              </ul>
            ) : null}

            <label className="receipt-scanner-check">
              <input
                type="checkbox"
                checked={confirmWhole}
                onChange={(event) => setConfirmWhole(event.target.checked)}
              />
              領収書全体が写っている
            </label>
            <label className="receipt-scanner-check">
              <input
                type="checkbox"
                checked={confirmReadable}
                onChange={(event) => setConfirmReadable(event.target.checked)}
              />
              日付・金額・取引先が読める
            </label>
            <label className="receipt-scanner-check">
              <input
                type="checkbox"
                checked={confirmSame}
                onChange={(event) => setConfirmSame(event.target.checked)}
              />
              紙原本と画像が同一である
            </label>

            <div className="receipt-scanner-actions">
              <button
                type="button"
                className="secondary-action"
                disabled={isSaving}
                onClick={() => {
                  session.resetSession()
                  onClose()
                }}
              >
                削除
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={!canConfirmSave}
                onClick={() => void handleSave()}
              >
                {isSaving ? '保存中…' : '正式保存準備へ進む'}
              </button>
            </div>
            <p className="accounting-note">
              ※タイムスタンプ未実装のため、確定後も「正式スキャナ保存済み」にはなりません。紙原本を保管してください。
            </p>
          </div>
        ) : null}

        {session.busy && session.step !== 'saving' ? (
          <p className="accounting-note" role="status">
            処理中…
          </p>
        ) : null}
      </div>
    </div>
  )
}
