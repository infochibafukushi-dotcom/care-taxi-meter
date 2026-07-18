import { describe, expect, it } from 'vitest'
import {
  LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST,
  LIGHTWEIGHT_BACKUP_RETENTION_DAYS,
  buildLightweightBackupStatusUpdate,
  isLightweightBackupCollection,
  selectExpiredBackupObjectNames,
  shouldExcludeBackupCollection,
  stripSensitiveBackupFields,
} from './lightweightBackupPolicy'

describe('lightweightBackupPolicy', () => {
  it('keeps only allowlisted collections', () => {
    expect(isLightweightBackupCollection('accountingExpenses')).toBe(true)
    expect(isLightweightBackupCollection('preOpeningResetState')).toBe(true)
    expect(isLightweightBackupCollection('auditLogs')).toBe(false)
    expect(shouldExcludeBackupCollection('staffMembers')).toBe(true)
    expect(shouldExcludeBackupCollection('accountingReceipts')).toBe(true)
    expect(LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST).not.toContain('staffMembers')
  })

  it('strips passwords and storage/binary fields from backup payloads', () => {
    const stripped = stripSensitiveBackupFields({
      vendorName: '店',
      password: 'secret',
      staffMembersPassword: 'x',
      storagePath: 'accounting/f1/s1/receipts/r1/original.jpg',
      downloadUrl: 'https://example.com/a.jpg',
      amount: 1000,
    })
    expect(stripped).toEqual({ vendorName: '店', amount: 1000 })
    expect(stripped).not.toHaveProperty('password')
    expect(stripped).not.toHaveProperty('storagePath')
    expect(stripped).not.toHaveProperty('downloadUrl')
  })

  it('selects only backups older than 30 days for deletion candidates', () => {
    const now = Date.parse('2026-07-18T00:00:00Z')
    const day = 24 * 60 * 60 * 1000
    const expired = selectExpiredBackupObjectNames(
      [
        { name: 'old.gz', createdAtMs: now - 31 * day },
        { name: 'keep.gz', createdAtMs: now - 29 * day },
        { name: 'edge.gz', createdAtMs: now - 30 * day - 1 },
      ],
      now,
      LIGHTWEIGHT_BACKUP_RETENTION_DAYS,
    )
    expect(expired).toEqual(['old.gz', 'edge.gz'])
  })

  it('stores only a single status snapshot shape (no history accumulation)', () => {
    const status = buildLightweightBackupStatusUpdate({
      success: true,
      nowIso: '2026-07-18T12:00:00.000Z',
      collectionCounts: { accountingExpenses: 26, caseRecords: 10 },
    })
    expect(status.result).toBe('success')
    expect(status.lastSuccessAt).toBe('2026-07-18T12:00:00.000Z')
    expect(status.totalDocuments).toBe(36)
    expect(Object.keys(status)).not.toContain('history')
  })
})
