/**
 * Pure helpers for Auth V2 login fallback policy (unit-tested).
 * Wrong password must never fall back to legacy loginStaff.
 */
export function isLegacyFallbackAllowed({
  enforce,
  authFallbackDetail,
  errorCode,
}: {
  enforce: boolean
  authFallbackDetail?: boolean
  errorCode?: string
}): boolean {
  if (enforce) {
    return false
  }
  if (authFallbackDetail === false) {
    return false
  }
  if (authFallbackDetail === true) {
    return true
  }

  const code = errorCode || ''
  if (
    code.includes('unauthenticated') ||
    code.includes('permission-denied') ||
    code.includes('resource-exhausted')
  ) {
    return false
  }

  return (
    code.includes('not-found') ||
    code.includes('unavailable') ||
    code.includes('internal') ||
    code.includes('deadline-exceeded') ||
    code.includes('failed-precondition')
  )
}

export function staffPayloadOmitsPassword(payload: Record<string, unknown>) {
  return !('password' in payload) || payload.password === undefined
}
