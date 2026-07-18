export type CompanyLoginGate = {
  enabled: boolean
  status?: string
}

export const AUTH_FAILURE_MESSAGE_V2 =
  '会社ID、ユーザーIDまたはパスワードが正しくありません。'

export function isCompanyLoginAllowed(company: CompanyLoginGate | null | undefined): boolean {
  if (!company) {
    return false
  }
  if (company.enabled === false) {
    return false
  }
  const status = (company.status || 'active').toLowerCase()
  if (status === 'suspended' || status === 'terminated' || status === 'archived' || status === 'ending') {
    return false
  }
  return true
}

export function shouldLockAfterFailures(failureCount: number, maxFailures: number) {
  return failureCount >= maxFailures
}

export function computeLockedUntilMs(nowMs: number, lockMinutes: number) {
  return nowMs + lockMinutes * 60 * 1000
}

export function isLockedUntil(lockedUntilMs: number | null | undefined, nowMs: number) {
  return typeof lockedUntilMs === 'number' && lockedUntilMs > nowMs
}

/** Same generic failure for missing company, missing user, or bad password. */
export function buildGenericAuthFailureMessage() {
  return AUTH_FAILURE_MESSAGE_V2
}

export function assertResponseHasNoSecrets(payload: Record<string, unknown>) {
  const forbidden = ['password', 'passwordHash', 'passwordSalt', 'salt', 'hash']
  for (const key of forbidden) {
    if (key in payload && payload[key] != null && payload[key] !== '') {
      return false
    }
  }
  return true
}
