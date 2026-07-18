import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import { AUTH_V2_ENABLED } from '../config/authFlags'
import type { StaffMember } from '../types/work'

const functionsRegion = 'asia-northeast1'

type StaffCredentialUpsertResponse = {
  updated: boolean
  reason?: 'password_unchanged'
  credentialId?: string
}

type SaveStaffMemberProfileResponse = {
  saved: boolean
  staffId: string
  passwordUpdated: boolean
  claims?: Record<string, unknown>
}

/**
 * Functions-mediated credential / claims / profile updates.
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

export async function disableStaffAuthViaFunctions(staffId: string) {
  if (!AUTH_V2_ENABLED) {
    return null
  }
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<{ staffId: string }, { disabled: boolean }>(
    functions,
    'disableStaffAuth',
  )
  const response = await callable({ staffId })
  return response.data
}

/** Phase3A: staff create/update goes through Functions (no client password writes). */
export async function saveStaffMemberProfileViaFunctions({
  staffMember,
  password,
}: {
  staffMember: StaffMember
  password: string
}): Promise<SaveStaffMemberProfileResponse> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    { staffMember: Omit<StaffMember, 'password'>; password: string },
    SaveStaffMemberProfileResponse
  >(functions, 'saveStaffMemberProfile')

  const { password: _ignored, ...profile } = staffMember
  const response = await callable({
    staffMember: profile,
    password: password.trim(),
  })
  return response.data
}
