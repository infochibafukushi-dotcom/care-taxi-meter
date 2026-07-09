import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const readSource = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), 'utf8')

describe('reservationPreOpeningReset frontend service', () => {
  it('does not call reservation-v4 admin APIs directly from the browser', () => {
    const source = readSource('src/services/reservationPreOpeningReset.ts')
    expect(source).not.toMatch(/\/api\/admin\/reservations\/pre-opening-reset/)
    expect(source).not.toMatch(/admin_token|adminToken|RESERVATION_V4_ADMIN_TOKEN/i)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).toContain("httpsCallable")
    expect(source).toContain('getPreOpeningResetCapability')
    expect(source).toContain('getPreOpeningReservationResetCapability')
    expect(source).toContain('executePreOpeningDataReset')
    expect(source).toContain('executePreOpeningReservationReset')
  })
})

describe('preOpeningDataReset cloud function', () => {
  it('uses server-side admin bearer token for reservation-v4', () => {
    const source = readSource('functions/src/preOpeningDataReset.ts')
    expect(source).toContain('RESERVATION_V4_ADMIN_TOKEN')
    expect(source).toContain('RESERVATION_V4_ORIGIN')
    expect(source).toContain("Authorization: `Bearer ${token}`")
    expect(source).toContain('/api/admin/reservations/pre-opening-reset/capability')
    expect(source).toContain('/api/admin/reservations/pre-opening-reset')
    expect(source).toContain('scope=${resetScope}')
    expect(source).toContain("scope: resetScope")
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('deletes reservation data before firestore in full reset', () => {
    const source = readSource('functions/src/preOpeningDataReset.ts')
    const executeIndex = source.indexOf('export const executePreOpeningDataReset')
    const executeBody = source.slice(executeIndex)
    const reservationIndex = executeBody.indexOf('executeReservationReset')
    const firestoreIndex = executeBody.indexOf('deleteFirestoreScopedData')
    expect(reservationIndex).toBeGreaterThan(-1)
    expect(firestoreIndex).toBeGreaterThan(-1)
    expect(reservationIndex).toBeLessThan(firestoreIndex)
  })

  it('exposes reservation-only reset callables', () => {
    const source = readSource('functions/src/preOpeningDataReset.ts')
    expect(source).toContain('getPreOpeningReservationResetCapability')
    expect(source).toContain('executePreOpeningReservationReset')
    expect(source).toContain("resetScope: 'reservations'")
  })

  it('deletes scoped log collections in cloud function', () => {
    const source = readSource('functions/src/preOpeningDataReset.ts')
    expect(source).toContain("'auditLogs'")
    expect(source).toContain("'maintenanceLogs'")
    expect(source).toContain("'adminActionLogs'")
    expect(source).toContain("'loginAttempts'")
    expect(source).toContain("'operationLogs'")
    expect(source).toContain("'debugLogs'")
    expect(source).toContain("'errorLogs'")
    expect(source).toContain("'resetLogs'")
    expect(source).not.toContain('deleteUser')
    expect(source).not.toContain("deleteCollectionByScope('staffMembers'")
  })

  it('restricts callable access to owner and hq_admin', () => {
    const source = readSource('functions/src/preOpeningDataReset.ts')
    expect(source).toContain("role !== 'owner' && role !== 'hq_admin'")
    expect(source).toContain("confirmText !== PRE_OPENING_RESET_CONFIRM_TEXT")
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
