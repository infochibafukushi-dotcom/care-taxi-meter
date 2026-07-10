import type { AccountingReceiptDocumentType } from '../types/accounting'

export const MAX_ACCOUNTING_RECEIPT_FILE_BYTES = 10 * 1024 * 1024

export const ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE =
  '対応していないファイル形式です。JPEG、PNG、WebP、PDFを選択してください。'

export const ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE =
  'ファイルサイズが10MB以上です。10MB未満の画像またはPDFを選択してください。'

export const ACCOUNTING_RECEIPT_FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export type { AccountingReceiptDocumentType }

export const isAccountingReceiptPdfMime = (mimeType?: string) =>
  (mimeType ?? '').trim().toLowerCase() === 'application/pdf'

export const isAccountingReceiptImageMime = (mimeType?: string) => {
  const normalized = (mimeType ?? '').trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return IMAGE_MIME_TYPES.has(normalized)
}

export const detectAccountingReceiptDocumentType = (
  file: Pick<File, 'type' | 'name'>,
): AccountingReceiptDocumentType | null => {
  const mime = (file.type || '').trim().toLowerCase()
  if (isAccountingReceiptPdfMime(mime) || file.name.toLowerCase().endsWith('.pdf')) {
    return 'pdf'
  }

  if (isAccountingReceiptImageMime(mime) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    return 'image'
  }

  return null
}

export const validateAccountingReceiptUploadFile = (file: File) => {
  if (file.size >= MAX_ACCOUNTING_RECEIPT_FILE_BYTES) {
    return { ok: false as const, message: ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE }
  }

  const documentType = detectAccountingReceiptDocumentType(file)
  if (!documentType) {
    return { ok: false as const, message: ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE }
  }

  return { ok: true as const, documentType }
}

const stripControlChars = (value: string) =>
  value
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

/**
 * Storage パス用にファイル名を安全化します。拡張子は維持します。
 */
export const sanitizeAccountingReceiptFileName = (
  fileName: string,
  options?: { fallbackBase?: string; forceExtension?: string },
) => {
  const raw = fileName.trim() || options?.fallbackBase || 'receipt'
  const lastDot = raw.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < raw.length - 1
  const baseRaw = hasExtension ? raw.slice(0, lastDot) : raw
  const extensionRaw = options?.forceExtension
    ? options.forceExtension.replace(/^\./, '')
    : hasExtension
      ? raw.slice(lastDot + 1)
      : ''

  let base = stripControlChars(baseRaw) || options?.fallbackBase || 'receipt'
  if (base.length > 80) {
    base = base.slice(0, 80)
  }

  const extension = stripControlChars(extensionRaw).toLowerCase()
  const safeName = extension ? `${base}.${extension}` : base

  return safeName || 'receipt'
}

export const buildAccountingReceiptStorageFileName = (
  fileName: string,
  options?: { forceExtension?: string; uniqueSuffix?: string },
) => {
  const sanitized = sanitizeAccountingReceiptFileName(fileName, {
    forceExtension: options?.forceExtension,
  })
  const suffix = options?.uniqueSuffix?.trim()
  if (!suffix) {
    return sanitized
  }

  const lastDot = sanitized.lastIndexOf('.')
  if (lastDot > 0) {
    return `${sanitized.slice(0, lastDot)}-${suffix}${sanitized.slice(lastDot)}`
  }

  return `${sanitized}-${suffix}`
}
