import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLegacyFallbackAllowed, staffPayloadOmitsPassword } from './authV2FallbackPolicy'
import { buildStaffAdminPayload } from '../services/staffMembers'
import type { StaffMember } from '../types/work'
import { getClientAuthFlags } from '../config/authFlags'

const repoRoot = join(__dirname, '../..')

const baseStaff = (overrides: Partial<StaffMember> = {}): StaffMember => ({
  id: 'staff-1',
  companyId: 'fc-1',
  franchiseeId: 'fc-1',
  storeId: 'store-1',
  storeName: '本店',
  userId: 'driver1',
  loginId: 'driver1',
  password: 'NewPassw0rd12',
  name: 'テスト太郎',
  role: 'driver',
  canDrive: true,
  isActive: true,
  phoneNumber: '',
  email: '',
  address: '',
  licenseNumber: '',
  licenseExpiresAt: '',
  accidentHistory: '',
  memo: '',
  enabled: true,
  sortOrder: 1,
  ...overrides,
})

describe('Auth V2 phase2 fallback policy', () => {
  it('does not fall back on wrong password / unauthenticated', () => {
    expect(
      isLegacyFallbackAllowed({
        enforce: false,
        authFallbackDetail: false,
        errorCode: 'functions/unauthenticated',
      }),
    ).toBe(false)
    expect(
      isLegacyFallbackAllowed({
        enforce: false,
        errorCode: 'functions/unauthenticated',
      }),
    ).toBe(false)
  })

  it('falls back only for technical / not-migrated signals while ENFORCE=false', () => {
    expect(
      isLegacyFallbackAllowed({
        enforce: false,
        authFallbackDetail: true,
        errorCode: 'functions/failed-precondition',
      }),
    ).toBe(true)
    expect(
      isLegacyFallbackAllowed({
        enforce: false,
        errorCode: 'functions/unavailable',
      }),
    ).toBe(true)
    expect(
      isLegacyFallbackAllowed({
        enforce: true,
        authFallbackDetail: true,
        errorCode: 'functions/unavailable',
      }),
    ).toBe(false)
  })

  it('never falls back on lockout', () => {
    expect(
      isLegacyFallbackAllowed({
        enforce: false,
        errorCode: 'functions/resource-exhausted',
      }),
    ).toBe(false)
  })
})

describe('Auth V2 phase2 staff password writes', () => {
  it('omits password from staffMembers payload even when form has a value', () => {
    const payload = buildStaffAdminPayload(baseStaff(), { includePassword: false })
    expect(staffPayloadOmitsPassword(payload as Record<string, unknown>)).toBe(true)
    expect(payload).not.toHaveProperty('password')
  })

  it('keeps ENFORCE hard-off on client', () => {
    expect(getClientAuthFlags().AUTH_V2_ENFORCE).toBe(false)
  })

  it('migration script requires confirm string and expected count 4', () => {
    const script = readFileSync(join(repoRoot, 'scripts/migrateAuthV2Credentials.ts'), 'utf8')
    expect(script).toContain('MIGRATE-AUTH-V2-4')
    expect(script).toContain('EXPECTED_COUNT = 4')
    expect(script).toContain('plaintextFieldsPreserved')
    expect(script).not.toContain('DRY_RUN=false')
  })

  it('client login prefers V2 with limited fallback helper', () => {
    const source = readFileSync(join(repoRoot, 'src/services/firebaseAuth.ts'), 'utf8')
    expect(source).toContain('shouldFallbackToLegacyLogin')
    expect(source).toContain("falling back to loginStaff (technical / not-migrated only)")
    expect(source).toContain('loginStaffV2')
  })

  it('saveStaffMember stops writing password field', () => {
    const source = readFileSync(join(repoRoot, 'src/services/staffMembers.ts'), 'utf8')
    expect(source).toContain('includePassword: false')
    expect(source).toContain('upsertStaffCredentialViaFunctions')
    expect(source).toContain('never write plaintext password')
  })
})
