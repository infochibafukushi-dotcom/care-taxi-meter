import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_FIREBASE_PROJECT_IDS,
  assertDevelopmentResetAllowed,
  buildDevelopmentResetConfirmText,
  evaluateDevelopmentResetGuard,
  isDevelopmentResetUiAllowed,
  matchesDevelopmentResetConfirmText,
  readClientDevelopmentResetConfig,
  validateBootstrapAdminPassword,
} from './developmentResetGuard'

describe('developmentResetGuard (fail-closed)', () => {
  const allowedDev = 'care-taxi-meter-dev'

  it('rejects production project id', () => {
    const decision = evaluateDevelopmentResetGuard({
      projectId: PRODUCTION_FIREBASE_PROJECT_IDS[0],
      enabled: true,
      allowedProjectIds: [PRODUCTION_FIREBASE_PROJECT_IDS[0], allowedDev],
    })
    expect(decision.allowed).toBe(false)
  })

  it('rejects unknown project id', () => {
    const decision = evaluateDevelopmentResetGuard({
      projectId: 'totally-unknown-project',
      enabled: true,
      allowedProjectIds: [allowedDev],
    })
    expect(decision.allowed).toBe(false)
  })

  it('rejects project not on allowlist', () => {
    const decision = evaluateDevelopmentResetGuard({
      projectId: 'other-dev-project',
      enabled: true,
      allowedProjectIds: [allowedDev],
    })
    expect(decision.allowed).toBe(false)
  })

  it('rejects when enabled flag is missing/false', () => {
    expect(
      evaluateDevelopmentResetGuard({
        projectId: allowedDev,
        enabled: false,
        allowedProjectIds: [allowedDev],
      }).allowed,
    ).toBe(false)
    expect(
      evaluateDevelopmentResetGuard({
        projectId: allowedDev,
        allowedProjectIds: [allowedDev],
      }).allowed,
    ).toBe(false)
  })

  it('rejects empty allowlist', () => {
    expect(
      evaluateDevelopmentResetGuard({
        projectId: allowedDev,
        enabled: true,
        allowedProjectIds: '',
      }).allowed,
    ).toBe(false)
  })

  it('rejects CI', () => {
    expect(
      evaluateDevelopmentResetGuard({
        projectId: allowedDev,
        enabled: true,
        allowedProjectIds: [allowedDev],
        isCi: true,
      }).allowed,
    ).toBe(false)
  })

  it('allows only enabled + allowlisted non-production project', () => {
    const decision = evaluateDevelopmentResetGuard({
      projectId: allowedDev,
      enabled: true,
      allowedProjectIds: [allowedDev],
    })
    expect(decision).toEqual({ allowed: true, projectId: allowedDev })
    expect(isDevelopmentResetUiAllowed({
      projectId: allowedDev,
      enabled: true,
      allowedProjectIds: allowedDev,
    })).toBe(true)
  })

  it('emulator still requires enabled + allowlist', () => {
    expect(
      evaluateDevelopmentResetGuard({
        projectId: allowedDev,
        enabled: false,
        allowedProjectIds: [allowedDev],
        isEmulator: true,
      }).allowed,
    ).toBe(false)
    expect(
      evaluateDevelopmentResetGuard({
        projectId: allowedDev,
        enabled: true,
        allowedProjectIds: [allowedDev],
        isEmulator: true,
      }).allowed,
    ).toBe(true)
  })

  it('assert throws on production', () => {
    expect(() =>
      assertDevelopmentResetAllowed({
        projectId: 'care-taxi-meter',
        enabled: true,
        allowedProjectIds: ['care-taxi-meter'],
      }),
    ).toThrow(/本番/)
  })

  it('confirm text must match project id exactly', () => {
    const expected = buildDevelopmentResetConfirmText(allowedDev)
    expect(expected).toBe(`RESET-DEV-DATA:${allowedDev}`)
    expect(matchesDevelopmentResetConfirmText(expected, allowedDev)).toBe(true)
    expect(matchesDevelopmentResetConfirmText('RESET', allowedDev)).toBe(false)
    expect(matchesDevelopmentResetConfirmText(`RESET-DEV-DATA:other`, allowedDev)).toBe(false)
  })

  it('bootstrap password strength', () => {
    expect(validateBootstrapAdminPassword('short').ok).toBe(false)
    expect(validateBootstrapAdminPassword('onlylettersxxxx').ok).toBe(false)
    expect(validateBootstrapAdminPassword('123456789012').ok).toBe(false)
    expect(validateBootstrapAdminPassword('DevPassw0rd!!').ok).toBe(true)
  })

  it('production Pages-like env leaves reset disabled', () => {
    const config = readClientDevelopmentResetConfig({
      DEV: false,
      MODE: 'production',
      VITE_FIREBASE_PROJECT_ID: 'care-taxi-meter',
      VITE_DEV_RESET_ENABLED: undefined,
      VITE_DEV_RESET_ALLOWED_PROJECT_IDS: undefined,
    })
    expect(config.enabled).toBe(false)
    expect(
      isDevelopmentResetUiAllowed({
        projectId: config.projectId,
        enabled: config.enabled,
        allowedProjectIds: config.allowedProjectIds,
      }),
    ).toBe(false)
  })
})
