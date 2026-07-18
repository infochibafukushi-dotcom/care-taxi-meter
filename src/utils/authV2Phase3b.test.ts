import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldFallbackToLegacyLogin } from '../services/firebaseAuth'
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

describe('Auth V2 phase3B legacy retirement', () => {
  it('never falls back to legacy loginStaff', () => {
    expect(shouldFallbackToLegacyLogin(new Error('unavailable'))).toBe(false)
    expect(shouldFallbackToLegacyLogin({ code: 'functions/unavailable' })).toBe(false)
  })

  it('loginStaff is a reject-only stub', () => {
    const staffLogin = readFileSync(join(repoRoot, 'functions/src/staffLogin.ts'), 'utf8')
    expect(staffLogin).toContain('このアプリは新しい認証方式への更新が必要です。')
    expect(staffLogin).toContain('legacyLoginRetired')
    expect(staffLogin).not.toContain('representativeInitialPassword')
    expect(staffLogin).not.toContain('getRepresentativePassword')
    expect(staffLogin).not.toContain('toPasswordValue')
  })

  it('client auth uses loginStaffV2 only', () => {
    const source = readFileSync(join(repoRoot, 'src/services/firebaseAuth.ts'), 'utf8')
    expect(source).toContain("loginStaffV2")
    expect(source).not.toContain("callLoginCallable('loginStaff'")
    expect(source).not.toContain('signInViaLegacyLoginStaff')
    expect(source).toContain('shouldFallbackToLegacyLogin')
  })

  it('rules fully reject plaintext auth field keys', () => {
    const rules = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8')
    expect(rules).toContain("!('password' in request.resource.data)")
    expect(rules).toContain("!('representativeInitialPassword' in request.resource.data)")
    expect(rules).toContain("!('ownerPassword' in request.resource.data)")
    expect(rules).toContain("!('initialPassword' in request.resource.data)")
    expect(rules).toContain('match /staffCredentials/{credentialId}')
    expect(rules).toContain('allow read, create, update, delete: if false')
  })

  it('company type and save omit plaintext password fields', () => {
    const types = readFileSync(join(repoRoot, 'src/types/work.ts'), 'utf8')
    expect(types).not.toContain('representativeInitialPassword')
    const companies = readFileSync(join(repoRoot, 'src/services/companies.ts'), 'utf8')
    expect(companies).toContain('representativeInitialPassword: _a')
    expect(companies).not.toMatch(/representativeInitialPassword:\s*toString/)
  })

  it('staff admin payload never includes password unless explicitly requested', () => {
    expect(buildStaffAdminPayload(baseStaff(), { includePassword: false })).not.toHaveProperty(
      'password',
    )
  })

  it('delete script requires confirm string', () => {
    const script = readFileSync(join(repoRoot, 'scripts/deleteLegacyPlaintextAuth.mjs'), 'utf8')
    expect(script).toContain('DELETE-LEGACY-PLAINTEXT-AUTH-4')
    expect(script).toContain('Never prints password')
  })
})
