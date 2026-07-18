import { HttpsError } from 'firebase-functions/v2/https'

/**
 * Auth V2 feature flags.
 * Production defaults: both false (existing loginStaff remains the live path).
 * Never set AUTH_V2_ENFORCE=true without an explicit cutover approval.
 */
export const AUTH_V2_ENABLED = process.env.AUTH_V2_ENABLED === 'true'
export const AUTH_V2_ENFORCE = process.env.AUTH_V2_ENFORCE === 'true'

export const MAX_LOGIN_FAILURES = Number.parseInt(process.env.AUTH_MAX_LOGIN_FAILURES || '5', 10) || 5
export const LOGIN_LOCK_MINUTES = Number.parseInt(process.env.AUTH_LOGIN_LOCK_MINUTES || '15', 10) || 15

export const AUTH_FAILURE_MESSAGE_V2 =
  '会社ID、ユーザーIDまたはパスワードが正しくありません。'
export const LOGIN_LOCK_MESSAGE = 'しばらくしてから再度お試しください。'
export const AUTH_V2_DISABLED_MESSAGE = '新しい認証方式は現在無効です。'

export function assertAuthV2Enabled() {
  if (!AUTH_V2_ENABLED) {
    throw new HttpsError('failed-precondition', AUTH_V2_DISABLED_MESSAGE)
  }
}

export function getAuthV2RuntimeFlags() {
  return {
    AUTH_V2_ENABLED,
    AUTH_V2_ENFORCE,
    MAX_LOGIN_FAILURES,
    LOGIN_LOCK_MINUTES,
  }
}
