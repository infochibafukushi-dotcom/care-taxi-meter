import { useMemo, useRef, useState } from 'react'
import {
  EXPENSE_CATEGORIES,
  INVOICE_STATUS_LABELS,
  type AccountingExpenseInput,
  type ExpenseCategory,
  type InvoiceCheckStatus,
  type InvoiceStatus,
  type StoredAccountingExpense,
} from '../../types/accounting'
import type { ExpenseGroupType, StoredAccountingExpenseGroup } from '../../types/accountingExpenseGroup'
import type { StoredAccountingExpenseReport } from '../../types/accountingExpenseReport'
import { EXPENSE_GROUP_TYPE_LABELS } from '../../types/accountingExpenseGroup'
import { ExpenseGroupTypeSelect } from './ExpenseEntryModeSwitch'
import { ExpenseReportEditor } from './ExpenseReportEditor'
import {
  buildEmptyExpenseInput,
} from '../../services/accountingExpenses'
import {
  saveAccountingExpenseGroup,
  updateAccountingExpenseGroupReportId,
} from '../../services/accountingExpenseGroups'
import {
  uploadAccountingReceiptFile,
  applyOcrCandidatesToAccountingReceipt,
  resolveAccountingReceiptDownloadUrl,
} from '../../services/accountingReceipts'
import { runAccountingReceiptOcr } from '../../services/accountingReceiptOcr'
import { checkInvoiceRegistry } from '../../services/invoiceRegistryCheck'
import { normalizeAccountingReceiptImage } from '../../utils/accountingReceiptImage'
import { createAccountingPdfPreview } from '../../utils/accountingReceiptPdf'
import {
  ACCOUNTING_RECEIPT_FILE_ACCEPT,
  validateAccountingReceiptUploadFile,
} from '../../utils/accountingReceiptFile'
import {
  applyAccountingReceiptOcrToExpense,
  formatYenInputDisplay,
  parseYenInput,
} from '../../utils/accountingExpenseForm'
import {
  formatExpenseGroupDateJa,
  formatExpenseGroupPeriodLabel,
  sumExpenseGroupLineAmounts,
  validateExpenseGroupForSave,
} from '../../utils/accountingExpenseGroup'
import { normalizeInvoiceRegistrationNumberForUi } from '../../utils/invoiceRegistryNormalize'
import { formatFareYen } from '../../services/fare'
import { deriveTaxFields } from '../../utils/accountingTax'

export type GroupedExpenseLineDraft = AccountingExpenseInput & {
  localId: string
  existingExpenseId?: string
  ocrStatus: 'idle' | 'running' | 'success' | 'error' | 'skipped'
  ocrMessage?: string
  invoiceLookupLabel: string
  previewUrl?: string
  isEditing: boolean
}

type Props = {
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  existingGroup?: StoredAccountingExpenseGroup | null
  existingExpenses?: StoredAccountingExpense[]
  existingReport?: StoredAccountingExpenseReport | null
  disabled?: boolean
  onSaved: (groupId: string) => void
  onCancel: () => void
}

const createLocalId = () =>
  `line_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const mapInvoiceLabel = ({
  invoiceNumber,
  invoiceCheckStatus,
  invoiceStatus,
  lookupFailed,
}: {
  invoiceNumber?: string
  invoiceCheckStatus?: InvoiceCheckStatus
  invoiceStatus?: InvoiceStatus
  lookupFailed?: boolean
}): string => {
  if (lookupFailed) {
    return 'APIエラー'
  }
  if (!invoiceNumber?.trim()) {
    return '登録番号なし'
  }
  if (invoiceCheckStatus === '確認済' || invoiceCheckStatus === '登録あり' || invoiceStatus === 'verified') {
    return '登録確認済み'
  }
  if (invoiceCheckStatus === '登録なし' || invoiceStatus === 'none') {
    return '未登録'
  }
  if (invoiceCheckStatus === '対象外' || invoiceStatus === 'not_required') {
    return '登録番号なし'
  }
  return '確認できず'
}

const expenseToLineDraft = (expense: StoredAccountingExpense): GroupedExpenseLineDraft => ({
  ...expense,
  localId: expense.id,
  existingExpenseId: expense.id,
  ocrStatus: 'success',
  invoiceLookupLabel: mapInvoiceLabel({
    invoiceNumber: expense.invoiceNumber,
    invoiceCheckStatus: expense.invoiceCheckStatus,
    invoiceStatus: expense.invoiceStatus,
  }),
  isEditing: false,
})

export function GroupedExpenseForm({
  franchiseeId,
  storeId,
  staffId,
  staffName,
  existingGroup,
  existingExpenses = [],
  existingReport,
  disabled,
  onSaved,
  onCancel,
}: Props) {
  const [groupType, setGroupType] = useState<ExpenseGroupType>(
    existingGroup?.groupType ?? 'training',
  )
  const [title, setTitle] = useState(existingGroup?.title ?? '')
  const [lines, setLines] = useState<GroupedExpenseLineDraft[]>(
    () => existingExpenses.map(expenseToLineDraft),
  )
  const [removedExpenseIds, setRemovedExpenseIds] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [savedGroupId, setSavedGroupId] = useState(existingGroup?.id ?? '')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)

  const totalAmount = useMemo(
    () => sumExpenseGroupLineAmounts(lines.map((line) => line.taxIncludedAmount)),
    [lines],
  )

  const period = useMemo(() => {
    const dates = lines
      .map((line) => line.receiptDate || line.postingDate || '')
      .filter(Boolean)
      .sort()
    return {
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
    }
  }, [lines])

  const updateLine = (localId: string, patch: Partial<GroupedExpenseLineDraft>) => {
    setLines((current) =>
      current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    )
  }

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || disabled) {
      return
    }

    setIsUploading(true)
    setErrorMessage('')
    const uploadErrors: string[] = []

    for (const file of Array.from(fileList)) {
      const validation = validateAccountingReceiptUploadFile(file)
      if (!validation.ok) {
        uploadErrors.push(`${file.name}: ${validation.message}`)
        continue
      }

      const localId = createLocalId()
      const base = buildEmptyExpenseInput({
        franchiseeId,
        storeId,
        staffId,
        staffName,
      })
      const draft: GroupedExpenseLineDraft = {
        ...base,
        localId,
        confirmationStatus: '確認済み',
        ocrStatus: 'idle',
        invoiceLookupLabel: '登録番号なし',
        isEditing: true,
        description: '',
      }
      setLines((current) => [...current, draft])

      try {
        let originalFile = file
        let ocrImageFile: File
        let pdfPageCount: number | undefined
        if (validation.documentType === 'pdf') {
          const preview = await createAccountingPdfPreview(file)
          ocrImageFile = preview.previewFile
          pdfPageCount = preview.pageCount
        } else {
          ocrImageFile = await normalizeAccountingReceiptImage(file)
          originalFile = ocrImageFile
        }

        const uploaded = await uploadAccountingReceiptFile({
          originalFile,
          ocrImageFile,
          documentType: validation.documentType,
          pdfPageCount,
          franchiseeId,
          storeId,
          uploadedBy: staffId,
          uploadedByName: staffName,
        })

        const previewUrl = URL.createObjectURL(ocrImageFile)
        updateLine(localId, {
          receiptId: uploaded.receiptId,
          receiptFileStoragePath: uploaded.originalStoragePath,
          receiptPreviewStoragePath: uploaded.ocrImageStoragePath,
          receiptStoragePath: uploaded.ocrImageStoragePath,
          receiptFileName: file.name,
          receiptFileMimeType: file.type,
          imageHash: uploaded.imageHash,
          previewUrl,
          ocrStatus: 'running',
          ocrMessage: 'OCR読取中…',
        })

        try {
          const downloadUrl = await resolveAccountingReceiptDownloadUrl({
            downloadUrl: '',
            storagePath: uploaded.ocrImageStoragePath,
            receiptId: uploaded.receiptId,
            variant: 'preview',
          })

          const ocrResult = await runAccountingReceiptOcr({
            ocrImageDownloadUrl: downloadUrl,
            ocrImageStoragePath: uploaded.ocrImageStoragePath,
            downloadUrl,
            storagePath: uploaded.ocrImageStoragePath,
            mimeType: ocrImageFile.type || 'image/jpeg',
            receiptId: uploaded.receiptId,
            imageBlob: ocrImageFile,
            isPreparedOcrImage: true,
          })

          if (ocrResult.status === 'error' || ocrResult.status === 'not_configured') {
            updateLine(localId, {
              ocrStatus: ocrResult.status === 'not_configured' ? 'skipped' : 'error',
              ocrMessage:
                ocrResult.message ||
                (ocrResult.status === 'not_configured'
                  ? 'OCR未設定のため手入力してください。'
                  : 'OCRに失敗しました。手入力で登録できます。'),
            })
          } else {
            const withOcr = applyAccountingReceiptOcrToExpense(
              {
                ...base,
                receiptId: uploaded.receiptId,
                receiptFileStoragePath: uploaded.originalStoragePath,
                receiptPreviewStoragePath: uploaded.ocrImageStoragePath,
                receiptStoragePath: uploaded.ocrImageStoragePath,
                receiptFileName: file.name,
                receiptFileMimeType: file.type,
                imageHash: uploaded.imageHash,
                confirmationStatus: '確認済み',
              },
              ocrResult,
            )
            await applyOcrCandidatesToAccountingReceipt({
              receiptId: uploaded.receiptId,
              ocr: ocrResult,
            })
            updateLine(localId, {
              ...withOcr,
              localId,
              previewUrl,
              ocrStatus: 'success',
              ocrMessage: 'OCR候補を反映しました。内容を確認・修正してください。',
              invoiceLookupLabel: mapInvoiceLabel({
                invoiceNumber: withOcr.invoiceNumber,
                invoiceCheckStatus: withOcr.invoiceCheckStatus,
                invoiceStatus: withOcr.invoiceStatus,
              }),
              isEditing: true,
            })
          }
        } catch (ocrError) {
          updateLine(localId, {
            ocrStatus: 'error',
            ocrMessage:
              ocrError instanceof Error
                ? ocrError.message
                : 'OCRに失敗しました。手入力で登録できます。',
          })
        }
      } catch (error) {
        uploadErrors.push(
          `${file.name}: ${error instanceof Error ? error.message : 'アップロードに失敗しました。'}`,
        )
        setLines((current) => current.filter((line) => line.localId !== localId))
      }
    }

    if (uploadErrors.length > 0) {
      setErrorMessage(uploadErrors.join('\n'))
    }
    setIsUploading(false)
  }

  const handleRecheckInvoice = async (line: GroupedExpenseLineDraft) => {
    const normalized = normalizeInvoiceRegistrationNumberForUi(line.invoiceNumber)
    if (!normalized) {
      updateLine(line.localId, {
        invoiceNumber: '',
        invoiceLookupLabel: '登録番号なし',
        invoiceCheckStatus: '対象外',
        invoiceStatus: 'none',
      })
      return
    }

    try {
      const response = await checkInvoiceRegistry({
        registrationNumber: normalized,
        basisDate: line.receiptDate || undefined,
      })
      if (!response.ok) {
        updateLine(line.localId, {
          invoiceNumber: normalized,
          invoiceLookupLabel: 'APIエラー',
        })
        return
      }

      const data = response.data
      const registered = data.status === 'active' && data.isQualifiedAtBasisDate
      updateLine(line.localId, {
        invoiceNumber: normalized,
        invoiceRegisteredName: data.name || line.invoiceRegisteredName,
        invoiceCheckStatus: data.status === 'not_found' ? '登録なし' : registered ? '登録あり' : '未確認',
        invoiceStatus: registered ? 'verified' : data.status === 'not_found' ? 'none' : 'unknown',
        invoiceCheckedAt: data.checkedAt || new Date().toISOString(),
        invoiceLookupLabel: registered
          ? '登録確認済み'
          : data.status === 'not_found'
            ? '未登録'
            : '確認できず',
      })
    } catch {
      updateLine(line.localId, {
        invoiceNumber: normalized,
        invoiceLookupLabel: 'APIエラー',
      })
    }
  }

  const handleSave = async () => {
    if (savingRef.current || isSaving || disabled) {
      return
    }

    const errors = validateExpenseGroupForSave({
      title,
      lines: lines.map((line) => ({
        taxIncludedAmount: line.taxIncludedAmount,
        receiptDate: line.receiptDate || '',
        expenseCategory: String(line.expenseCategory ?? ''),
      })),
      clientTotalAmount: totalAmount,
    })
    if (errors.length > 0) {
      setErrorMessage(errors.map((error) => error.message).join('\n'))
      return
    }

    savingRef.current = true
    setIsSaving(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const result = await saveAccountingExpenseGroup({
        mode: existingGroup ? 'update' : 'create',
        groupId: existingGroup?.id,
        group: {
          franchiseeId,
          companyId: franchiseeId,
          storeId,
          groupType,
          title,
          reportId: existingGroup?.reportId ?? null,
          confirmationStatus: '確認済み',
          memo: '',
          createdBy: existingGroup?.createdBy || staffId,
          createdByName: existingGroup?.createdByName || staffName,
          updatedBy: staffId,
          updatedByName: staffName,
        },
        lines: lines.map((line) => ({
          ...line,
          existingExpenseId: line.existingExpenseId,
          expenseGroupId: existingGroup?.id ?? null,
          confirmationStatus: '確認済み',
          updatedBy: staffId,
          updatedByName: staffName,
        })),
        removedExpenseIds,
        clientTotalAmount: totalAmount,
      })

      setSavedGroupId(result.groupId)
      setStatusMessage('まとめ経費を保存しました。続けてレポートを追加できます。')
      onSaved(result.groupId)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'まとめ経費の保存に失敗しました。')
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  return (
    <section className="accounting-grouped-expense-form" aria-label="まとめ経費">
      <header className="accounting-grouped-expense-header">
        <h2>まとめ経費</h2>
        <p className="accounting-note">複数の領収書を1件の目的別経費として登録</p>
      </header>

      <div className="accounting-form-grid">
        <ExpenseGroupTypeSelect value={groupType} onChange={setGroupType} disabled={disabled || isSaving} />
        <label>
          件名
          <input
            type="text"
            value={title}
            disabled={disabled || isSaving}
            required
            placeholder="例：福祉機器展示会・介護車両視察"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div>
          <p className="accounting-field-label">実施期間</p>
          <p className="accounting-note">
            {formatExpenseGroupPeriodLabel(period.startDate, period.endDate)}
          </p>
        </div>
      </div>

      <div className="accounting-form-actions">
        <button
          type="button"
          className="primary-action"
          disabled={disabled || isSaving || isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? 'アップロード中…' : '領収書を追加'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCOUNTING_RECEIPT_FILE_ACCEPT}
          multiple
          className="accounting-hidden-input"
          onChange={(event) => {
            void handleUploadFiles(event.target.files)
            event.currentTarget.value = ''
          }}
        />
      </div>

      {lines.length > 0 ? (
        <ul className="accounting-grouped-receipt-list">
          {lines.map((line, index) => (
            <li key={line.localId} className="accounting-grouped-receipt-card">
              <header>
                <strong>領収書{index + 1}</strong>
                <span className="accounting-note">
                  OCR:{' '}
                  {line.ocrStatus === 'running'
                    ? '読取中…'
                    : line.ocrStatus === 'success'
                      ? '成功（要確認）'
                      : line.ocrStatus === 'error'
                        ? '失敗（手入力可）'
                        : line.ocrStatus === 'skipped'
                          ? 'スキップ'
                          : '未実行'}
                </span>
              </header>

              {line.previewUrl ? (
                <img
                  className="accounting-grouped-receipt-preview"
                  src={line.previewUrl}
                  alt={`領収書${index + 1}`}
                />
              ) : null}

              {line.isEditing ? (
                <div className="accounting-form-grid">
                  <label>
                    支払先
                    <input
                      type="text"
                      value={line.vendorName}
                      disabled={disabled || isSaving}
                      onChange={(event) =>
                        updateLine(line.localId, { vendorName: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    取引日
                    <input
                      type="date"
                      value={line.receiptDate || ''}
                      disabled={disabled || isSaving}
                      onChange={(event) => {
                        const receiptDate = event.target.value
                        updateLine(line.localId, {
                          receiptDate,
                          postingDate: receiptDate,
                          transactionDate: receiptDate,
                        })
                      }}
                    />
                  </label>
                  <label>
                    確定金額（税込）
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatYenInputDisplay(line.taxIncludedAmount, true)}
                      disabled={disabled || isSaving}
                      onChange={(event) => {
                        const taxIncludedAmount = parseYenInput(event.target.value)
                        const taxFields = deriveTaxFields({
                          taxIncludedAmount,
                          taxRate: line.taxRate,
                          taxAmount: line.taxAmount ?? line.consumptionTaxAmount,
                          taxCalculationMode: line.taxCalculationMode === 'ocr' ? 'manual' : line.taxCalculationMode,
                        })
                        updateLine(line.localId, {
                          taxIncludedAmount,
                          taxAmount: taxFields.taxAmount,
                          consumptionTaxAmount: taxFields.consumptionTaxAmount,
                          taxExcludedAmount: taxFields.taxExcludedAmount,
                          taxCalculationMode: taxFields.taxCalculationMode,
                        })
                      }}
                    />
                  </label>
                  <label>
                    勘定科目
                    <select
                      value={line.expenseCategory}
                      disabled={disabled || isSaving}
                      onChange={(event) =>
                        updateLine(line.localId, {
                          expenseCategory: event.target.value as ExpenseCategory | '',
                        })
                      }
                    >
                      <option value="">選択してください</option>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    登録番号
                    <input
                      type="text"
                      value={line.invoiceNumber || ''}
                      disabled={disabled || isSaving}
                      placeholder="T1234567890123"
                      onChange={(event) =>
                        updateLine(line.localId, {
                          invoiceNumber: event.target.value,
                          invoiceLookupLabel: '確認できず',
                        })
                      }
                    />
                  </label>
                  <label>
                    摘要
                    <input
                      type="text"
                      value={line.description}
                      disabled={disabled || isSaving}
                      onChange={(event) =>
                        updateLine(line.localId, { description: event.target.value })
                      }
                    />
                  </label>
                  <p className="accounting-note">
                    インボイス: {line.invoiceLookupLabel}
                    {line.invoiceStatus
                      ? `（${INVOICE_STATUS_LABELS[line.invoiceStatus]}）`
                      : ''}
                  </p>
                </div>
              ) : (
                <dl className="accounting-grouped-receipt-summary">
                  <div>
                    <dt>支払先</dt>
                    <dd>{line.vendorName || '―'}</dd>
                  </div>
                  <div>
                    <dt>取引日</dt>
                    <dd>{formatExpenseGroupDateJa(line.receiptDate)}</dd>
                  </div>
                  <div>
                    <dt>金額</dt>
                    <dd>{formatFareYen(line.taxIncludedAmount)}</dd>
                  </div>
                  <div>
                    <dt>勘定科目</dt>
                    <dd>{line.expenseCategory || '未選択'}</dd>
                  </div>
                  <div>
                    <dt>登録番号</dt>
                    <dd>{line.invoiceNumber || '―'}</dd>
                  </div>
                  <div>
                    <dt>インボイス</dt>
                    <dd>{line.invoiceLookupLabel}</dd>
                  </div>
                </dl>
              )}

              {line.ocrMessage ? <p className="accounting-note">{line.ocrMessage}</p> : null}

              <div className="accounting-form-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled || isSaving}
                  onClick={() => updateLine(line.localId, { isEditing: !line.isEditing })}
                >
                  {line.isEditing ? '表示に戻す' : '編集'}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled || isSaving}
                  onClick={() => void handleRecheckInvoice(line)}
                >
                  インボイス再確認
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled || isSaving}
                  onClick={() => {
                    const confirmed = window.confirm(`領収書${index + 1}を削除しますか？`)
                    if (!confirmed) {
                      return
                    }
                    if (line.existingExpenseId) {
                      setRemovedExpenseIds((current) => [...current, line.existingExpenseId!])
                    }
                    if (line.previewUrl) {
                      URL.revokeObjectURL(line.previewUrl)
                    }
                    setLines((current) => current.filter((item) => item.localId !== line.localId))
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="accounting-note">領収書を追加してください。</p>
      )}

      <section className="accounting-grouped-expense-total" aria-label="領収書合計">
        <h3>領収書合計</h3>
        <ul className="accounting-pl-list">
          {lines.map((line, index) => (
            <li key={line.localId}>
              <span>{line.vendorName || `領収書${index + 1}`}</span>
              <strong>{formatFareYen(line.taxIncludedAmount)}</strong>
            </li>
          ))}
          <li>
            <span>合計金額</span>
            <strong>{formatFareYen(totalAmount)}</strong>
          </li>
        </ul>
        <p className="accounting-note">合計金額は手入力できません。明細金額から自動計算します。</p>
      </section>

      <div className="accounting-form-actions">
        <button
          type="button"
          className="primary-action"
          disabled={disabled || isSaving || isUploading}
          onClick={() => void handleSave()}
        >
          {isSaving ? '保存中…' : existingGroup ? 'まとめ経費を更新' : 'まとめ経費を保存'}
        </button>
        <button type="button" className="secondary-action" disabled={isSaving} onClick={onCancel}>
          キャンセル
        </button>
      </div>

      <ExpenseReportEditor
        franchiseeId={franchiseeId}
        storeId={storeId}
        staffId={staffId}
        staffName={staffName}
        targetType="expense_group"
        targetId={savedGroupId}
        existingReport={existingReport}
        autoStartDate={period.startDate}
        autoEndDate={period.endDate}
        relatedCategoryLabel={`まとめ経費：${EXPENSE_GROUP_TYPE_LABELS[groupType]}`}
        relatedAmountYen={totalAmount}
        disabled={disabled || isSaving}
        onSaved={(reportId) => {
          if (!savedGroupId) {
            return
          }
          void updateAccountingExpenseGroupReportId({
            groupId: savedGroupId,
            reportId,
            updatedBy: staffId,
            updatedByName: staffName,
          })
        }}
      />

      {errorMessage ? (
        <p className="case-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? <p className="save-note">{statusMessage}</p> : null}
    </section>
  )
}
