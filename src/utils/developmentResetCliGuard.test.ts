import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertCliDevelopmentResetAllowed,
  evaluateDevelopmentResetGuard,
  isProductionFirebaseProjectId,
} from '../../scripts/lib/developmentResetGuard.mjs'

const repoRoot = join(__dirname, '../..')

describe('CLI developmentResetGuard', () => {
  it('rejects production project with non-zero style throw', () => {
    expect(() =>
      assertCliDevelopmentResetAllowed({
        FIREBASE_PROJECT_ID: 'care-taxi-meter',
        DEV_RESET_ENABLED: 'true',
        DEV_RESET_ALLOWED_PROJECT_IDS: 'care-taxi-meter',
        CONFIRM_RESET_DEVELOPMENT_DATA: 'RESET-DEV-DATA:care-taxi-meter',
        CI: '',
      }),
    ).toThrow(/本番/)
  })

  it('rejects when only weak legacy confirm is set', () => {
    expect(() =>
      assertCliDevelopmentResetAllowed({
        FIREBASE_PROJECT_ID: 'care-taxi-meter-dev',
        DEV_RESET_ENABLED: 'true',
        DEV_RESET_ALLOWED_PROJECT_IDS: 'care-taxi-meter-dev',
        CONFIRM_RESET_DEVELOPMENT_DATA: 'delete-dev-data',
        CI: '',
      }),
    ).toThrow(/確認文字列/)
  })

  it('rejects CI even for allowlisted project', () => {
    expect(() =>
      assertCliDevelopmentResetAllowed({
        FIREBASE_PROJECT_ID: 'care-taxi-meter-dev',
        DEV_RESET_ENABLED: 'true',
        DEV_RESET_ALLOWED_PROJECT_IDS: 'care-taxi-meter-dev',
        CONFIRM_RESET_DEVELOPMENT_DATA: 'RESET-DEV-DATA:care-taxi-meter-dev',
        CI: 'true',
      }),
    ).toThrow(/CI/)
  })

  it('allows dedicated dev project with full env', () => {
    const projectId = assertCliDevelopmentResetAllowed({
      FIREBASE_PROJECT_ID: 'care-taxi-meter-dev',
      DEV_RESET_ENABLED: 'true',
      DEV_RESET_ALLOWED_PROJECT_IDS: 'care-taxi-meter-dev',
      CONFIRM_RESET_DEVELOPMENT_DATA: 'RESET-DEV-DATA:care-taxi-meter-dev',
      CI: '',
    })
    expect(projectId).toBe('care-taxi-meter-dev')
  })

  it('mirrors client production deny', () => {
    expect(isProductionFirebaseProjectId('care-taxi-meter')).toBe(true)
    expect(
      evaluateDevelopmentResetGuard({
        projectId: 'care-taxi-meter',
        enabled: true,
        allowedProjectIds: ['care-taxi-meter'],
      }).allowed,
    ).toBe(false)
  })
})

describe('functions developmentResetGuard mirror', () => {
  it('rejects production without relying on client', async () => {
    const mod = await import('../../functions/src/developmentResetGuard')
    const keys = [
      'DEV_RESET_ENABLED',
      'DEV_RESET_ALLOWED_PROJECT_IDS',
      'GCLOUD_PROJECT',
      'GCP_PROJECT',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CONFIG',
      'CI',
    ] as const
    const previous: Record<string, string | undefined> = {}
    for (const key of keys) {
      previous[key] = process.env[key]
    }
    try {
      process.env.DEV_RESET_ENABLED = 'true'
      process.env.DEV_RESET_ALLOWED_PROJECT_IDS = 'care-taxi-meter'
      process.env.GCLOUD_PROJECT = 'care-taxi-meter'
      delete process.env.GCP_PROJECT
      delete process.env.FIREBASE_PROJECT_ID
      delete process.env.FIREBASE_CONFIG
      process.env.CI = ''
      expect(() => mod.assertDevelopmentResetAllowedForFunctions()).toThrow(/本番/)
    } finally {
      for (const key of keys) {
        const value = previous[key]
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })
})

describe('StaffManagementPanel password field', () => {
  it('uses empty new-password field rather than binding stored password as display value label', () => {
    const text = readFileSync(join(repoRoot, 'src/components/admin/StaffManagementPanel.tsx'), 'utf8')
    expect(text).toContain('新しいパスワード')
    expect(text).toContain('autoComplete="new-password"')
    expect(text).toContain('変更する場合のみ入力')
    expect(text).not.toMatch(/placeholder=\{[^}]*password/)
  })
})

describe('HeadquartersPage production reset UI gate source', () => {
  it('gates reset button behind isDevelopmentResetUiAllowed / showDevelopmentResetUi', () => {
    const text = readFileSync(join(repoRoot, 'src/pages/HeadquartersPage.tsx'), 'utf8')
    expect(text).toContain('showDevelopmentResetUi')
    expect(text).toContain('isDevelopmentResetUiAllowed')
    expect(text).toMatch(/showDevelopmentResetUi\s*\?\s*\(/)
    expect(text).not.toMatch(/onClick=\{handleDevelopmentDataReset\}>開発データリセット/)
  })
})
