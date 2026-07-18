/**
 * 軽量バックアップ方針（文字データのみ）。
 * 運用: GCS `care-taxi-meter-fs-backup-ane1` + Cloud Function `runLightweightFirestoreBackup`（毎週日曜 03:30 JST）。
 * Lifecycle 30日削除。画像/PDF/Storage は複製しない（コレクション allowlist）。
 */

export const LIGHTWEIGHT_BACKUP_RETENTION_DAYS = 30

/** Firestore バックアップ対象コレクション（allowlist） */
export const LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST = [
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'accountingFixedAssets',
  'accountingSettlementAuxiliary',
  'caseRecords',
  'workSessions',
  'staffAttendance',
  'companies',
  'stores',
  'vehicles',
  'meterSettings',
  'hqSettings',
  'fcPlans',
  'appSettings',
  'preOpeningResetState',
] as const

export type LightweightBackupCollection =
  (typeof LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST)[number]

/** 明示除外（大量ログ・秘密・Storage 参照はバックアップしない） */
export const LIGHTWEIGHT_BACKUP_COLLECTION_DENYLIST = [
  'auditLogs',
  'loginAttempts',
  'debugLogs',
  'staffMembers',
  'accountingReceipts',
] as const

/** ドキュメント内でバックアップから除外するフィールド */
export const LIGHTWEIGHT_BACKUP_SENSITIVE_FIELD_DENYLIST = [
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'idToken',
  'accessToken',
  'secret',
  'apiKey',
] as const

/** Storage / バイナリ参照フィールドは export 対象外（パス文字列もバックアップしない） */
export const LIGHTWEIGHT_BACKUP_BINARY_FIELD_DENYLIST = [
  'storagePath',
  'downloadUrl',
  'imageUrl',
  'originalStoragePath',
  'originalDownloadUrl',
  'ocrImageStoragePath',
  'ocrImageDownloadUrl',
  'receiptStoragePath',
  'receiptImageUrl',
  'receiptPreviewStoragePath',
  'receiptPreviewImageUrl',
  'receiptFileStoragePath',
  'receiptFileUrl',
  'pdfStoragePath',
  'fileUrl',
] as const

export type LightweightBackupStatus = {
  lastSuccessAt: string | null
  result: 'success' | 'failure' | 'never_run'
  collectionCounts: Partial<Record<LightweightBackupCollection, number>>
  totalDocuments: number
  message?: string
}

export const EMPTY_LIGHTWEIGHT_BACKUP_STATUS: LightweightBackupStatus = {
  lastSuccessAt: null,
  result: 'never_run',
  collectionCounts: {},
  totalDocuments: 0,
}

export function isLightweightBackupCollection(name: string): name is LightweightBackupCollection {
  return (LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST as readonly string[]).includes(name)
}

export function shouldExcludeBackupCollection(name: string): boolean {
  return (LIGHTWEIGHT_BACKUP_COLLECTION_DENYLIST as readonly string[]).includes(name)
}

export function stripSensitiveBackupFields<T extends Record<string, unknown>>(
  data: T,
): Record<string, unknown> {
  const sensitive = new Set<string>([
    ...LIGHTWEIGHT_BACKUP_SENSITIVE_FIELD_DENYLIST,
    ...LIGHTWEIGHT_BACKUP_BINARY_FIELD_DENYLIST,
  ])
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (sensitive.has(key)) {
      continue
    }
    if (key.toLowerCase().includes('password')) {
      continue
    }
    next[key] = value
  }
  return next
}

export function isBackupObjectExpired(
  objectCreatedAtMs: number,
  nowMs: number,
  retentionDays = LIGHTWEIGHT_BACKUP_RETENTION_DAYS,
): boolean {
  const ageMs = nowMs - objectCreatedAtMs
  return ageMs > retentionDays * 24 * 60 * 60 * 1000
}

/**
 * GCS ライフサイクル相当: 保持日数を超えたバックアップのみ削除候補にする。
 * 本番オブジェクトの削除はここでは実行しない（候補選定のみ）。
 */
export function selectExpiredBackupObjectNames(
  objects: Array<{ name: string; createdAtMs: number }>,
  nowMs: number,
  retentionDays = LIGHTWEIGHT_BACKUP_RETENTION_DAYS,
): string[] {
  return objects
    .filter((object) => isBackupObjectExpired(object.createdAtMs, nowMs, retentionDays))
    .map((object) => object.name)
}

export function buildLightweightBackupStatusUpdate(input: {
  success: boolean
  collectionCounts: Partial<Record<LightweightBackupCollection, number>>
  nowIso: string
  message?: string
}): LightweightBackupStatus {
  const totalDocuments = Object.values(input.collectionCounts).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  )
  return {
    lastSuccessAt: input.success ? input.nowIso : null,
    result: input.success ? 'success' : 'failure',
    collectionCounts: input.collectionCounts,
    totalDocuments,
    message: input.message,
  }
}
