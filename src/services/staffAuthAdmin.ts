import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import { AUTH_V2_ENABLED } from '../config/authFlags'

const functionsRegion = 'asia-northeast1'

type StaffCredentialUpsertResponse = {
  updated: boolean
  reason?: 'password_unchanged'
  credentialId?: string
}

/**
 * Prepare client wrappers for Functions-mediated credential updates.
 * No-ops when Auth V2 is disabled so existing plaintext staff save remains unchanged.
 */
export async function upsertStaffCredentialViaFunctions({
  staffId,
  password,
}: {
  staffId: string
  password: string
}): Promise<StaffCredentialUpsertResponse | null> {
  if (!AUTH_V2_ENABLED) {
    return null
  }

  // Blank password means "no change".
  if (!password.trim()) {
    return { updated: false, reason: 'password_unchanged' }
  }

  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    { staffId: string; password: string },
    StaffCredentialUpsertResponse
  >(functions, 'upsertStaffCredential')
  const response = await callable({ staffId, password })
  return response.data
}

export async function syncStaffAuthClaimsViaFunctions(staffId: string) {
  if (!AUTH_V2_ENABLED) {
    return null
  }
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<{ staffId: string }, { synced: boolean }>(
    functions,
    'syncStaffAuthClaims',
  )
  const response = await callable({ staffId })
  return response.data
}
