import type { FiscalPeriod } from './accountingFiscalPeriod'

/** Phase 2A submission package schema identifier (not persisted on documents). */
export const SUBMISSION_PACKAGE_SCHEMA_VERSION = 'submission.1' as const

export type TemporaryNumberKind = 'EXP' | 'RCP' | 'AST' | 'SAL'

/**
 * Package-local temporary number, e.g. EXP-000001.
 * Never written to Firestore as submissionNo.
 */
export type TemporaryNumber = `${TemporaryNumberKind}-${string}`

export type SubmissionPackageItemType =
  | 'catalog'
  | 'report'
  | 'voucher'
  | 'unlinkedVoucher'
  | 'missingVoucherList'
  | 'unlinkedList'
  | 'manifest'

/**
 * Structure-preview availability.
 * - available: Phase 2A can produce CSV content or a stable planned path
 * - voucherPendingPhase2B: needs Storage/blob packaging (ZIP / PDF packing)
 * - notImplemented: ideal-tree item without an exporter yet
 * - dataMissing: linked path planned but original/storage is absent
 */
export type SubmissionItemAvailability =
  | 'available'
  | 'voucherPendingPhase2B'
  | 'notImplemented'
  | 'dataMissing'

export const SUBMISSION_ITEM_AVAILABILITY_LABELS: Record<SubmissionItemAvailability, string> = {
  available: '出力可能',
  voucherPendingPhase2B: 'ZIP生成時に出力',
  notImplemented: '現在未対応',
  dataMissing: 'データ不足',
}

/** Internal-only voucher pointer (may carry Firestore receipt id for Phase 2B). */
export type SubmissionVoucherRef = {
  temporaryNo: string
  relativePath: string
  /** Internal only — never emit in public CSV/manifest */
  receiptInternalId?: string
}

export type SubmissionPackageItemFormat =
  | 'csv'
  | 'pdf'
  | 'jpg'
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'json'

export type SubmissionPackageItem = {
  id: string
  type: SubmissionPackageItemType
  relativePath: string
  label: string
  availability: SubmissionItemAvailability
  /** Convenience: true when availability === 'available' */
  isAvailable: boolean
  format?: SubmissionPackageItemFormat
  /** Package-local temporary numbers associated with this item */
  temporaryNumbers?: string[]
  expenseTemporaryNo?: string
  receiptTemporaryNo?: string
  /**
   * Receipt temporary numbers attached to this item.
   * Today expense↔receipt is 1:1 via optional receiptId / linkedExpenseId;
   * array shape is reserved for future multi-voucher support.
   */
  receiptRefs?: string[]
  issueCodes?: string[]
  note?: string
  /** Internal — never emit in public CSV/manifest */
  sourceExpenseId?: string
  /** Internal — never emit in public CSV/manifest */
  sourceReceiptId?: string
  /** Internal — Storage path for Phase 2B fetch; never emit publicly */
  sourceStoragePath?: string
  /** Internal — mime hint for Phase 2B */
  sourceMimeType?: string
}

export type SubmissionPackageIssueSeverity = 'blocking' | 'warning'

export type SubmissionPackageIssue = {
  code: string
  severity: SubmissionPackageIssueSeverity
  message: string
  relatedTemporaryNos?: string[]
  relatedRelativePaths?: string[]
}

export type SubmissionPackageSummary = {
  expenseCount: number
  receiptCount: number
  fixedAssetCount: number
  salesCount: number
  linkedVoucherCount: number
  unlinkedVoucherCount: number
  missingVoucherCount: number
  reportItemCount: number
  availableItemCount: number
  pendingPhase2BCount: number
  notImplementedCount: number
  dataMissingCount: number
  blockingIssueCount: number
  warningIssueCount: number
  filingBlockingCount: number
  filingWarningCount: number
  /**
   * Technical ZIP assemblability (confirmation ZIP may include missing lists).
   * False only when the package cannot be structured (e.g. no FiscalPeriod).
   * Phase 2A UI still disables the ZIP button; this guides Phase 2B.
   */
  canGenerateZip: boolean
  /**
   * Submission-ready: FilingCheck blocking === 0 and package blocking issues === 0.
   * Missing voucher blocking issues make this false.
   */
  isSubmissionReady: boolean
}

/**
 * Public columns for 00_資料一覧.csv (expense ↔ voucher correspondence).
 * Never includes Firestore ids / storage paths / download URLs.
 */
export type PublicCatalogRow = {
  expenseNo: string
  receiptNo: string
  postingDate: string
  receiptDate: string
  vendorName: string
  description: string
  category: string
  amountYen: number
  taxCategoryLabel: string
  taxRate: string
  consumptionTaxYen: number
  invoiceStatusLabel: string
  voucherFileName: string
  hasOriginal: string
  confirmationStatus: string
  plReflection: string
  note: string
}

/** Public columns for 12_不足証憑一覧.csv */
export type PublicMissingVoucherRow = {
  expenseNo: string
  postingDate: string
  vendorName: string
  description: string
  amountYen: number
  missingReason: string
  exceptionReason: string
  severity: SubmissionPackageIssueSeverity
  reviewTarget: string
}

export type PublicManifestItem = {
  packageItemId: string
  type: SubmissionPackageItemType
  relativePath: string
  format?: SubmissionPackageItemFormat
  temporaryNumbers?: string[]
  availability: SubmissionItemAvailability
}

export type PublicSubmissionManifest = {
  schemaVersion: typeof SUBMISSION_PACKAGE_SCHEMA_VERSION
  targetYear: number
  fiscalPeriodLabel: string | null
  createdAt: string
  items: PublicManifestItem[]
}

export type InternalManifestItem = PublicManifestItem & {
  sourceExpenseId?: string
  sourceReceiptId?: string
  sourceStoragePath?: string
  sourceMimeType?: string
  receiptRefs?: string[]
}

/** Internal manifest for Phase 2B packaging — may include storage paths / source ids */
export type InternalSubmissionManifest = {
  schemaVersion: typeof SUBMISSION_PACKAGE_SCHEMA_VERSION
  targetYear: number
  fiscalPeriodLabel: string | null
  createdAt: string
  sourceFingerprint?: string
  items: InternalManifestItem[]
  voucherRefs: SubmissionVoucherRef[]
}

export type AccountingSubmissionPackage = {
  schemaVersion: typeof SUBMISSION_PACKAGE_SCHEMA_VERSION
  targetYear: number
  fiscalPeriod: FiscalPeriod | null
  fiscalPeriodLabel: string | null
  companyName?: string
  createdAt: string
  sourceFingerprint?: string
  temporaryNumbers: {
    expenses: Record<string, string>
    receipts: Record<string, string>
    fixedAssets: Record<string, string>
    sales: Record<string, string>
  }
  items: SubmissionPackageItem[]
  issues: SubmissionPackageIssue[]
  summary: SubmissionPackageSummary
  catalogRows: PublicCatalogRow[]
  missingVoucherRows: PublicMissingVoucherRow[]
}
