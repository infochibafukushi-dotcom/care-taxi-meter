import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTH_FAILURE_MESSAGE_V2,
  assertResponseHasNoSecrets,
  buildGenericAuthFailureMessage,
  computeLockedUntilMs,
  isCompanyLoginAllowed,
  isLockedUntil,
  shouldLockAfterFailures,
} from '../../functions/src/authPolicy'
import { hashPassword, redactAuthSecrets, verifyPassword } from '../../functions/src/passwordCrypto'
import { buildStaffCustomClaims, claimsMatchStaffRole } from '../../functions/src/staffClaims'
import { AUTH_V2_RULES_PHASE1_DEPLOYED } from './authV2RulesPlan'
import { getClientAuthFlags } from '../config/authFlags'

const repoRoot = join(__dirname, '../..')

describe('passwordCrypto scrypt', () => {
  it('accepts the correct password and rejects a wrong password', async () => {
    const record = await hashPassword('CorrectHorseBattery1')
    expect(record.hashAlgorithm).toBe('scrypt')
    expect(record.passwordSalt.length).toBeGreaterThan(8)
    expect(await verifyPassword('CorrectHorseBattery1', record)).toBe(true)
    expect(await verifyPassword('wrong-password', record)).toBe(false)
  })

  it('uses a unique salt per hash', async () => {
    const first = await hashPassword('SamePassword99')
    const second = await hashPassword('SamePassword99')
    expect(first.passwordSalt).not.toBe(second.passwordSalt)
    expect(first.passwordHash).not.toBe(second.passwordHash)
  })
})

describe('loginStaffV2 auth policy', () => {
  it('uses the same generic error for unknown company/user/password', () => {
    expect(buildGenericAuthFailureMessage()).toBe(AUTH_FAILURE_MESSAGE_V2)
    expect(AUTH_FAILURE_MESSAGE_V2).toContain('会社ID')
  })

  it('rejects suspended/disabled companies', () => {
    expect(isCompanyLoginAllowed({ enabled: true, status: 'active' })).toBe(true)
    expect(isCompanyLoginAllowed({ enabled: false, status: 'active' })).toBe(false)
    expect(isCompanyLoginAllowed({ enabled: true, status: 'suspended' })).toBe(false)
    expect(isCompanyLoginAllowed({ enabled: true, status: 'terminated' })).toBe(false)
    expect(isCompanyLoginAllowed(null)).toBe(false)
  })

  it('locks after 5 failures for 15 minutes and clears on success path math', () => {
    expect(shouldLockAfterFailures(4, 5)).toBe(false)
    expect(shouldLockAfterFailures(5, 5)).toBe(true)
    const now = Date.parse('2026-07-18T00:00:00Z')
    const lockedUntil = computeLockedUntilMs(now, 15)
    expect(isLockedUntil(lockedUntil, now + 14 * 60 * 1000)).toBe(true)
    expect(isLockedUntil(lockedUntil, now + 16 * 60 * 1000)).toBe(false)
    expect(isLockedUntil(null, now)).toBe(false)
  })

  it('never returns password/hash/salt in sanitized payloads', () => {
    expect(
      assertResponseHasNoSecrets({
        customToken: 'token',
        staffMember: { id: 's1', role: 'owner' },
      }),
    ).toBe(true)
    expect(assertResponseHasNoSecrets({ password: 'x' })).toBe(false)
    expect(assertResponseHasNoSecrets({ passwordHash: 'x' })).toBe(false)
    expect(assertResponseHasNoSecrets({ passwordSalt: 'x' })).toBe(false)
  })

  it('redacts secrets from log payloads', () => {
    const redacted = redactAuthSecrets({
      password: 'secret',
      passwordHash: 'hash',
      customToken: 'token',
      staffId: 'staff_1',
    }) as Record<string, unknown>
    expect(redacted.password).toBe('[redacted]')
    expect(redacted.passwordHash).toBe('[redacted]')
    expect(redacted.customToken).toBe('[redacted]')
    expect(redacted.staffId).toBe('staff_1')
  })
})

describe('custom claims', () => {
  it('sets role/companyId/franchiseeId/storeId/staffId from staff record', () => {
    const claims = buildStaffCustomClaims({
      id: 'staff_owner_1',
      companyId: 'fc-1',
      franchiseeId: 'fc-1',
      storeId: 'store-1',
      role: 'owner',
    })
    expect(claims).toEqual({
      role: 'owner',
      companyId: 'fc-1',
      franchiseeId: 'fc-1',
      storeId: 'store-1',
      staffId: 'staff_owner_1',
    })
  })

  it('prevents driver from receiving owner claims', () => {
    expect(claimsMatchStaffRole('driver', 'owner')).toBe(false)
    expect(claimsMatchStaffRole('driver', 'driver')).toBe(true)
    expect(claimsMatchStaffRole('manager', 'owner')).toBe(false)
    expect(claimsMatchStaffRole('manager', 'manager')).toBe(true)
  })
})

describe('AUTH_V2 compatibility flags', () => {
  it('reads AUTH_V2 flags from env (defaults false in unit tests without Vite inject)', () => {
    const flags = getClientAuthFlags()
    expect(flags).toHaveProperty('AUTH_V2_ENABLED')
    expect(flags).toHaveProperty('AUTH_V2_ENFORCE')
  })

  it('defaults server authFlags source to explicit env equality checks', () => {
    const authFlagsSource = readFileSync(join(repoRoot, 'functions/src/authFlags.ts'), 'utf8')
    expect(authFlagsSource).toContain("process.env.AUTH_V2_ENABLED === 'true'")
    expect(authFlagsSource).toContain("process.env.AUTH_V2_ENFORCE === 'true'")
  })

  it('keeps existing loginStaff export and does not remove it', () => {
    const indexSource = readFileSync(join(repoRoot, 'functions/src/index.ts'), 'utf8')
    expect(indexSource).toContain("export { loginStaff } from './staffLogin'")
    expect(indexSource).toContain("export { loginStaffV2 } from './loginStaffV2'")
    const clientAuth = readFileSync(join(repoRoot, 'src/services/firebaseAuth.ts'), 'utf8')
    expect(clientAuth).toContain('loginStaffV2')
    expect(clientAuth).toContain('shouldFallbackToLegacyLogin')
    expect(clientAuth).not.toContain("callLoginCallable('loginStaff'")
  })
})

describe('staffCredentials rules and backup hygiene', () => {
  it('denies client access to staffCredentials in firestore.rules', () => {
    const rules = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8')
    expect(rules).toMatch(/match \/staffCredentials\/\{credentialId\}[\s\S]*allow read, create, update, delete: if false;/)
    expect(rules).toMatch(/match \/loginAttempts\/\{attemptId\}[\s\S]*allow read, create, update, delete: if false;/)
    expect(AUTH_V2_RULES_PHASE1_DEPLOYED.length).toBeGreaterThan(0)
  })

  it('excludes staffCredentials from lightweight backup', () => {
    const policy = readFileSync(join(repoRoot, 'src/utils/lightweightBackupPolicy.ts'), 'utf8')
    expect(policy).toContain("'staffCredentials'")
    expect(policy).toContain("'passwordSalt'")
  })

  it('does not grant admin role from URL path in AdminPage', () => {
    const adminPage = readFileSync(join(repoRoot, 'src/pages/AdminPage.tsx'), 'utf8')
    expect(adminPage).not.toContain('location.pathname.startsWith("/owner") ? "owner"')
    expect(adminPage).toContain('waitForFirebaseAuthUser')
    expect(adminPage).toContain('ログインが必要です')
  })
})

describe('regression: receipt URL hardening and accounting untouched markers', () => {
  it('keeps getAccountingReceiptAccessUrl export', () => {
    const indexSource = readFileSync(join(repoRoot, 'functions/src/index.ts'), 'utf8')
    expect(indexSource).toContain('getAccountingReceiptAccessUrl')
    expect(indexSource).toContain('runLightweightFirestoreBackup')
    expect(indexSource).toContain('executePreOpeningDataReset')
  })

  it('migration dry-run script refuses DRY_RUN=false', () => {
    const script = readFileSync(join(repoRoot, 'scripts/authV2MigrationDryRun.ts'), 'utf8')
    expect(script).toContain("process.env.DRY_RUN === 'false'")
    expect(script).toContain('Refusing to run')
    expect(script).toContain('Never prints passwords')
  })
})
