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

  it('omits accounting collections from frontend firestore target keys', () => {
    for (const key of DEFAULT_FIRESTORE_KEYS) {
      expect(key.startsWith('accounting')).toBe(false)
    }
    expect(DEFAULT_FIRESTORE_KEYS).toContain('caseRecords')
    expect(DEFAULT_FIRESTORE_KEYS).toContain('workSessions')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('accounting')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('accountingReceipts')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('accountingFixedAssets')
  })
})

describe('preOpeningResetAllowlist', () => {
  const allowlistSource = readSource('functions/src/preOpeningResetAllowlist.ts')
  const scopedCollections = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_SCOPED_COLLECTIONS',
  )
  const protectedCollections = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_PROTECTED_FIRESTORE_COLLECTIONS',
  )
  const storageTemplates = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_STORAGE_PREFIX_TEMPLATES',
  )
  const preservedCategories = extractStringArray(
    allowlistSource,
    'PRE_OPENING_RESET_PRESERVED_CATEGORIES',
  )

  it('1. allowlist excludes accounting and master data', () => {
    for (const collectionName of scopedCollections) {
      expect(collectionName.startsWith('accounting')).toBe(false)
      expect(protectedCollections).not.toContain(collectionName)
    }
    expect(scopedCollections).not.toContain('companies')
    expect(scopedCollections).not.toContain('staffMembers')
    expect(scopedCollections).not.toContain('vehicles')
    expect(scopedCollections).not.toContain('meterSettings')
    expect(scopedCollections).toContain('caseRecords')
    expect(scopedCollections).toContain('workSessions')
    expect(scopedCollections).toContain('auditLogs')
  })

  it('2. protected list covers franchise/store/staff/vehicle/fare/accounting', () => {
    for (const required of [
      'companies',
      'stores',
      'staffMembers',
      'vehicles',
      'meterSettings',
      'accountingExpenses',
      'accountingReceipts',
      'accountingFixedAssets',
      'accountingSales',
      'accountingExports',
      'accountingSettlementAuxiliary',
      'accountingAdjustments',
      'accountingFixedCosts',
    ]) {
      expect(protectedCollections).toContain(required)
    }
    expect(preservedCategories).toContain('accounting')
    expect(preservedCategories).toContain('accountingStorage')
    expect(preservedCategories).toContain('firebaseAuth')
  })

  it('3. delete targets include operational sales/trip/settlement sources', () => {
    expect(scopedCollections).toContain('caseRecords')
    expect(scopedCollections).toContain('workSessions')
    expect(allowlistSource).toContain("'caseCounters'")
    expect(allowlistSource).toContain('PRE_OPENING_RESET_EXTRA_TARGETS')
  })

  it('5. storage allowlist never includes accounting paths', () => {
    for (const template of storageTemplates) {
      expect(template.startsWith('accounting/')).toBe(false)
      expect(template.includes('/accounting/')).toBe(false)
    }
    expect(allowlistSource).toContain("PRE_OPENING_RESET_PROTECTED_STORAGE_ROOT = 'accounting/'")
    expect(allowlistSource).toContain('isProtectedStoragePath')
  })

  it('6. unknown collections are not on the allowlist', () => {
    expect(scopedCollections).not.toContain('brandNewUnknownCollection')
    expect(scopedCollections).not.toContain('futureFeatureData')
    expect(isAllowlistedViaSource('brandNewUnknownCollection')).toBe(false)
  })

  function isAllowlistedViaSource(collectionName: string) {
    return scopedCollections.includes(collectionName)
  }
})

describe('preOpeningDataReset cloud function', () => {
  const source = readSource('functions/src/preOpeningDataReset.ts')

  it('uses server-side admin bearer token for reservation-v4', () => {
    expect(source).toContain('RESERVATION_V4_ADMIN_TOKEN')
    expect(source).toContain('RESERVATION_V4_ORIGIN')
    expect(source).toContain('Authorization: `Bearer ${token}`')
    expect(source).toContain('/api/admin/reservations/pre-opening-reset/capability')
    expect(source).toContain('/api/admin/reservations/pre-opening-reset')
    expect(source).toContain('scope=${resetScope}')
    expect(source).toContain('scope: resetScope')
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('deletes reservation data before firestore in full reset', () => {
    const executeIndex = source.indexOf('export const executePreOpeningDataReset')
    const executeBody = source.slice(executeIndex)
    const reservationIndex = executeBody.indexOf('executeReservationReset')
    const firestoreIndex = executeBody.indexOf('deleteFirestoreScopedData')
    expect(reservationIndex).toBeGreaterThan(-1)
    expect(firestoreIndex).toBeGreaterThan(-1)
    expect(reservationIndex).toBeLessThan(firestoreIndex)
  })

  it('exposes reservation-only reset callables', () => {
    expect(source).toContain('getPreOpeningReservationResetCapability')
    expect(source).toContain('executePreOpeningReservationReset')
    expect(source).toContain("resetScope: 'reservations'")
  })

  it('deletes scoped operational log collections only via allowlist', () => {
    const allowlistSource = readSource('functions/src/preOpeningResetAllowlist.ts')
    expect(source).toContain('PRE_OPENING_RESET_SCOPED_COLLECTIONS')
    expect(source).toContain('isAllowlistedScopedCollection')
    expect(allowlistSource).toContain("'auditLogs'")
    expect(allowlistSource).toContain("'maintenanceLogs'")
    expect(allowlistSource).toContain("'adminActionLogs'")
    expect(allowlistSource).toContain("'loginAttempts'")
    expect(allowlistSource).toContain("'operationLogs'")
    expect(allowlistSource).toContain("'debugLogs'")
    expect(allowlistSource).toContain("'errorLogs'")
    expect(allowlistSource).toContain("'resetLogs'")
    expect(source).not.toContain('deleteUser')
    expect(source).not.toContain("deleteCollectionByScope('staffMembers'")
    expect(source).not.toContain("deleteCollectionByScope('accounting")
    expect(source).not.toMatch(/`accounting\/\$\{franchiseeId\}\/\$\{storeId\}\/`/)
  })

  it('7. restricts callable access to owner and hq_admin', () => {
    expect(source).toContain("role !== 'owner' && role !== 'hq_admin'")
    expect(source).toContain('confirmText !== PRE_OPENING_RESET_CONFIRM_TEXT')
  })

  it('returns preserved payload with accountingProtected', () => {
    expect(source).toContain('buildPreservedPayload')
    expect(source).toContain('preserved: buildPreservedPayload()')
    expect(source).toContain('accountingProtected: true as const')
  })

  it('4. keeps franchiseeId and storeId scope for deletions', () => {
    expect(source).toContain(".where('franchiseeId', '==', franchiseeId)")
    expect(source).toContain(".where('storeId', '==', storeId)")
    expect(source).toContain('assertScopeAuthorized')
    expect(source).toContain('他加盟店のデータは初期化できません')
  })

  it('8. re-run safely completes with zero remaining deletes', () => {
    expect(source).toContain('if (snapshot.empty)')
    expect(source).toContain('return deletedCount')
    expect(source).toContain('while (true)')
  })

  it('filters protected storage paths before delete', () => {
    expect(source).toContain('buildAllowlistedStoragePrefixes')
    expect(source).toContain('isProtectedStoragePath')
    expect(source).toContain('if (isProtectedStoragePath(file.name))')
  })
})

describe('PreOpeningDataResetPanel', () => {
  const source = readSource('src/components/admin/PreOpeningDataResetPanel.tsx')

  it('shows delete/preserve lists and accounting warning', () => {
    expect(source).toContain('削除されるデータ')
    expect(source).toContain('削除されないデータ')
    expect(source).toContain('経理データおよび経理証憑は削除されません')
    expect(source).toContain('経理データ')
    expect(source).toContain('未整理領収書')
    expect(source).toContain('固定資産')
    expect(source).toContain('Firebase Authentication')
    expect(source).toContain("confirmText !== 'RESET'")
    expect(source).toContain('window.confirm')
    expect(source).not.toContain('経理レシート')
    expect(source).not.toContain('経理経費')
  })
})

describe('PreOpeningReservationResetPanel', () => {
  it('requires RESET confirmation and shows reservation-only targets', () => {
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
