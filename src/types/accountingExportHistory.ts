export type AccountingExportType =
  | 'monthly-pl'
  | 'expenses'
  | 'sales'
  | 'yearly-management-pl-csv'
  | 'audit-pdf'
  | 'audit-csv'
  | 'etax-pdf'
  | 'etax-csv'
  | 'tax-advisor-pdf'
  | 'tax-advisor-csv'
  | 'submission-zip'

export const ACCOUNTING_EXPORT_SCHEMA_VERSION = '1d.1'

export type AccountingExportFileManifestItem = {
  fileName: string
  format: 'pdf' | 'csv' | 'zip' | 'json'
  documentType: string
  rowCount?: number
  byteSize?: number
  contentHash?: string
}

export type AccountingExportReadinessSnapshot = {
  blockingCount: number
  warningCount: number
  plannedCount: number
  completeCount: number
  notApplicableCount: number
  isFilingReady: boolean
}

export type AccountingExportFiscalPeriodSnapshot = {
  fiscalYear: number
  startDate: string
  endDate: string
  startYearMonth: string
  endYearMonth: string
  isShortFiscalYear: boolean
  monthCount?: number
  label: string
}

export type AccountingExportSourceRecordCounts = {
  sales?: number
  expenses?: number
  receipts?: number
  fixedCosts?: number
  fixedAssets?: number
  adjustments?: number
}

/** Phase 1D export input — legacy required fields + optional history metadata */
export type AccountingExportInput = {
  franchiseeId: string
  companyId: string
  storeId: string
  exportType: AccountingExportType
  /** legacy; may be endYearMonth or calendar month or '' */
  targetYearMonth: string
  /** primary/first file name for legacy display */
  fileName: string
  /** legacy; sum or first file rows */
  rowCount: number
  createdBy: string
  createdByName: string
  fiscalPeriod?: AccountingExportFiscalPeriodSnapshot
  fileCount?: number
  files?: AccountingExportFileManifestItem[]
  readiness?: AccountingExportReadinessSnapshot
  sourceFingerprint?: string
  sourceRecordCounts?: AccountingExportSourceRecordCounts
  exportSchemaVersion?: string
  /** Phase 2B submission ZIP purpose */
  submissionPurpose?: 'confirmation' | 'submission'
  /** Entries inside a submission ZIP (not the download file count) */
  archiveEntryCount?: number
}

export type StoredAccountingExport = AccountingExportInput & {
  id: string
  createdAt?: string
}

const EXPORT_TYPE_LABELS: Record<AccountingExportType, string> = {
  'monthly-pl': '月次PL CSV',
  expenses: '経費 CSV',
  sales: '確定売上 CSV',
  'yearly-management-pl-csv': '年次管理会計PL CSV',
  'audit-pdf': '監査資料 PDF',
  'audit-csv': '監査資料 CSV',
  'etax-pdf': 'e-Tax PDF',
  'etax-csv': 'e-Tax CSV',
  'tax-advisor-pdf': '税理士相談用 PDF',
  'tax-advisor-csv': '税理士相談用 CSV',
  'submission-zip': '税務確認提出ZIP',
}

export const formatAccountingExportTypeLabel = (type: string): string => {
  if (type in EXPORT_TYPE_LABELS) {
    return EXPORT_TYPE_LABELS[type as AccountingExportType]
  }
  return type || '不明'
}

/** Payload from settlement panels after a successful package download */
export type AccountingExportPackageRecordPayload = {
  exportType: Extract<
    AccountingExportType,
    | 'etax-pdf'
    | 'etax-csv'
    | 'tax-advisor-pdf'
    | 'tax-advisor-csv'
    | 'audit-pdf'
    | 'audit-csv'
    | 'submission-zip'
  >
  files: AccountingExportFileManifestItem[]
  fiscalPeriod?: AccountingExportFiscalPeriodSnapshot
  readiness?: AccountingExportReadinessSnapshot
  sourceFingerprint?: string
  sourceRecordCounts?: AccountingExportSourceRecordCounts
  targetYearMonth: string
  /** confirmation ZIP vs submission-ready ZIP */
  submissionPurpose?: 'confirmation' | 'submission'
  /** Entries inside the ZIP; fileCount remains download files (1 for ZIP) */
  archiveEntryCount?: number
}
