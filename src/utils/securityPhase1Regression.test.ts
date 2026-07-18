import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  buildStaffAdminPayload,
  redactAuthSensitiveFields,
  stripStaffPasswordForClient,
} from '../services/staffMembers'
import type { StaffMember } from '../types/work'

const repoRoot = join(__dirname, '../..')

const baseStaff = (overrides: Partial<StaffMember> = {}): StaffMember => ({
  id: 'staff-1',
  companyId: 'fc-1',
  franchiseeId: 'fc-1',
  storeId: 'store-1',
  storeName: '本店',
  userId: 'driver1',
  loginId: 'driver1',
  password: '',
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

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-test-no-config') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkSourceFiles(full, out)
      continue
    }
    if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('staff password omit / redact', () => {
  it('omits password from update payload when blank', () => {
    const payload = buildStaffAdminPayload(baseStaff({ password: '', name: '更新名' }), {
      includePassword: false,
    })
    expect(payload).not.toHaveProperty('password')
    expect(payload.name).toBe('更新名')
  })

  it('includes password only when includePassword and non-empty', () => {
    const without = buildStaffAdminPayload(baseStaff({ password: 'NewPassw0rd12' }), {
      includePassword: false,
    })
    expect(without).not.toHaveProperty('password')

    const withPassword = buildStaffAdminPayload(baseStaff({ password: 'NewPassw0rd12' }), {
      includePassword: true,
    })
    expect(withPassword).toHaveProperty('password', 'NewPassw0rd12')
  })

  it('strips password for client hydration', () => {
    const stripped = stripStaffPasswordForClient(baseStaff({ password: 'should-not-leak' }))
    expect(stripped.password).toBe('')
  })

  it('redacts password-like fields for console logs', () => {
    const redacted = redactAuthSensitiveFields({
      operation: 'update',
      password: 'secret-value',
      customToken: 'token-value',
      nested: { representativeInitialPassword: 'x', ok: 1 },
    }) as Record<string, unknown>
    expect(redacted.password).toBe('[redacted]')
    expect(redacted.customToken).toBe('[redacted]')
    expect((redacted.nested as Record<string, unknown>).representativeInitialPassword).toBe(
      '[redacted]',
    )
    expect((redacted.nested as Record<string, unknown>).ok).toBe(1)
  })
})

describe('fixed bootstrap credentials removed from client source', () => {
  it('does not define defaultAdminStaffPassword or ensureDefaultAdmin helpers', () => {
    const forbiddenIdentifiers = [
      'defaultAdminStaffPassword',
      'ensureDefaultAdminStaffMember',
      'migrateLegacySuperAdminStaffMembers',
    ]
    const roots = [join(repoRoot, 'src'), join(repoRoot, 'scripts'), join(repoRoot, 'functions', 'src')]
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of walkSourceFiles(root)) {
        const text = readFileSync(file, 'utf8')
        for (const id of forbiddenIdentifiers) {
          if (text.includes(id)) {
            offenders.push(`${relative(repoRoot, file)}:${id}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('reset scripts do not embed a short numeric-only bootstrap password literal', () => {
    const resetFiles = [
      join(repoRoot, 'scripts', 'resetDevelopmentData.mjs'),
      join(repoRoot, 'src', 'services', 'developmentReset.ts'),
    ]
    for (const file of resetFiles) {
      const text = readFileSync(file, 'utf8')
      expect(text).not.toMatch(/DEFAULT_ADMIN_PASSWORD\s*=\s*['"]\d{3,}['"]/)
      expect(text).not.toMatch(/defaultAdminStaffPassword/)
      expect(text).toMatch(/bootstrapAdminPassword|ADMIN_BOOTSTRAP_PASSWORD/)
    }
  })
})

describe('git-tracked artifact policy', () => {
  it('does not track known build dump paths', async () => {
    const { execFileSync } = await import('node:child_process')
    const listed = execFileSync(
      'git',
      ['ls-files', 'dist-test-no-config', 'build-log.txt', 'build-output.txt'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim()
    expect(listed).toBe('')
  })
})

describe('console redaction on save failure path', () => {
  it('warn payload must not retain raw password when redacted helper is used', () => {
    const warn = vi.fn()
    const original = console.warn
    console.warn = warn
    try {
      console.warn(
        '[StaffManagement] save failed',
        redactAuthSensitiveFields({
          password: 'must-not-appear',
          staffId: 'staff-1',
        }),
      )
    } finally {
      console.warn = original
    }
    const serialized = JSON.stringify(warn.mock.calls)
    expect(serialized).not.toContain('must-not-appear')
    expect(serialized).toContain('[redacted]')
  })
})
