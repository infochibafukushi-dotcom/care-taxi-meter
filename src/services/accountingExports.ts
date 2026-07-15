import { addDoc, collection, getDocs, getFirestore, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingExportFileManifestItem,
  AccountingExportFiscalPeriodSnapshot,
  AccountingExportInput,
  AccountingExportReadinessSnapshot,
  AccountingExportSourceRecordCounts,
  StoredAccountingExport,
} from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAccountingTenantConstraints } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingExports'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Recursively remove undefined so Firestore accepts the payload. */
export const stripUndefined = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined)
  }
  if (!isPlainObject(value)) {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined) {
      continue
    }
    const cleaned = stripUndefined(nested)
    if (cleaned !== undefined) {
      result[key] = cleaned
    }
  }
  return result
}

/** Alias for stripUndefined — preferred name in Phase 1D docs/tests. */
export const removeUndefinedDeep = stripUndefined

const toIsoCreatedAt = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value) {
    return value
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

const mapFileManifest = (value: unknown): AccountingExportFileManifestItem[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.map((item) => {
    const row = isPlainObject(item) ? item : {}
    const mapped: AccountingExportFileManifestItem = {
      fileName: String(row.fileName ?? ''),
      format: row.format === 'pdf' ? 'pdf' : 'csv',
      documentType: String(row.documentType ?? ''),
    }
    if (row.rowCount !== undefined) {
      mapped.rowCount = Number(row.rowCount)
    }
    if (row.byteSize !== undefined) {
      mapped.byteSize = Number(row.byteSize)
    }
    if (typeof row.contentHash === 'string') {
      mapped.contentHash = row.contentHash
    }
    return mapped
  })
}

const mapFiscalPeriod = (value: unknown): AccountingExportFiscalPeriodSnapshot | undefined => {
  if (!isPlainObject(value)) {
    return undefined
  }
  return {
    fiscalYear: Number(value.fiscalYear ?? 0),
    startDate: String(value.startDate ?? ''),
    endDate: String(value.endDate ?? ''),
    startYearMonth: String(value.startYearMonth ?? ''),
    endYearMonth: String(value.endYearMonth ?? ''),
    isShortFiscalYear: Boolean(value.isShortFiscalYear),
    monthCount: value.monthCount !== undefined ? Number(value.monthCount) : undefined,
    label: String(value.label ?? ''),
  }
}

const mapReadiness = (value: unknown): AccountingExportReadinessSnapshot | undefined => {
  if (!isPlainObject(value)) {
    return undefined
  }
  return {
    blockingCount: Number(value.blockingCount ?? 0),
    warningCount: Number(value.warningCount ?? 0),
    plannedCount: Number(value.plannedCount ?? 0),
    completeCount: Number(value.completeCount ?? 0),
    notApplicableCount: Number(value.notApplicableCount ?? 0),
    isFilingReady: Boolean(value.isFilingReady),
  }
}

const mapSourceRecordCounts = (value: unknown): AccountingExportSourceRecordCounts | undefined => {
  if (!isPlainObject(value)) {
    return undefined
  }
  const counts: AccountingExportSourceRecordCounts = {}
  for (const key of ['sales', 'expenses', 'receipts', 'fixedCosts', 'fixedAssets', 'adjustments'] as const) {
    if (value[key] !== undefined) {
      counts[key] = Number(value[key])
    }
  }
  return Object.keys(counts).length > 0 ? counts : undefined
}

export async function recordAccountingExport(input: AccountingExportInput) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-export'
  }

  const db = getFirestore(getFirebaseApp())
  const payload = stripUndefined({
    ...input,
    createdAt: serverTimestamp(),
  }) as Record<string, unknown>

  const document = await addDoc(collection(db, collectionName), payload)

  return document.id
}

export async function fetchAccountingExports(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as StoredAccountingExport[]
  }

  const db = getFirestore(getFirebaseApp())
  const snapshots = await getDocs(
    query(
      collection(db, collectionName),
      ...createAccountingTenantConstraints(scope),
      orderBy('createdAt', 'desc'),
    ),
  )

  return snapshots.docs
    .map((snapshot) => {
      const data = snapshot.data()
      const entry: StoredAccountingExport = {
        id: snapshot.id,
        franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
        companyId: String(data.companyId ?? data.franchiseeId ?? ''),
        storeId: String(data.storeId ?? ''),
        exportType: data.exportType as StoredAccountingExport['exportType'],
        targetYearMonth: String(data.targetYearMonth ?? ''),
        fileName: String(data.fileName ?? ''),
        rowCount: Number(data.rowCount ?? 0),
        createdBy: String(data.createdBy ?? ''),
        createdByName: String(data.createdByName ?? ''),
        createdAt: toIsoCreatedAt(data.createdAt),
      }

      const fiscalPeriod = mapFiscalPeriod(data.fiscalPeriod)
      if (fiscalPeriod) {
        entry.fiscalPeriod = fiscalPeriod
      }
      if (data.fileCount !== undefined) {
        entry.fileCount = Number(data.fileCount)
      }
      const files = mapFileManifest(data.files)
      if (files) {
        entry.files = files
      }
      const readiness = mapReadiness(data.readiness)
      if (readiness) {
        entry.readiness = readiness
      }
      if (typeof data.sourceFingerprint === 'string') {
        entry.sourceFingerprint = data.sourceFingerprint
      }
      const sourceRecordCounts = mapSourceRecordCounts(data.sourceRecordCounts)
      if (sourceRecordCounts) {
        entry.sourceRecordCounts = sourceRecordCounts
      }
      if (typeof data.exportSchemaVersion === 'string') {
        entry.exportSchemaVersion = data.exportSchemaVersion
      }

      return entry
    })
    .filter((entry) => matchesTenantScope(entry, scope))
}
