/** 法定スキャナ保存ステータス（既存 receiptStatus / status とは別軸） */
export const ACCOUNTING_RECEIPT_LEGAL_STATUSES = [
  'draft',
  'image_review',
  'legal_pending_timestamp',
  'legal_saved_accounting_pending',
  'accounting_confirmed',
  'late_saved',
  'deleted',
] as const

export type AccountingReceiptLegalStatus = (typeof ACCOUNTING_RECEIPT_LEGAL_STATUSES)[number]

export const ACCOUNTING_RECEIPT_CAPTURE_MODES = ['legacy', 'scanner_v1'] as const
export type AccountingReceiptCaptureMode = (typeof ACCOUNTING_RECEIPT_CAPTURE_MODES)[number]

export const ACCOUNTING_RECEIPT_TIMESTAMP_STATUSES = [
  'none',
  'pending',
  'issued',
  'failed',
] as const
export type AccountingReceiptTimestampStatus =
  (typeof ACCOUNTING_RECEIPT_TIMESTAMP_STATUSES)[number]

export const RECEIPT_PAPER_SIZE_TYPES = [
  'a4',
  'a5',
  'b5',
  'receipt_58',
  'receipt_80',
  'custom',
  'unknown',
] as const
export type ReceiptPaperSizeType = (typeof RECEIPT_PAPER_SIZE_TYPES)[number]

export type ReceiptPoint = {
  x: number
  y: number
}

export type ReceiptCorners = {
  topLeft: ReceiptPoint
  topRight: ReceiptPoint
  bottomRight: ReceiptPoint
  bottomLeft: ReceiptPoint
}

export type ReceiptCornerDetectConfidence = 'high' | 'low' | 'failed'

export type ReceiptCornerDetectResult = {
  corners: ReceiptCorners
  confidence: ReceiptCornerDetectConfidence
  message?: string
}

export type ReceiptPaperSizeSelection = {
  paperSizeType: ReceiptPaperSizeType
  paperWidthMm: number
  paperHeightMm: number
  /** 自動候補かユーザー確認済みか */
  source: 'auto' | 'user'
}

export type ReceiptLegalQualityResult = {
  ok: boolean
  estimatedDpi: number
  dpiX: number
  dpiY: number
  widthPx: number
  heightPx: number
  isColor: boolean
  paper: ReceiptPaperSizeSelection
  reasons: string[]
}

export type ReceiptLegalMasterResult = {
  masterBlob: Blob
  widthPx: number
  heightPx: number
  quality: number
  fileSizeBytes: number
  estimatedDpi: number
}

export type AccountingReceiptLegalFields = {
  captureMode?: AccountingReceiptCaptureMode
  legalStatus?: AccountingReceiptLegalStatus
  transactionDate?: string
  receivedDate?: string
  capturedAt?: string
  legalSavedAt?: string
  legalMasterStoragePath?: string
  thumbnailStoragePath?: string
  legalMasterMimeType?: string
  legalWidthPx?: number
  legalHeightPx?: number
  paperSizeType?: ReceiptPaperSizeType
  paperWidthMm?: number
  paperHeightMm?: number
  estimatedDpi?: number
  /** 法定マスター JPEG の SHA-256（タイムスタンプ対象予定） */
  fileHash?: string
  version?: number
  previousVersionId?: string
  timestampStatus?: AccountingReceiptTimestampStatus
  timestampProvider?: string
  timestampTokenId?: string
  timestampedAt?: string
}

export const LEGAL_PENDING_TIMESTAMP_USER_LABELS = {
  title: 'スキャナ画像確定済み',
  subtitle: 'タイムスタンプ未付与',
  notice: '紙原本を保管してください',
} as const

export const normalizeAccountingReceiptLegalStatus = (
  value: unknown,
): AccountingReceiptLegalStatus | undefined => {
  if (
    typeof value === 'string' &&
    (ACCOUNTING_RECEIPT_LEGAL_STATUSES as readonly string[]).includes(value)
  ) {
    return value as AccountingReceiptLegalStatus
  }
  return undefined
}

export const normalizeAccountingReceiptCaptureMode = (
  value: unknown,
): AccountingReceiptCaptureMode | undefined => {
  if (value === 'legacy' || value === 'scanner_v1') {
    return value
  }
  return undefined
}

export const normalizeAccountingReceiptTimestampStatus = (
  value: unknown,
): AccountingReceiptTimestampStatus => {
  if (
    typeof value === 'string' &&
    (ACCOUNTING_RECEIPT_TIMESTAMP_STATUSES as readonly string[]).includes(value)
  ) {
    return value as AccountingReceiptTimestampStatus
  }
  return 'none'
}

export const isScannerCaptureMode = (
  captureMode: AccountingReceiptCaptureMode | undefined | null,
) => captureMode === 'scanner_v1'

/** タイムスタンプ未付与のため「正式保存済み」扱いにしない */
export const isLegalPendingTimestamp = (
  legalStatus: AccountingReceiptLegalStatus | undefined | null,
) => legalStatus === 'legal_pending_timestamp'
