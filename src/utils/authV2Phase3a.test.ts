import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLegacyFallbackAllowed } from './authV2FallbackPolicy'
import { getClientAuthFlags } from '../config/authFlags'
import { buildStaffAdminPayload } from '../services/staffMembers'
import type { StaffMember } from '../types/work'

const repoRoot = join(__dirname, '../..')

const baseStaff = (): StaffMember => ({
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
})

describe('Auth V2 phase3A enforce', () => {
  it('blocks legacy fallback when enforce is true', () => {
    expect(
      isLegacyFallbackAllowed({
        enforce: true,
        authFallbackDetail: true,
        errorCode: 'functions/unavailable',
      }),
    ).toBe(false)
  })

  it('rules reject staff/company password mutations', () => {
    const rules = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8')
    expect(rules).toContain('rejectsStaffPasswordWrite')
    expect(rules).toContain('rejectsCompanyPasswordWrite')
    expect(rules).toContain("affectedKeys().hasAny(['password'])")
    expect(rules).toContain("'representativeInitialPassword'")
  })

  it('keeps loginStaff export but asserts legacy blocked under enforce', () => {
    const staffLogin = readFileSync(join(repoRoot, 'functions/src/staffLogin.ts'), 'utf8')
    expect(staffLogin).toContain('assertLegacyLoginAllowed')
    expect(staffLogin).toContain('export const loginStaff')
    const flags = readFileSync(join(repoRoot, 'functions/src/authFlags.ts'), 'utf8')
    expect(flags).toContain('AUTH_V2_ENFORCED_LEGACY_BLOCKED_MESSAGE')
  })

  it('client login respects ENFORCE and uses V2', () => {
    const source = readFileSync(join(repoRoot, 'src/services/firebaseAuth.ts'), 'utf8')
    expect(source).toContain('AUTH_V2_ENFORCE')
    expect(source).toContain('loginStaffV2')
    expect(source).toContain('if (AUTH_V2_ENFORCE)')
  })

  it('staff save goes through Functions profile callable', () => {
    const source = readFileSync(join(repoRoot, 'src/services/staffMembers.ts'), 'utf8')
    expect(source).toContain('saveStaffMemberProfileViaFunctions')
    expect(source).toContain('Auth V2 Functions')
    const payload = buildStaffAdminPayload(baseStaff(), { includePassword: false })
    expect(payload).not.toHaveProperty('password')
  })

  it('companies save strips plaintext password fields', () => {
    const source = readFileSync(join(repoRoot, 'src/services/companies.ts'), 'utf8')
    expect(source).toContain('representativeInitialPassword: _a')
    expect(source).toContain('never write plaintext company password')
  })

  it('saveStaffMemberProfile is exported from functions index', () => {
    const index = readFileSync(join(repoRoot, 'functions/src/index.ts'), 'utf8')
    expect(index).toContain('saveStaffMemberProfile')
  })
})

describe('authFlags phase3A defaults in source', () => {
  it('documents ENFORCE as true in example env', () => {
    const example = readFileSync(join(repoRoot, 'functions/auth-v2.env.example'), 'utf8')
    expect(example).toContain('AUTH_V2_ENFORCE=true')
    expect(example).toContain('AUTH_V2_ENABLED=true')
  })

  it('exposes ENFORCE from client env (not hard-locked false)', () => {
    // Without Vite env injection in unit tests, both are false — but source must not hard-lock.
    const source = readFileSync(join(repoRoot, 'src/config/authFlags.ts'), 'utf8')
    expect(source).not.toContain('AUTH_V2_ENFORCE: false, // hard-locked')
    expect(source).toContain('AUTH_V2_ENFORCE')
    expect(getClientAuthFlags()).toHaveProperty('AUTH_V2_ENFORCE')
  })
})
