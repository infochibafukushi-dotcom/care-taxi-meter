import {
  ACCOUNTING_RECEIPT_SUPPORTED_FORMAT_LABEL,
  ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE,
  detectAccountingReceiptDocumentType,
  MAX_ACCOUNTING_RECEIPT_FILE_BYTES,
  validateAccountingReceiptUploadFile,
} from './accountingReceiptFile'

/** ドロップエリア案内（PC向け。スマホでは控えめに表示） */
export const ACCOUNTING_RECEIPT_DROP_ZONE_TITLE =
  '画像・PDFをここにドラッグ＆ドロップ\nまたはクリックしてファイルを選択'

export const ACCOUNTING_RECEIPT_DROP_ZONE_HINT = `対応形式：${ACCOUNTING_RECEIPT_SUPPORTED_FORMAT_LABEL}`

export const ACCOUNTING_RECEIPT_DROP_ZONE_ACTIVE_LABEL = 'ここにドロップしてアップロード'

export const ACCOUNTING_RECEIPT_DROP_ZONE_ARIA_LABEL = '領収書の画像またはPDFを選択'

export const ACCOUNTING_RECEIPT_MULTI_FILE_MESSAGE =
  '一度にアップロードできる証憑は1ファイルです。\n1ファイルずつ選択してください。'

export const ACCOUNTING_RECEIPT_UNSUPPORTED_DROP_MESSAGE = ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE

export const ACCOUNTING_RECEIPT_REPLACE_CONFIRM_MESSAGE =
  '現在の証憑を新しいファイルに差し替えますか？'

export const ACCOUNTING_RECEIPT_READ_FAILED_MESSAGE =
  'ファイルを読み込めませんでした。\n元の証憑は変更されていません。'

export const ACCOUNTING_RECEIPT_MAX_FILE_BYTES = MAX_ACCOUNTING_RECEIPT_FILE_BYTES

export type AccountingReceiptSelectionResult =
  | { ok: true; file: File; documentType: 'pdf' | 'image' }
  | { ok: false; message: string | null }

/**
 * ファイル選択（input change / ドロップ共通）の件数・形式・サイズ判定。
 * 既存の validateAccountingReceiptUploadFile を使用する。
 */
export const resolveSelectedAccountingReceiptFiles = (
  files: ArrayLike<File> | null | undefined,
): AccountingReceiptSelectionResult => {
  if (!files || files.length === 0) {
    return { ok: false, message: null }
  }

  if (files.length > 1) {
    return { ok: false, message: ACCOUNTING_RECEIPT_MULTI_FILE_MESSAGE }
  }

  const file = files[0]
  const validation = validateAccountingReceiptUploadFile(file)
  if (!validation.ok) {
    return { ok: false, message: validation.message }
  }

  return { ok: true, file, documentType: validation.documentType }
}

export const hasExistingAccountingReceiptAttachment = (form: {
  receiptId?: string
  receiptImageUrl?: string
  receiptPreviewImageUrl?: string
  receiptFileUrl?: string
  receiptStoragePath?: string
  receiptFileStoragePath?: string
  receiptPreviewStoragePath?: string
} | null | undefined): boolean => {
  if (!form) {
    return false
  }

  return Boolean(
    form.receiptId?.trim() ||
      form.receiptImageUrl?.trim() ||
      form.receiptPreviewImageUrl?.trim() ||
      form.receiptFileUrl?.trim() ||
      form.receiptStoragePath?.trim() ||
      form.receiptFileStoragePath?.trim() ||
      form.receiptPreviewStoragePath?.trim(),
  )
}

/** 差し替え確認が必要なら true（確認 UI は呼び出し側） */
export const shouldPromptReceiptReplacement = (hasExistingAttachment: boolean) =>
  hasExistingAttachment

export type AccountingReceiptAttachmentStatus =
  | 'none'
  | 'loading'
  | 'previewing'
  | 'unsaved'
  | 'saved'
  | 'error'

export const ACCOUNTING_RECEIPT_ATTACHMENT_STATUS_LABEL: Record<
  AccountingReceiptAttachmentStatus,
  string
> = {
  none: '',
  loading: '読込中',
  previewing: 'プレビュー生成中',
  unsaved: '未保存',
  saved: '保存済み',
  error: '読込失敗',
}

export const resolveAccountingReceiptAttachmentStatus = (options: {
  isProcessing: boolean
  hasError: boolean
  hasLocalSelection: boolean
  hasPersistedOnExpense: boolean
}): AccountingReceiptAttachmentStatus => {
  if (options.isProcessing) {
    return options.hasLocalSelection ? 'previewing' : 'loading'
  }
  if (options.hasError) {
    return 'error'
  }
  if (options.hasPersistedOnExpense && !options.hasLocalSelection) {
    return 'saved'
  }
  if (options.hasLocalSelection || options.hasPersistedOnExpense) {
    return 'unsaved'
  }
  return 'none'
}

export const formatAccountingReceiptFileSize = (sizeBytes: number): string => {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '—'
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes}B`
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))}KB`
  }
  const mb = sizeBytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)}MB`
}

export const formatAccountingReceiptFileTypeLabel = (
  file: Pick<File, 'name' | 'type'>,
): string => {
  const documentType = detectAccountingReceiptDocumentType(file)
  if (documentType === 'pdf') {
    return 'PDF'
  }

  const name = file.name.toLowerCase()
  if (name.endsWith('.png') || file.type === 'image/png') {
    return 'PNG'
  }
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || file.type === 'image/jpeg') {
    return 'JPG'
  }
  if (name.endsWith('.webp') || file.type === 'image/webp') {
    return 'WebP'
  }
  if (name.endsWith('.heic') || name.endsWith('.heif') || file.type.includes('heic') || file.type.includes('heif')) {
    return 'HEIC'
  }
  return documentType === 'image' ? '画像' : 'ファイル'
}

export const formatAccountingReceiptSelectionSummary = (file: File): string => {
  const typeLabel = formatAccountingReceiptFileTypeLabel(file)
  const sizeLabel = formatAccountingReceiptFileSize(file.size)
  return `${typeLabel}・${sizeLabel}`
}

/**
 * 子要素をまたいでもちらつかないよう、enter/leave の入れ子深度を数える。
 */
export const advanceDropZoneDragDepth = (currentDepth: number, delta: 1 | -1): number => {
  const next = currentDepth + delta
  return next < 0 ? 0 : next
}

export const isDropZoneDragActive = (depth: number) => depth > 0

const INTERACTIVE_SELECTOR =
  'button, a, input, label, select, textarea, [role="button"], [data-receipt-drop-ignore]'

type ClosestCapable = {
  closest: (selectors: string) => unknown
}

/** ドロップエリア空白クリック時のみファイル選択を開く（内部ボタン等は除外） */
export const shouldOpenFilePickerFromDropZoneTarget = (
  target: ClosestCapable | EventTarget | null,
  _currentTarget?: ClosestCapable | EventTarget | null,
): boolean => {
  if (!target || typeof (target as ClosestCapable).closest !== 'function') {
    return false
  }

  return (target as ClosestCapable).closest(INTERACTIVE_SELECTOR) == null
}

export const shouldOpenFilePickerFromKeyboard = (key: string): boolean =>
  key === 'Enter' || key === ' '

/** ブラウザのページ遷移を防ぐ（dragover / drop で必須） */
export const preventBrowserFileNavigation = (event: {
  preventDefault: () => void
  stopPropagation?: () => void
}) => {
  event.preventDefault()
  event.stopPropagation?.()
}

/** セッション中にアップロードした未整理証憑のうち、破棄してよい ID を返す */
export const resolvePendingUnorganizedReceiptIdsToDiscard = (options: {
  pendingReceiptIds: string[]
  /** 経費に既に紐付いている等、削除してはいけない ID */
  protectedReceiptIds?: Array<string | null | undefined>
}): string[] => {
  const protectedIds = new Set(
    (options.protectedReceiptIds ?? [])
      .map((id) => (id ?? '').trim())
      .filter(Boolean),
  )

  const seen = new Set<string>()
  const result: string[] = []
  for (const rawId of options.pendingReceiptIds) {
    const id = rawId.trim()
    if (!id || protectedIds.has(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    result.push(id)
  }
  return result
}

/**
 * 差し替え後に削除候補となる直前の receiptId。
 * 同じ ID・保護対象は削除しない（linked 済みの既存証憑を誤削除しない）。
 */
export const resolveReplacedUnorganizedReceiptIdToDiscard = (options: {
  previousReceiptId?: string | null
  nextReceiptId?: string | null
  protectedReceiptIds?: Array<string | null | undefined>
}): string | null => {
  const previous = (options.previousReceiptId ?? '').trim()
  const next = (options.nextReceiptId ?? '').trim()
  if (!previous || !next || previous === next) {
    return null
  }
  const protectedIds = new Set(
    (options.protectedReceiptIds ?? [])
      .map((id) => (id ?? '').trim())
      .filter(Boolean),
  )
  if (protectedIds.has(previous)) {
    return null
  }
  return previous
}
