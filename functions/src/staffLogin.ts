import { HttpsError, onCall } from 'firebase-functions/v2/https'

/**
 * Phase3B: legacy plaintext loginStaff is retired.
 * Kept as a safe reject stub so old clients get a clear upgrade message
 * instead of accidentally authenticating via plaintext fields.
 */
const LEGACY_LOGIN_RETIRED_MESSAGE =
  'このアプリは新しい認証方式への更新が必要です。'

export const loginStaff = onCall({ region: 'asia-northeast1' }, async () => {
  throw new HttpsError('failed-precondition', LEGACY_LOGIN_RETIRED_MESSAGE, {
    authFallback: false,
    legacyLoginRetired: true,
  })
})
