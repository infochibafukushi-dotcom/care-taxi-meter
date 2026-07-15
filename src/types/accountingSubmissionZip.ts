import type { SubmissionItemAvailability, SubmissionPackageItemFormat } from './accountingSubmissionPackage'

export type SubmissionZipStage =
  | 'preparing'
  | 'generatingReports'
  | 'fetchingVouchers'
  | 'hashing'
  | 'compressing'
  | 'downloading'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type SubmissionZipProgress = {
  stage: SubmissionZipStage
  message: string
  reportsDone: number
  reportsTotal: number
  vouchersDone: number
  vouchersTotal: number
  /** 1-based index of the voucher currently being fetched (while fetchingVouchers) */
  currentVoucherIndex?: number
  /**
   * Public display name only (basename of ZIP relativePath).
   * Never Storage path / receiptId / Firestore id.
   */
  currentVoucherFileName?: string
  /** True while waiting for current Storage getBytes (cooperative cancel / timeout race) */
  cancelRequested?: boolean
}

export type SubmissionZipFileEntry = {
  relativePath: string
  byteSize: number
  contentHash?: string
}

export type SubmissionZipResult = {
  blob: Blob
  fileName: string
  /** Always 1 — number of files delivered to the browser (the ZIP itself) */
  fileCount: 1
  /** Number of entries inside the ZIP archive */
  archiveEntryCount: number
  byteSize: number
  contentHash?: string
  files: SubmissionZipFileEntry[]
  warnings: string[]
  isConfirmationZip: boolean
  /** Effective submission readiness after fetch failures / binary rejects */
  isSubmissionReady: boolean
  fetchFailureCount: number
}

export type SubmissionZipPublicManifestItem = {
  packageItemId: string
  relativePath: string
  format?: SubmissionPackageItemFormat | 'json'
  temporaryNumbers?: string[]
  availability: SubmissionItemAvailability | 'included' | 'failed'
  available: boolean
  byteSize?: number
  contentHash?: string
}

/** Public ZIP manifest — no Storage paths / Firestore ids / URLs */
export type SubmissionZipPublicManifest = {
  schemaVersion: 'submission.zip.1'
  targetYear: number
  fiscalPeriodLabel: string | null
  createdAt: string
  isConfirmationZip: boolean
  purpose: 'confirmation' | 'submission'
  items: SubmissionZipPublicManifestItem[]
}

export type SubmissionReceiptLoaderInput = {
  sourceReceiptId: string
  sourceStoragePath?: string
  sourceMimeType?: string
  signal?: AbortSignal
}

export type SubmissionReceiptBlobLoader = (input: SubmissionReceiptLoaderInput) => Promise<Blob>

export class SubmissionZipFatalError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SubmissionZipFatalError'
    this.code = code
  }
}

export class SubmissionZipCancelledError extends Error {
  constructor(message = 'ZIP生成がキャンセルされました') {
    super(message)
    this.name = 'SubmissionZipCancelledError'
  }
}
