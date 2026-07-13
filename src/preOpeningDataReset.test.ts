import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIRESTORE_KEYS,
  DEFAULT_PRESERVED_CATEGORIES,
} from './services/reservationPreOpeningReset'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const readSource = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), 'utf8')

const extractStringArray = (source: string, constName: string): string[] => {
  const match = source.match(
    new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const`),
  )
  expect(match, `${constName} array not found`).toBeTruthy()
  return [...match![1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

const extractCallableBlock = (source: string, exportName: string) => {
  const start = source.indexOf(`export const ${exportName}`)
  expect(start).toBeGreaterThan(-1)
  const nextExport = source.indexOf('\nexport const ', start + 1)
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport)
}

describe('reservationPreOpeningReset frontend service', () => {
  it('does not call reservation-v4 admin APIs directly from the browser', () => {
    const source = readSource('src/services/reservationPreOpeningReset.ts')
    expect(source).not.toMatch(/\/api\/admin\/reservations\/pre-opening-reset/)
    expect(source).not.toMatch(/admin_token|adminToken|RESERVATION_V4_ADMIN_TOKEN/i)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).toContain('httpsCallable')
    expect(source).toContain('getPreOpeningResetCapability')
    expect(source).toContain('getPreOpeningReservationResetCapability')
    expect(source).toContain('executePreOpeningDataReset')
    expect(source).toContain('executePreOpeningReservationReset')
  })

  it('4. meter reset target type has no reservation fields', () => {
    const source = readSource('src/services/reservationPreOpeningReset.ts')
    expect(source).toMatch(
      /export type PreOpeningResetTargetCounts = \{\s*firestore: Record<string, number>\s*\}/,
    )
    expect(source).toContain('reservationDataUntouched: boolean')
    const meterCapabilityType = source.slice(
      source.indexOf('export type PreOpeningResetCapabilityResult'),
      source.indexOf('export type PreOpeningReservationResetCapabilityResult'),
    )
    expect(meterCapabilityType).not.toContain('dashboard')
    expect(meterCapabilityType).not.toContain('reservation:')
    const meterExecuteType = source.slice(
      source.indexOf('export type PreOpeningResetExecuteResult'),
      source.indexOf('export type PreOpeningReservationResetExecuteResult'),
    )
    expect(meterExecuteType).not.toContain('dashboard')
    expect(meterExecuteType).not.toContain('reservationLogId')
    expect(meterExecuteType).not.toContain('reservationSupported')
    expect(meterExecuteType).not.toContain('reservation:')
  })

  it('omits accounting and attendance collections from frontend firestore target keys', () => {
    for (const key of DEFAULT_FIRESTORE_KEYS) {
      expect(key.startsWith('accounting')).toBe(false)
    }
    expect(DEFAULT_FIRESTORE_KEYS).toEqual(['caseRecords', 'caseCounters', 'storageFiles'])
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('accounting')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('reservations')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('workSessions')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('auditLogs')
  })
})

describe('preOpeningResetAllowlist', () => {
  const allowlistSource = readSource('functions/src/preOpeningResetAllowlist.ts')
  const scopedCollections = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_SCOPED_COLLECTIONS',
  )
  const extraTargets = extractStringArray(allowlistSource, 'PRE_OPENING_RESET_EXTRA_TARGETS')
  const protectedCollections = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_PROTECTED_FIRESTORE_COLLECTIONS',
  )
  const storageTemplates = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_STORAGE_PREFIX_TEMPLATES',
  )

  it('5. caseRecords is deletable', () => {
    expect(scopedCollections).toEqual(['caseRecords'])
    expect(extraTargets).toEqual(['caseCounters'])
  })

  it('6. accounting collections are not deletable', () => {
    for (const collectionName of [
      'accountingReceipts',
      'accountingExpenses',
      'accountingFixedAssets',
      'accountingSales',
      'accountingExports',
    ]) {
      expect(scopedCollections).not.toContain(collectionName)
      expect(protectedCollections).toContain(collectionName)
    }
  })

  it('7-11. audit/admin/reset/attendance/login are not deletable', () => {
    for (const collectionName of [
      'auditLogs',
      'adminActionLogs',
      'resetLogs',
      'staffAttendance',
      'loginAttempts',
      'workSessions',
      'maintenanceLogs',
      'operationLogs',
      'debugLogs',
      'errorLogs',
    ]) {
      expect(scopedCollections).not.toContain(collectionName)
      expect(extraTargets).not.toContain(collectionName)
      expect(protectedCollections).toContain(collectionName)
    }
  })

  it('12. unknown collections are not on the allowlist', () => {
    expect(scopedCollections).not.toContain('brandNewUnknownCollection')
    expect(scopedCollections).not.toContain('futureFeatureData')
  })

  it('13-14. storage allowlist is operations/receipts only and excludes accounting', () => {
    expect(storageTemplates).toEqual([
      'operations/{franchiseeId}/{storeId}/',
      'receipts/{franchiseeId}/{storeId}/',
    ])
    for (const template of storageTemplates) {
      expect(template.startsWith('accounting/')).toBe(false)
    }
    expect(allowlistSource).toContain("PRE_OPENING_RESET_PROTECTED_STORAGE_ROOT = 'accounting/'")
  })
})

describe('preOpeningDataReset cloud function', () => {
  const source = readSource('functions/src/preOpeningDataReset.ts')
  const meterCapability = extractCallableBlock(source, 'getPreOpeningResetCapability')
  const meterExecute = extractCallableBlock(source, 'executePreOpeningDataReset')
  const reservationCapability = extractCallableBlock(
    source,
    'getPreOpeningReservationResetCapability',
  )
  const reservationExecute = extractCallableBlock(source, 'executePreOpeningReservationReset')

  it('1. executePreOpeningDataReset does not call reservation-v4', () => {
    expect(meterExecute).not.toContain('executeReservationReset')
    expect(meterExecute).not.toContain('fetchReservationResetCapability')
    expect(meterExecute).not.toContain('callReservationV4AdminApi')
    expect(meterExecute).not.toContain('reservationV4AdminToken')
    expect(meterExecute).not.toContain('secrets:')
    expect(meterExecute).not.toContain('reservation:')
    expect(meterExecute).not.toContain('dashboard')
    expect(meterExecute).not.toContain('reservationLogId')
    expect(meterExecute).toContain('deleteFirestoreScopedData')
    expect(meterExecute).toContain('preserved: buildPreservedPayload()')
    expect(source).toContain('reservationDataUntouched: true as const')
  })

  it('2. getPreOpeningResetCapability does not call reservation-v4', () => {
    expect(meterCapability).not.toContain('fetchReservationResetCapability')
    expect(meterCapability).not.toContain('callReservationV4AdminApi')
    expect(meterCapability).not.toContain('secrets:')
    expect(meterCapability).not.toContain('reservation:')
    expect(meterCapability).not.toContain('dashboard')
    expect(meterCapability).toContain('countFirestoreTargets')
    expect(meterCapability).toContain('supported: true')
  })

  it('3. reservation-only callables still call reservation-v4', () => {
    expect(reservationCapability).toContain('secrets: [reservationV4AdminToken]')
    expect(reservationCapability).toContain('fetchReservationResetCapability')
    expect(reservationCapability).toContain("'reservations'")
    expect(reservationExecute).toContain('secrets: [reservationV4AdminToken]')
    expect(reservationExecute).toContain('executeReservationReset')
    expect(reservationExecute).toContain("resetScope: 'reservations'")
    expect(source).toContain('/api/admin/reservations/pre-opening-reset/capability')
    expect(source).toContain('/api/admin/reservations/pre-opening-reset')
  })

  it('restricts callable access to owner and hq_admin', () => {
    expect(source).toContain("role !== 'owner' && role !== 'hq_admin'")
    expect(source).toContain('confirmText !== PRE_OPENING_RESET_CONFIRM_TEXT')
  })

  it('keeps franchiseeId and storeId scope for deletions', () => {
    expect(source).toContain(".where('franchiseeId', '==', franchiseeId)")
    expect(source).toContain(".where('storeId', '==', storeId)")
    expect(source).toContain('assertScopeAuthorized')
  })

  it('17. re-run safely completes with zero remaining deletes', () => {
    expect(source).toContain('if (snapshot.empty)')
    expect(source).toContain('return deletedCount')
    expect(source).toContain('while (true)')
  })

  it('filters protected storage paths before delete', () => {
    expect(source).toContain('buildAllowlistedStoragePrefixes')
    expect(source).toContain('isProtectedStoragePath')
    expect(source).not.toMatch(/`accounting\/\$\{franchiseeId\}\/\$\{storeId\}\/`/)
  })
})

describe('PreOpeningDataResetPanel', () => {
  const source = readSource('src/components/admin/PreOpeningDataResetPanel.tsx')

  it('15. shows reservation untouched warning and narrowed lists', () => {
    expect(source).toContain('削除されるデータ')
    expect(source).toContain('削除されないデータ')
    expect(source).toContain('経理データおよび経理証憑は削除されません')
    expect(source).toContain('予約データは削除されません。予約削除は管理LPから実行してください')
    expect(source).toContain('この操作では予約データは削除されません。予約削除は管理LPから実行してください。')
    expect(source).toContain('予約情報')
    expect(source).toContain('従業員勤怠')
    expect(source).toContain('監査ログ')
    expect(source).toContain("confirmText !== 'RESET'")
    expect(source).toContain('window.confirm')
    expect(source).not.toContain('reservation-v4 対応')
    expect(source).not.toContain('予約管理DLの現在件数')
  })
})

describe('PreOpeningReservationResetPanel', () => {
  it('16. reservation-only reset UI remains unchanged in behavior', () => {
    const source = readSource('src/components/admin/PreOpeningReservationResetPanel.tsx')
    expect(source).toContain('開業前予約データ初期化')
    expect(source).toContain("confirmText !== 'RESET'")
    expect(source).toContain('window.confirm')
    expect(source).toContain('予約件数')
    expect(source).toContain('未対応')
    expect(source).toContain('確認済')
    expect(source).toContain('executePreOpeningReservationReset')
    expect(source).toContain('fetchPreOpeningReservationResetCapability')
  })
})

describe('driver-proxy does not expose admin reset routes', () => {
  it('only allows driver reservation routes', () => {
    const source = readSource('workers/driver-proxy/src/routing.ts')
    expect(source).not.toMatch(/pre-opening-reset/)
    expect(source).toContain('/api/driver/reservations')
  })
})

describe('frontend/backend allowlist consistency', () => {
  it('frontend firestore keys match backend allowlist targets', () => {
    const allowlistSource = readSource('functions/src/preOpeningResetAllowlist.ts')
    const scoped = extractStringArray(allowlistSource, 'PRE_OPENING_RESET_SCOPED_COLLECTIONS')
    const extra = extractStringArray(allowlistSource, 'PRE_OPENING_RESET_EXTRA_TARGETS')
    const expected = [...scoped, ...extra, 'storageFiles']
    expect([...DEFAULT_FIRESTORE_KEYS]).toEqual(expected)
  })
})
