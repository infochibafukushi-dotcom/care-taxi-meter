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
    expect(source).toContain('executePreOpeningDataReset')
  })
})

describe('preOpeningDataReset cloud function', () => {
  it('uses server-side admin bearer token for reservation-v4', () => {
    const source = readSource('functions/src/preOpeningDataReset.ts')
    expect(source).toContain('RESERVATION_V4_ADMIN_TOKEN')
    expect(source).toContain("Authorization: `Bearer ${token}`")
    expect(source).toContain('/api/admin/reservations/pre-opening-reset/capability')
    expect(source).toContain('/api/admin/reservations/pre-opening-reset')
    expect(source).not.toMatch(/localStorage|sessionStorage/)
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

describe('driver-proxy does not expose admin reset routes', () => {
  it('only allows driver reservation routes', () => {
    const source = readSource('workers/driver-proxy/src/routing.ts')
    expect(source).not.toMatch(/pre-opening-reset/)
    expect(source).toContain('/api/driver/reservations')
  })
})
