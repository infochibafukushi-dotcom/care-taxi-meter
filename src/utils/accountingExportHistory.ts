import { recordAccountingExport, stripUndefined } from '../services/accountingExports'
import type {
  AccountingExportFileManifestItem,
  AccountingExportFiscalPeriodSnapshot,
  AccountingExportInput,
  AccountingExportReadinessSnapshot,
  AccountingExportSourceRecordCounts,
  AccountingExportType,
} from '../types/accountingExportHistory'
import { ACCOUNTING_EXPORT_SCHEMA_VERSION } from '../types/accountingExportHistory'

export type RecordAccountingExportOperationParams = {
  franchiseeId: string
  companyId: string
  storeId: string
  createdBy: string
  createdByName: string
  exportType: AccountingExportType
  fiscalPeriod?: AccountingExportFiscalPeriodSnapshot | null
  targetYearMonth: string
  files: AccountingExportFileManifestItem[]
  readiness?: AccountingExportReadinessSnapshot
  sourceFingerprint?: string
  sourceRecordCounts?: AccountingExportSourceRecordCounts
  exportSchemaVersion?: string
}

const sumRowCount = (files: AccountingExportFileManifestItem[]) =>
  files.reduce((sum, file) => sum + (file.rowCount ?? 0), 0)

/** Build a manifest item with only defined optional keys (Firestore-safe). */
export const buildFileManifestItem = (
  file: AccountingExportFileManifestItem,
): AccountingExportFileManifestItem => {
  const item: AccountingExportFileManifestItem = {
    fileName: file.fileName,
    format: file.format,
    documentType: file.documentType,
  }
  if (file.rowCount !== undefined) {
    item.rowCount = file.rowCount
  }
  if (file.byteSize !== undefined) {
    item.byteSize = file.byteSize
  }
  if (file.contentHash !== undefined) {
    item.contentHash = file.contentHash
  }
  return item
}

/**
 * Records an export operation into accountingExports (single Firestore write).
 * Callers must not also call recordAccountingExport for the same package —
 * panels toast via onExportRecorded and persist only via onExportPackageRecorded → this helper.
 * Fingerprint omission is the caller's responsibility (or pass undefined);
 * this helper never throws for optional metadata.
 */
export async function recordAccountingExportOperation(
  params: RecordAccountingExportOperationParams,
): Promise<{ id: string } | { error: string }> {
  const files = params.files.map(buildFileManifestItem)
  if (files.length === 0) {
    return { error: 'files is empty' }
  }

  const fileNames = files.map((file) => file.fileName)
  const uniqueNames = new Set(fileNames)
  if (uniqueNames.size !== fileNames.length) {
    return { error: 'duplicate fileNames in manifest' }
  }

  const fileCount = files.length
  if (fileCount !== files.length) {
    return { error: 'fileCount mismatch' }
  }

  const input: AccountingExportInput = {
    franchiseeId: params.franchiseeId,
    companyId: params.companyId,
    storeId: params.storeId,
    exportType: params.exportType,
    targetYearMonth: params.targetYearMonth,
    fileName: files[0].fileName,
    rowCount: sumRowCount(files),
    createdBy: params.createdBy,
    createdByName: params.createdByName,
    fileCount,
    files,
    exportSchemaVersion: params.exportSchemaVersion ?? ACCOUNTING_EXPORT_SCHEMA_VERSION,
  }

  if (params.fiscalPeriod) {
    input.fiscalPeriod = params.fiscalPeriod
  }
  if (params.readiness) {
    input.readiness = params.readiness
  }
  if (params.sourceFingerprint) {
    input.sourceFingerprint = params.sourceFingerprint
  }
  if (params.sourceRecordCounts) {
    input.sourceRecordCounts = params.sourceRecordCounts
  }

  // Defensive: strip any accidental undefined before Firestore write.
  const cleaned = stripUndefined(input) as AccountingExportInput
  if (cleaned.fileCount !== (cleaned.files?.length ?? 0)) {
    return { error: 'fileCount mismatch' }
  }

  try {
    const id = await recordAccountingExport(cleaned)
    return { id }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '出力操作履歴の保存に失敗しました。',
    }
  }
}

export const shortFingerprint = (fingerprint: string | undefined, length = 10): string => {
  if (!fingerprint) {
    return '記録なし'
  }
  return fingerprint.slice(0, length)
}
