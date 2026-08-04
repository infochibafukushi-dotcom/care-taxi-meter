import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { StoredAccountingExpenseReport } from '../../types/accountingExpenseReport'
import {
  buildEmptyExpenseReportInput,
  loadAccountingExpenseReportImageBlobUrl,
  saveAccountingExpenseReport,
  softDeleteAccountingExpenseReportWithImages,
  validateExpenseReportImageFile,
  type ExpenseReportDraftImage,
} from '../../services/accountingExpenseReports'
import {
  EXPENSE_REPORT_PRINT_STYLES,
  normalizeExpenseReportBodyForPrint,
  type ExpenseReportPrintModel,
} from '../../utils/accountingExpenseReportPrint'
import { formatExpenseGroupPeriodLabel } from '../../utils/accountingExpenseGroup'
import { formatFareYen } from '../../services/fare'

type Props = {
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  targetType: 'expense' | 'expense_group'
  /** 未保存の場合は空。保存後に紐付け更新する */
  targetId: string
  existingReport?: StoredAccountingExpenseReport | null
  /** auto 日付の初期値 */
  autoStartDate: string | null
  autoEndDate: string | null
  relatedCategoryLabel: string
  relatedAmountYen: number
  /** レポート入力を開くトリガーを外部から制御する場合 */
  forceOpen?: boolean
  disabled?: boolean
  onSaved?: (reportId: string) => void
  onDeleted?: () => void
  onDraftChange?: (draft: {
    enabled: boolean
    title: string
    body: string
    startDate: string | null
    endDate: string | null
    dateMode: 'auto' | 'manual'
    images: ExpenseReportDraftImage[]
  }) => void
}

const createLocalImageId = () =>
  `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export function ExpenseReportEditor({
  franchiseeId,
  storeId,
  staffId,
  staffName,
  targetType,
  targetId,
  existingReport,
  autoStartDate,
  autoEndDate,
  relatedCategoryLabel,
  relatedAmountYen,
  forceOpen = false,
  disabled,
  onSaved,
  onDeleted,
  onDraftChange,
}: Props) {
  const titleId = useId()
  const [enabled, setEnabled] = useState(Boolean(existingReport) || forceOpen)
  const [title, setTitle] = useState(existingReport?.title ?? '')
  const [body, setBody] = useState(existingReport?.body ?? '')
  const [dateMode, setDateMode] = useState<'auto' | 'manual'>(existingReport?.dateMode ?? 'auto')
  const [startDate, setStartDate] = useState(existingReport?.startDate ?? autoStartDate)
  const [endDate, setEndDate] = useState(existingReport?.endDate ?? autoEndDate)
  const [images, setImages] = useState<ExpenseReportDraftImage[]>([])
  const [removedStoragePaths, setRemovedStoragePaths] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const printRootRef = useRef<HTMLDivElement | null>(null)
  const blobUrlsRef = useRef<string[]>([])

  useEffect(() => {
    if (!existingReport) {
      return
    }
    setEnabled(true)
    setTitle(existingReport.title)
    setBody(existingReport.body)
    setDateMode(existingReport.dateMode)
    setStartDate(existingReport.startDate)
    setEndDate(existingReport.endDate)

    let cancelled = false
    const load = async () => {
      const next: ExpenseReportDraftImage[] = []
      for (const image of existingReport.images) {
        let previewUrl = ''
        try {
          previewUrl = await loadAccountingExpenseReportImageBlobUrl(image.storagePath)
          if (previewUrl) {
            blobUrlsRef.current.push(previewUrl)
          }
        } catch {
          previewUrl = ''
        }
        if (cancelled) {
          return
        }
        next.push({
          id: image.id,
          storagePath: image.storagePath,
          previewUrl,
          originalFileName: image.originalFileName,
          mimeType: image.mimeType,
          caption: image.caption ?? '',
          displayOrder: image.displayOrder,
          createdAt: image.createdAt,
          uploadStatus: 'success',
        })
      }
      setImages(next)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [existingReport])

  useEffect(() => {
    if (dateMode !== 'auto') {
      return
    }
    setStartDate(autoStartDate)
    setEndDate(autoEndDate)
  }, [autoStartDate, autoEndDate, dateMode])

  useEffect(() => {
    onDraftChange?.({
      enabled,
      title,
      body,
      startDate,
      endDate,
      dateMode,
      images,
    })
  }, [body, dateMode, enabled, endDate, images, onDraftChange, startDate, title])

  useEffect(
    () => () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      blobUrlsRef.current = []
    },
    [],
  )

  const periodLabel = useMemo(
    () => formatExpenseGroupPeriodLabel(startDate, endDate),
    [endDate, startDate],
  )

  const handleAddPhotos = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return
    }
    const next: ExpenseReportDraftImage[] = []
    const errors: string[] = []
    Array.from(fileList).forEach((file) => {
      const validation = validateExpenseReportImageFile(file)
      if (!validation.ok) {
        errors.push(`${file.name}: ${validation.message}`)
        return
      }
      const previewUrl = URL.createObjectURL(file)
      blobUrlsRef.current.push(previewUrl)
      next.push({
        id: createLocalImageId(),
        file,
        previewUrl,
        originalFileName: file.name,
        mimeType: file.type || 'image/jpeg',
        caption: '',
        displayOrder: images.length + next.length,
        createdAt: new Date().toISOString(),
        uploadStatus: 'pending',
      })
    })
    if (errors.length > 0) {
      setErrorMessage(errors.join('\n'))
    } else {
      setErrorMessage('')
    }
    if (next.length > 0) {
      setImages((current) => [...current, ...next])
    }
  }

  const handleSave = async () => {
    if (isSaving || disabled) {
      return
    }
    if (!targetId.trim()) {
      setErrorMessage('先に経費を保存してからレポートを保存してください。')
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setStatusMessage('')
    try {
      const input = buildEmptyExpenseReportInput({
        franchiseeId,
        storeId,
        staffId,
        staffName,
        targetType,
        targetId,
        title,
        startDate,
        endDate,
      })
      input.body = body
      input.dateMode = dateMode
      input.updatedBy = staffId
      input.updatedByName = staffName

      const result = await saveAccountingExpenseReport({
        mode: existingReport ? 'update' : 'create',
        reportId: existingReport?.id,
        input,
        draftImages: images,
        removedImageStoragePaths: removedStoragePaths,
      })

      if (result.imageUploadFailures.length > 0) {
        setErrorMessage(
          [
            '一部の写真のアップロードに失敗しました。',
            ...result.imageUploadFailures.map(
              (failure) => `${failure.fileName}: ${failure.message}`,
            ),
          ].join('\n'),
        )
      } else {
        setStatusMessage('レポートを保存しました。')
      }
      setRemovedStoragePaths([])
      onSaved?.(result.reportId)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'レポートの保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!existingReport || disabled) {
      return
    }
    const confirmed = window.confirm(
      'このレポートとレポート写真を削除しますか？\n経費本体は削除されません。',
    )
    if (!confirmed) {
      return
    }
    setIsSaving(true)
    try {
      await softDeleteAccountingExpenseReportWithImages({
        report: existingReport,
        deletedBy: staffId,
      })
      setEnabled(false)
      setTitle('')
      setBody('')
      setImages([])
      onDeleted?.()
      setStatusMessage('レポートを削除しました。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'レポートの削除に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePrint = () => {
    const model: ExpenseReportPrintModel = {
      documentTitle: '研修・視察レポート',
      title: title.trim() || '（タイトル未入力）',
      periodLabel,
      relatedCategoryLabel,
      relatedAmountYen,
      body: normalizeExpenseReportBodyForPrint(body),
      photos: images
        .filter((image) => image.previewUrl)
        .map((image) => ({
          src: image.previewUrl!,
          caption: image.caption.trim() || image.originalFileName,
        })),
    }

    setIsPrinting(true)
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
    if (!printWindow) {
      setErrorMessage('印刷ウィンドウを開けませんでした。ポップアップを許可してください。')
      setIsPrinting(false)
      return
    }

    const photosHtml = model.photos
      .map(
        (photo) => `
      <figure class="expense-report-print-photo">
        <img src="${photo.src}" alt="" />
        <figcaption class="expense-report-print-caption">${escapeHtml(photo.caption)}</figcaption>
      </figure>`,
      )
      .join('')

    printWindow.document.write(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(model.title)}</title>
  <style>${EXPENSE_REPORT_PRINT_STYLES}</style>
</head>
<body>
  <article class="expense-report-print-root">
    <h1>${escapeHtml(model.documentTitle)}</h1>
    <dl class="expense-report-print-meta">
      <dt>タイトル</dt><dd>${escapeHtml(model.title)}</dd>
      <dt>実施日</dt><dd>${escapeHtml(model.periodLabel)}</dd>
      <dt>関連経費区分</dt><dd>${escapeHtml(model.relatedCategoryLabel)}</dd>
      <dt>関連経費合計</dt><dd>${escapeHtml(formatFareYen(model.relatedAmountYen))}</dd>
    </dl>
    <section>
      <h2>レポート本文</h2>
      <div class="expense-report-print-body">${escapeHtml(model.body)}</div>
    </section>
    ${
      model.photos.length > 0
        ? `<section><h2>写真</h2><div class="expense-report-print-photos">${photosHtml}</div></section>`
        : ''
    }
  </article>
  <script>
    window.onload = function () {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`)
    printWindow.document.close()
    setIsPrinting(false)
  }

  if (!enabled) {
    return (
      <div className="accounting-expense-report-optional">
        <button
          type="button"
          className="secondary-action"
          disabled={disabled}
          onClick={() => setEnabled(true)}
        >
          レポートを追加（任意）
        </button>
        <p className="accounting-note">レポートは任意です。必要な場合のみ追加してください。</p>
      </div>
    )
  }

  return (
    <section className="accounting-expense-report-editor" aria-labelledby={titleId}>
      <div className="accounting-expense-report-editor-header">
        <h3 id={titleId}>レポート（任意）</h3>
        {!existingReport ? (
          <button
            type="button"
            className="secondary-action"
            disabled={disabled || isSaving}
            onClick={() => {
              setEnabled(false)
              setTitle('')
              setBody('')
              setImages([])
            }}
          >
            レポート入力を閉じる
          </button>
        ) : null}
      </div>

      <label>
        レポートタイトル
        <input
          type="text"
          value={title}
          disabled={disabled || isSaving}
          placeholder="例：福祉機器展示会・介護車両視察レポート"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <fieldset className="accounting-radio-fieldset">
        <legend>日付</legend>
        <div className="accounting-radio-row">
          <label className="accounting-radio-label">
            <input
              type="radio"
              checked={dateMode === 'auto'}
              disabled={disabled || isSaving}
              onChange={() => setDateMode('auto')}
            />
            自動（領収書日付）
          </label>
          <label className="accounting-radio-label">
            <input
              type="radio"
              checked={dateMode === 'manual'}
              disabled={disabled || isSaving}
              onChange={() => setDateMode('manual')}
            />
            手動修正
          </label>
        </div>
        {dateMode === 'auto' ? (
          <p className="accounting-note">{periodLabel}</p>
        ) : (
          <div className="accounting-inline-fields">
            <label>
              開始日
              <input
                type="date"
                value={startDate ?? ''}
                disabled={disabled || isSaving}
                onChange={(event) => setStartDate(event.target.value || null)}
              />
            </label>
            <label>
              終了日
              <input
                type="date"
                value={endDate ?? ''}
                disabled={disabled || isSaving}
                onChange={(event) => setEndDate(event.target.value || null)}
              />
            </label>
          </div>
        )}
      </fieldset>

      <label>
        レポート本文
        <textarea
          rows={8}
          value={body}
          disabled={disabled || isSaving}
          placeholder="視察内容・比較結果・導入方針などを記入してください。"
          onChange={(event) => setBody(event.target.value)}
        />
      </label>

      <div className="accounting-expense-report-photos">
        <div className="accounting-form-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={disabled || isSaving}
            onClick={() => fileInputRef.current?.click()}
          >
            レポート写真を追加
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="accounting-hidden-input"
            onChange={(event) => {
              handleAddPhotos(event.target.files)
              event.currentTarget.value = ''
            }}
          />
        </div>
        <p className="accounting-note">領収書画像とは別に、現地写真などを添付できます（JPG / PNG / WebP、10MB未満）。</p>

        {images.length > 0 ? (
          <ul className="accounting-expense-report-photo-list">
            {images.map((image, index) => (
              <li key={image.id} className="accounting-expense-report-photo-item">
                {image.previewUrl ? (
                  <img src={image.previewUrl} alt={image.originalFileName} />
                ) : (
                  <p className="accounting-note">プレビューなし</p>
                )}
                <label>
                  説明文
                  <input
                    type="text"
                    value={image.caption}
                    disabled={disabled || isSaving}
                    placeholder="例：車いす固定装置の操作レバー"
                    onChange={(event) => {
                      const caption = event.target.value
                      setImages((current) =>
                        current.map((item) =>
                          item.id === image.id ? { ...item, caption } : item,
                        ),
                      )
                    }}
                  />
                </label>
                <div className="accounting-form-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={disabled || isSaving || index === 0}
                    onClick={() =>
                      setImages((current) => {
                        if (index === 0) return current
                        const next = [...current]
                        ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
                        return next.map((item, order) => ({ ...item, displayOrder: order }))
                      })
                    }
                  >
                    上へ
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={disabled || isSaving || index >= images.length - 1}
                    onClick={() =>
                      setImages((current) => {
                        if (index >= current.length - 1) return current
                        const next = [...current]
                        ;[next[index], next[index + 1]] = [next[index + 1]!, next[index]!]
                        return next.map((item, order) => ({ ...item, displayOrder: order }))
                      })
                    }
                  >
                    下へ
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={disabled || isSaving}
                    onClick={() => {
                      if (image.storagePath) {
                        setRemovedStoragePaths((current) => [...current, image.storagePath!])
                      }
                      if (image.previewUrl) {
                        URL.revokeObjectURL(image.previewUrl)
                      }
                      setImages((current) => current.filter((item) => item.id !== image.id))
                    }}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="accounting-form-actions">
        <button
          type="button"
          className="primary-action"
          disabled={disabled || isSaving || !targetId.trim()}
          onClick={() => void handleSave()}
        >
          {isSaving ? '保存中…' : existingReport ? 'レポートを更新' : 'レポートを保存'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={disabled || isSaving || isPrinting}
          onClick={handlePrint}
        >
          レポートを印刷／PDF保存
        </button>
        {existingReport ? (
          <button
            type="button"
            className="secondary-action"
            disabled={disabled || isSaving}
            onClick={() => void handleDelete()}
          >
            レポートを削除
          </button>
        ) : null}
      </div>

      {!targetId.trim() ? (
        <p className="accounting-note">経費保存後にレポートを保存できます。下書き内容はこの画面に保持されます。</p>
      ) : null}
      {errorMessage ? (
        <p className="case-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? <p className="save-note">{statusMessage}</p> : null}
      <div ref={printRootRef} className="accounting-hidden" aria-hidden="true" />
    </section>
  )
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
