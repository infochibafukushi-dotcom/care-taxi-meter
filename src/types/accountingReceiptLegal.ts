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
  'verification_failed',
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

export const SCANNER_INPUT_MODES = ['rapid', 'business_cycle'] as const
export type ScannerInputMode = (typeof SCANNER_INPUT_MODES)[number]

export const SCANNER_DELETE_REASONS = [
  'wrong_receipt',
  'duplicate',
  'capture_failed',
  'wrong_expense',
  'other',
] as const
export type ScannerDeleteReason = (typeof SCANNER_DELETE_REASONS)[number]

export const SCANNER_DELETE_REASON_LABELS: Record<ScannerDeleteReason, string> = {
  wrong_receipt: '別の領収書を登録した',
  duplicate: '重複登録',
  capture_failed: '撮影失敗',
  wrong_expense: '別経費に登録した',
  other: 'その他',
}

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
  receivedDate?: string | null
  /** 受領日不明時の発見日 */
  foundDate?: string
  capturedAt?: string
  legalSavedAt?: string
  legalMasterStoragePath?: string
  thumbnailStoragePath?: string
  timestampTokenStoragePath?: string
  legalMasterMimeType?: string
  legalWidthPx?: number
  legalHeightPx?: number
  paperSizeType?: ReceiptPaperSizeType
  paperWidthMm?: number
  paperHeightMm?: number
  estimatedDpi?: number
  /** 法定マスター JPEG の SHA-256（タイムスタンプ対象） */
  fileHash?: string
  version?: number
  activeVersion?: number
  previousVersionId?: string
  changeReason?: string
  changedAt?: string
  changedBy?: string
  timestampStatus?: AccountingReceiptTimestampStatus
  timestampProvider?: string
  timestampTokenId?: string
  timestampedAt?: string
  timestampVerifiedAt?: string
  timestampAlgorithm?: string
  scannerInputMode?: ScannerInputMode
  requiresPaperOriginal?: boolean
  paperOriginalReason?: string
  retentionUntil?: string
  deadlineDueDate?: string
  isDeleted?: boolean
  /** Firestore 検索用正規化支払先 */
  searchVendorName?: string
  /** Firestore 検索用金額（円） */
  searchAmountYen?: number | null
}

export type AccountingReceiptVersionRecord = {
  version: number
  previousVersion?: number | null
  legalMasterStoragePath: string
  thumbnailStoragePath?: string
  timestampTokenStoragePath?: string
  fileHash: string
  legalWidthPx?: number
  legalHeightPx?: number
  estimatedDpi?: number
  timestampStatus: AccountingReceiptTimestampStatus
  timestampProvider?: string
  timestampTokenId?: string
  timestampedAt?: string
  timestampVerifiedAt?: string
  timestampAlgorithm?: string
  changeReason?: string
  createdAt?: string
  createdBy?: string
  isActive?: boolean
}

export const LEGAL_PENDING_TIMESTAMP_USER_LABELS = {
  title: 'スキャナ画像確定済み',
  subtitle: 'タイムスタンプ未付与',
  notice: '正式スキャナ保存はまだ完了していません。紙原本を保管してください',
} as const

export const LEGAL_TIMESTAMP_UNCONFIGURED_LABELS = {
  title: 'タイムスタンプサービス未設定',
  subtitle: '正式スキャナ保存はまだ完了していません',
  notice: '紙原本を保管してください',
} as const

export const LEGAL_SAVED_LABELS = {
  title: 'スキャナ保存要件上の保存処理完了',
  subtitle: '経理確認待ち',
  notice: '運用規程に従い紙原本の取扱いを確認してください',
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

export const isTimestampIssued = (
  timestampStatus: AccountingReceiptTimestampStatus | undefined | null,
) => timestampStatus === 'issued'

/** 紙原本保管が必要か（正式保存未完了・期限超過・受領日不明など） */
export const requiresPaperOriginalRetention = (fields: {
  captureMode?: AccountingReceiptCaptureMode
  legalStatus?: AccountingReceiptLegalStatus
  timestampStatus?: AccountingReceiptTimestampStatus
  requiresPaperOriginal?: boolean
  receivedDate?: string | null
  foundDate?: string
}): boolean => {
  if (fields.requiresPaperOriginal) {
    return true
  }
  if (fields.captureMode !== 'scanner_v1') {
    return true
  }
  if (fields.legalStatus === 'late_saved' || fields.legalStatus === 'deleted') {
    return true
  }
  if (!fields.receivedDate) {
    return true
  }
  if (fields.timestampStatus !== 'issued') {
    return true
  }
  if (
    fields.legalStatus !== 'legal_saved_accounting_pending' &&
    fields.legalStatus !== 'accounting_confirmed'
  ) {
    return true
  }
  return false
}
