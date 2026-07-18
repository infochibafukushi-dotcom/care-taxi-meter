import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIRESTORE_KEYS,
  DEFAULT_PRESERVED_CATEGORIES,
} from './services/reservationPreOpeningReset'
import {
  evaluatePreOpeningResetEligibility,
  matchesStoreIdConfirmText,
} from './utils/preOpeningResetGuard'

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
    expect(source).toContain('executePreOpeningDataReset')
  })

  it('includes sales, attendance, and reservation targets in unified capability type', () => {
    const source = readSource('src/services/reservationPreOpeningReset.ts')
    expect(source).toContain('firestore: Record<string, number>')
    expect(source).toContain('reservation: Record<string, number>')
    expect(source).toContain('salesOperations')
    expect(source).toContain('reservationsCustomers')
    expect(source).toContain('attendance')
  })

  it('omits accounting collections from frontend firestore target keys', () => {
    for (const key of DEFAULT_FIRESTORE_KEYS) {
      expect(key.startsWith('accounting')).toBe(false)
    }
    expect(DEFAULT_FIRESTORE_KEYS).toEqual([
      'caseRecords',
      'workSessions',
      'staffAttendance',
      'caseCounters',
      'storageFiles',
    ])
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('accounting')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('reservationBlocks')
    expect(DEFAULT_PRESERVED_CATEGORIES).toContain('auditLogs')
    expect(DEFAULT_PRESERVED_CATEGORIES).not.toContain('workSessions')
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
  const preserved = extractStringArray(allowlistSource, 'PRE_OPENING_RESET_PRESERVED_CATEGORIES')

  it('deletes sales/ops and attendance actuals', () => {
    expect(scopedCollections).toEqual(['caseRecords', 'workSessions', 'staffAttendance'])
    expect(extraTargets).toEqual(['caseCounters'])
  })

  it('keeps accounting out of delete allowlist', () => {
    for (const collectionName of [
      'accountingReceipts',
      'accountingExpenses',
      'accountingFixedAssets',
      'accountingSales',
      'accountingExports',
    ]) {
      expect(scopedCollections).not.toContain(collectionName)
      expect(extraTargets).not.toContain(collectionName)
      expect(protectedCollections).toContain(collectionName)
    }
  })

  it('keeps franchisee/store/staff masters protected', () => {
    for (const collectionName of ['companies', 'stores', 'staffMembers']) {
      expect(scopedCollections).not.toContain(collectionName)
      expect(protectedCollections).toContain(collectionName)
    }
  })

  it('keeps audit and auth logs protected', () => {
    for (const collectionName of [
      'auditLogs',
      'adminActionLogs',
      'loginAttempts',
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

  it('does not allowlist unknown collections', () => {
    expect(scopedCollections).not.toContain('brandNewUnknownCollection')
    expect(scopedCollections).not.toContain('futureFeatureData')
  })

  it('storage allowlist excludes accounting and preserves ops receipts only', () => {
    expect(storageTemplates).toEqual([
      'operations/{franchiseeId}/{storeId}/',
      'receipts/{franchiseeId}/{storeId}/',
    ])
    for (const template of storageTemplates) {
      expect(template.startsWith('accounting/')).toBe(false)
    }
  })

  it('documents reservation blocks and shift settings as preserved categories', () => {
    expect(preserved).toContain('reservationBlocks')
    expect(preserved).toContain('businessHours')
    expect(preserved).toContain('shiftSettings')
    expect(preserved).toContain('workCategories')
  })
})

describe('preOpeningResetGuard', () => {
  it('allows only screening/preparing and unlocked stores', () => {
    expect(evaluatePreOpeningResetEligibility({ companyStatus: 'preparing', locked: false }).allowed).toBe(
      true,
    )
    expect(evaluatePreOpeningResetEligibility({ companyStatus: 'screening', locked: false }).allowed).toBe(
      true,
    )
    expect(evaluatePreOpeningResetEligibility({ companyStatus: 'active', locked: false }).allowed).toBe(
      false,
    )
    expect(evaluatePreOpeningResetEligibility({ companyStatus: 'preparing', locked: true }).allowed).toBe(
      false,
    )
  })

  it('requires exact storeId confirm text', () => {
    expect(matchesStoreIdConfirmText('store-1', 'store-1')).toBe(true)
    expect(matchesStoreIdConfirmText('RESET', 'store-1')).toBe(false)
    expect(matchesStoreIdConfirmText('store-1 ', 'store-1')).toBe(true)
    expect(matchesStoreIdConfirmText('', 'store-1')).toBe(false)
  })

  it('mirrors functions guard source', () => {
    const client = readSource('src/utils/preOpeningResetGuard.ts')
    const server = readSource('functions/src/preOpeningResetGuard.ts')
    expect(client).toContain("['screening', 'preparing']")
    expect(server).toContain("['screening', 'preparing']")
    expect(client).toContain('matchesStoreIdConfirmText')
    expect(server).toContain('matchesStoreIdConfirmText')
  })
})

describe('preOpeningDataReset cloud function', () => {
  const source = readSource('functions/src/preOpeningDataReset.ts')
  const meterCapability = extractCallableBlock(source, 'getPreOpeningResetCapability')
  const meterExecute = extractCallableBlock(source, 'executePreOpeningDataReset')

  it('does not use developmentResetGuard on selective reset callables', () => {
    expect(source).not.toContain('assertDevelopmentResetAllowedForFunctions')
    expect(source).not.toContain('developmentResetGuard')
  })

  it('uses pre-opening eligibility and storeId confirm', () => {
    expect(source).toContain('assertPreOpeningResetAllowed')
    expect(source).toContain('matchesStoreIdConfirmText')
    expect(source).toContain('writeResetLockState')
    expect(meterExecute).toContain('店舗IDを完全一致で入力してください')
  })

  it('restricts callable access to owner and hq_admin', () => {
    expect(source).toContain("role !== 'owner' && role !== 'hq_admin'")
  })

  it('keeps franchiseeId and storeId scope for deletions', () => {
    expect(source).toContain(".where('franchiseeId', '==', franchiseeId)")
    expect(source).toContain(".where('storeId', '==', storeId)")
    expect(source).toContain('assertScopeAuthorized')
    expect(source).toContain('他加盟店のデータは初期化できません')
  })

  it('unified execute deletes meter allowlist and calls reservation-v4', () => {
    expect(meterExecute).toContain('deleteFirestoreScopedData')
    expect(meterExecute).toContain('executeReservationReset')
    expect(meterExecute).toContain("resetScope: 'reservations'")
    expect(meterCapability).toContain('secrets: [reservationV4AdminToken]')
  })

  it('protects accounting storage and never deletes unknown collections', () => {
    expect(source).toContain('buildAllowlistedStoragePrefixes')
    expect(source).toContain('isProtectedStoragePath')
    expect(source).toContain('isAllowlistedScopedCollection')
    expect(source).not.toMatch(/`accounting\/\$\{franchiseeId\}\/\$\{storeId\}\/`/)
  })

  it('re-run safely completes with zero remaining deletes loops', () => {
    expect(source).toContain('if (snapshot.empty)')
    expect(source).toContain('return deletedCount')
    expect(source).toContain('while (true)')
  })
})

describe('development full reset isolation remains intact', () => {
  it('developmentResetGuard still blocks production project', () => {
    const guard = readSource('functions/src/developmentResetGuard.ts')
    expect(guard).toContain("PRODUCTION_FIREBASE_PROJECT_IDS = ['care-taxi-meter']")
    expect(guard).toContain('assertDevelopmentResetAllowedForFunctions')
  })

  it('developmentReset service still imports/uses the guard', () => {
    const source = readSource('src/services/developmentReset.ts')
    expect(source).toContain('assertDevelopmentResetAllowed')
    expect(source).toContain('developmentResetGuard')
  })

  it('HQ keeps development reset UI gated separately from selective reset', () => {
    const source = readSource('src/pages/HeadquartersPage.tsx')
    expect(source).toContain('showDevelopmentResetUi')
    expect(source).toContain('開発データリセット（開発環境のみ）')
    expect(source).toContain('開業前データリセット')
    expect(source).toContain('isPreOpeningCompanyStatus')
  })
})

describe('PreOpeningDataResetPanel', () => {
  const source = readSource('src/components/admin/PreOpeningDataResetPanel.tsx')

  it('shows required summary table and storeId confirm with preview gate', () => {
    expect(source).toContain('売上・運行')
    expect(source).toContain('予約・顧客')
    expect(source).toContain('勤怠実績')
    expect(source).toContain('経理')
    expect(source).toContain('加盟店・店舗')
    expect(source).toContain('スタッフ')
    expect(source).toContain('予約時間ブロック')
    expect(source).toContain('料金・車両・設定')
    expect(source).toContain('matchesStoreIdConfirmText')
    expect(source).toContain('previewLoaded')
    expect(source).toContain('件数プレビュー')
  })
})

describe('driver-proxy does not expose admin reset routes in driver routing', () => {
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
