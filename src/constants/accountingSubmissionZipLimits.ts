/**
 * Browser-side ZIP generation provisional ceilings (Phase 2B).
 * Not final production limits — Phase 2C will handle oversized packs via Functions.
 */
export type SubmissionZipClientLimits = {
  maxFiles: number
  maxTotalEstimatedBytes: number
  maxSingleFileBytes: number
}

/** Provisional client limits — do not treat as confirmed capacity. */
export const SUBMISSION_ZIP_CLIENT_LIMITS: SubmissionZipClientLimits = {
  maxFiles: 250,
  maxTotalEstimatedBytes: 80 * 1024 * 1024,
  maxSingleFileBytes: 12 * 1024 * 1024,
}

export const SUBMISSION_ZIP_LIMIT_EXCEEDED_MESSAGE =
  'この資料量はブラウザ生成の暫定上限を超えています。大容量生成機能はPhase 2Cで対応予定です。'

/**
 * Per-voucher Storage getBytes wait ceiling (Phase 2B).
 * getBytes cannot be aborted mid-transfer; this only ends the Promise.race wait.
 * Calibrate later from production file sizes if 60s is too long/short.
 */
export const SUBMISSION_VOUCHER_FETCH_TIMEOUT_MS = 60_000

export const ALLOWED_SUBMISSION_VOUCHER_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])
