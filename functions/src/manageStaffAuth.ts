import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { assertAuthV2Enabled } from './authFlags'
import { redactAuthSecrets } from './passwordCrypto'
import {
  normalizeLoginIdentifier,
  updateStaffCredentialClaimsFields,
  upsertStaffCredentialPassword,
} from './staffCredentials'
import { buildStaffCustomClaims } from './staffClaims'

type StaffRole = 'driver' | 'manager' | 'owner' | 'hq_admin'

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback

const toRole = (value: unknown): StaffRole => {
  if (value === 'superAdmin' || value === 'hq_admin') return 'hq_admin'
  if (value === 'owner' || value === 'manager' || value === 'driver') return value
  return 'driver'
}

const requireCallerClaims = (request: { auth?: { token?: Record<string, unknown>; uid?: string } }) => {
  if (!request.auth?.token) {
    throw new HttpsError('unauthenticated', '認証が必要です。')
  }
  const token = request.auth.token
  const role = toRole(token.role)
  const franchiseeId = toStringValue(token.franchiseeId) || toStringValue(token.companyId)
  const storeId = toStringValue(token.storeId)
  const staffId = toStringValue(token.staffId) || toStringValue(request.auth.uid)
  return { role, franchiseeId, storeId, staffId, uid: request.auth.uid || staffId }
}

const assertCanManageStaff = (
  caller: ReturnType<typeof requireCallerClaims>,
  target: { companyId: string; storeId: string; role: StaffRole },
) => {
  if (caller.role === 'hq_admin') {
    return
  }
  if (caller.role === 'owner') {
    if (caller.franchiseeId !== target.companyId) {
      throw new HttpsError('permission-denied', '他社のスタッフは操作できません。')
    }
    if (target.role === 'hq_admin') {
      throw new HttpsError('permission-denied', '本部管理者は操作できません。')
    }
    return
  }
  if (caller.role === 'manager') {
    if (caller.franchiseeId !== target.companyId || caller.storeId !== target.storeId) {
      throw new HttpsError('permission-denied', '他店舗のスタッフは操作できません。')
    }
    if (target.role === 'owner' || target.role === 'hq_admin') {
      throw new HttpsError('permission-denied', 'このロールは操作できません。')
    }
    return
  }
  throw new HttpsError('permission-denied', 'スタッフ管理権限がありません。')
}

async function loadStaffMember(staffId: string) {
  const snapshot = await getFirestore().collection('staffMembers').doc(staffId).get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'スタッフが見つかりません。')
  }
  const data = snapshot.data() || {}
  const companyId = toStringValue(data.franchiseeId) || toStringValue(data.companyId)
  return {
    id: toStringValue(data.id) || snapshot.id,
    companyId,
    franchiseeId: companyId,
    storeId: toStringValue(data.storeId),
    storeName: toStringValue(data.storeName),
    userId: toStringValue(data.userId),
    loginId: toStringValue(data.loginId) || toStringValue(data.userId),
    name: toStringValue(data.name) || '名称未設定のスタッフ',
    role: toRole(data.role),
    enabled: toBooleanValue(data.enabled ?? data.isActive),
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
  }
}

async function syncAuthClaimsForStaff(staffId: string) {
  const staffMember = await loadStaffMember(staffId)
  const claims = buildStaffCustomClaims(staffMember)
  const auth = getAuth()

  try {
    await auth.getUser(staffId)
    await auth.setCustomUserClaims(staffId, claims)
    if (!staffMember.enabled) {
      await auth.updateUser(staffId, { disabled: true })
    } else {
      await auth.updateUser(staffId, { disabled: false })
    }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'auth/user-not-found') {
      // Claims sync is a no-op until the user first logs in via V2.
      return { synced: false as const, claims }
    }
    throw error
  }

  await updateStaffCredentialClaimsFields({
    staffId,
    companyId: staffMember.companyId,
    franchiseeId: staffMember.franchiseeId,
    storeId: staffMember.storeId,
    normalizedUserId: normalizeLoginIdentifier(staffMember.loginId || staffMember.userId),
  })

  return { synced: true as const, claims }
}

/**
 * Prepare staff credential + claims management via Functions.
 * Active only when AUTH_V2_ENABLED=true. Does not remove staffMembers.password.
 */
export const upsertStaffCredential = onCall({ region: 'asia-northeast1' }, async (request) => {
  assertAuthV2Enabled()
  const caller = requireCallerClaims(request)

  const staffId = String(request.data?.staffId || '').trim()
  const password = typeof request.data?.password === 'string' ? request.data.password.trim() : ''

  if (!staffId) {
    throw new HttpsError('invalid-argument', 'staffId が必要です。')
  }
  // Blank password means "no change" — never clear or rewrite credentials.
  if (!password) {
    return { updated: false, reason: 'password_unchanged' as const }
  }

  const staffMember = await loadStaffMember(staffId)
  assertCanManageStaff(caller, {
    companyId: staffMember.companyId,
    storeId: staffMember.storeId,
    role: staffMember.role,
  })

  const normalizedUserId = normalizeLoginIdentifier(staffMember.loginId || staffMember.userId)
  if (!normalizedUserId) {
    throw new HttpsError('failed-precondition', 'ログインIDが未設定です。')
  }

  const result = await upsertStaffCredentialPassword({
    staffId: staffMember.id,
    companyId: staffMember.companyId,
    franchiseeId: staffMember.franchiseeId,
    storeId: staffMember.storeId,
    normalizedUserId,
    password,
    authUid: staffMember.id,
  })

  // Ensure Auth user + claims stay aligned after password rotation / first set.
  const claims = buildStaffCustomClaims(staffMember)
  const auth = getAuth()
  try {
    await auth.getUser(staffMember.id)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'auth/user-not-found') {
      throw error
    }
    await auth.createUser({
      uid: staffMember.id,
      displayName: staffMember.name,
      disabled: !staffMember.enabled,
    })
  }
  await auth.setCustomUserClaims(staffMember.id, claims)
  if (!staffMember.enabled) {
    await auth.updateUser(staffMember.id, { disabled: true })
  }

  logger.info(
    'upsertStaffCredential',
    redactAuthSecrets({
      actorStaffId: caller.staffId,
      targetStaffId: staffMember.id,
      companyId: staffMember.companyId,
      storeId: staffMember.storeId,
    }),
  )

  return { updated: true, credentialId: result.credentialId, claimsSynced: true }
})

export const syncStaffAuthClaims = onCall({ region: 'asia-northeast1' }, async (request) => {
  assertAuthV2Enabled()
  const caller = requireCallerClaims(request)
  const staffId = String(request.data?.staffId || '').trim()
  if (!staffId) {
    throw new HttpsError('invalid-argument', 'staffId が必要です。')
  }

  const staffMember = await loadStaffMember(staffId)
  assertCanManageStaff(caller, {
    companyId: staffMember.companyId,
    storeId: staffMember.storeId,
    role: staffMember.role,
  })

  const result = await syncAuthClaimsForStaff(staffId)
  logger.info('syncStaffAuthClaims', {
    actorStaffId: caller.staffId,
    targetStaffId: staffId,
    synced: result.synced,
    role: result.claims.role,
  })
  return result
})

export const disableStaffAuth = onCall({ region: 'asia-northeast1' }, async (request) => {
  assertAuthV2Enabled()
  const caller = requireCallerClaims(request)
  const staffId = String(request.data?.staffId || '').trim()
  if (!staffId) {
    throw new HttpsError('invalid-argument', 'staffId が必要です。')
  }

  const staffMember = await loadStaffMember(staffId)
  assertCanManageStaff(caller, {
    companyId: staffMember.companyId,
    storeId: staffMember.storeId,
    role: staffMember.role,
  })

  const auth = getAuth()
  try {
    await auth.updateUser(staffId, { disabled: true })
    await auth.revokeRefreshTokens(staffId)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'auth/user-not-found') {
      throw error
    }
  }

  logger.info('disableStaffAuth', {
    actorStaffId: caller.staffId,
    targetStaffId: staffId,
  })
  return { disabled: true }
})
