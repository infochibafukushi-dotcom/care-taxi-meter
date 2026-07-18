import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import {
  hashPassword,
  type PasswordHashParameters,
  type PasswordHashRecord,
  PASSWORD_HASH_ALGORITHM,
} from './passwordCrypto'

export const STAFF_CREDENTIALS_COLLECTION = 'staffCredentials'

export type StaffCredentialRecord = {
  credentialId: string
  companyId: string
  franchiseeId: string
  storeId: string
  staffId: string
  normalizedUserId: string
  passwordHash: string
  passwordSalt: string
  hashAlgorithm: typeof PASSWORD_HASH_ALGORITHM
  hashParameters: PasswordHashParameters
  authUid: string
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null
  passwordChangedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null
  failedLoginCount: number
  lockedUntil: FirebaseFirestore.Timestamp | null
}

export const normalizeLoginInput = (value: string) => value.trim()
export const normalizeLoginIdentifier = (value: string) =>
  normalizeLoginInput(value).replace(/[\s\u3000]+/g, '')
export const normalizeCompanyIdInput = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

export const buildCredentialId = (staffId: string) => staffId.trim()

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function toStaffCredential(
  id: string,
  data: Record<string, unknown>,
): StaffCredentialRecord {
  const hashParametersRaw =
    data.hashParameters && typeof data.hashParameters === 'object'
      ? (data.hashParameters as Record<string, unknown>)
      : {}

  return {
    credentialId: id,
    companyId: toStringValue(data.companyId),
    franchiseeId: toStringValue(data.franchiseeId) || toStringValue(data.companyId),
    storeId: toStringValue(data.storeId),
    staffId: toStringValue(data.staffId) || id,
    normalizedUserId: toStringValue(data.normalizedUserId),
    passwordHash: toStringValue(data.passwordHash),
    passwordSalt: toStringValue(data.passwordSalt),
    hashAlgorithm: PASSWORD_HASH_ALGORITHM,
    hashParameters: {
      N: toNumberValue(hashParametersRaw.N, 16384),
      r: toNumberValue(hashParametersRaw.r, 8),
      p: toNumberValue(hashParametersRaw.p, 1),
      keyLength: toNumberValue(hashParametersRaw.keyLength, 64),
      saltBytes: toNumberValue(hashParametersRaw.saltBytes, 16),
    },
    authUid: toStringValue(data.authUid) || toStringValue(data.staffId) || id,
    createdAt: (data.createdAt as FirebaseFirestore.Timestamp | null) ?? null,
    updatedAt: (data.updatedAt as FirebaseFirestore.Timestamp | null) ?? null,
    passwordChangedAt: (data.passwordChangedAt as FirebaseFirestore.Timestamp | null) ?? null,
    failedLoginCount: toNumberValue(data.failedLoginCount),
    lockedUntil:
      data.lockedUntil instanceof Timestamp ? data.lockedUntil : null,
  }
}

export async function findStaffCredentialByLogin({
  companyIds,
  normalizedUserId,
}: {
  companyIds: string[]
  normalizedUserId: string
}): Promise<StaffCredentialRecord | null> {
  const db = getFirestore()
  const uniqueCompanyIds = [...new Set(companyIds.filter(Boolean))]

  for (const companyId of uniqueCompanyIds) {
    const snapshot = await db
      .collection(STAFF_CREDENTIALS_COLLECTION)
      .where('companyId', '==', companyId)
      .where('normalizedUserId', '==', normalizedUserId)
      .limit(2)
      .get()

    if (snapshot.empty) {
      continue
    }
    if (snapshot.size > 1) {
      // Ambiguous credentials must not authenticate.
      return null
    }
    return toStaffCredential(snapshot.docs[0].id, snapshot.docs[0].data())
  }

  return null
}

export async function getStaffCredentialByStaffId(
  staffId: string,
): Promise<StaffCredentialRecord | null> {
  const snapshot = await getFirestore()
    .collection(STAFF_CREDENTIALS_COLLECTION)
    .doc(buildCredentialId(staffId))
    .get()
  if (!snapshot.exists) {
    return null
  }
  return toStaffCredential(snapshot.id, snapshot.data() || {})
}

export async function upsertStaffCredentialPassword({
  staffId,
  companyId,
  franchiseeId,
  storeId,
  normalizedUserId,
  password,
  authUid,
}: {
  staffId: string
  companyId: string
  franchiseeId: string
  storeId: string
  normalizedUserId: string
  password: string
  authUid?: string
}): Promise<{ credentialId: string }> {
  const credentialId = buildCredentialId(staffId)
  const hashed: PasswordHashRecord = await hashPassword(password)
  const ref = getFirestore().collection(STAFF_CREDENTIALS_COLLECTION).doc(credentialId)
  const existing = await ref.get()

  await ref.set(
    {
      companyId,
      franchiseeId: franchiseeId || companyId,
      storeId,
      staffId,
      normalizedUserId,
      passwordHash: hashed.passwordHash,
      passwordSalt: hashed.passwordSalt,
      hashAlgorithm: hashed.hashAlgorithm,
      hashParameters: hashed.hashParameters,
      authUid: authUid || staffId,
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )

  return { credentialId }
}

export async function updateStaffCredentialClaimsFields({
  staffId,
  companyId,
  franchiseeId,
  storeId,
  normalizedUserId,
}: {
  staffId: string
  companyId?: string
  franchiseeId?: string
  storeId?: string
  normalizedUserId?: string
}) {
  const ref = getFirestore().collection(STAFF_CREDENTIALS_COLLECTION).doc(buildCredentialId(staffId))
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    return false
  }

  await ref.set(
    {
      ...(companyId ? { companyId } : {}),
      ...(franchiseeId ? { franchiseeId } : {}),
      ...(storeId ? { storeId } : {}),
      ...(normalizedUserId ? { normalizedUserId } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return true
}

export async function recordCredentialLoginFailure(
  credentialId: string,
  maxFailures: number,
  lockMinutes: number,
) {
  const ref = getFirestore().collection(STAFF_CREDENTIALS_COLLECTION).doc(credentialId)
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) {
      return { failureCount: 0, locked: false }
    }

    const failureCount = Number(snapshot.get('failedLoginCount') ?? 0) + 1
    const shouldLock = failureCount >= maxFailures
    const lockedUntil = shouldLock
      ? Timestamp.fromMillis(Date.now() + lockMinutes * 60 * 1000)
      : null

    transaction.set(
      ref,
      {
        failedLoginCount: failureCount,
        lockedUntil,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return { failureCount, locked: shouldLock }
  })
}

export async function clearCredentialLoginFailures(credentialId: string) {
  await getFirestore()
    .collection(STAFF_CREDENTIALS_COLLECTION)
    .doc(credentialId)
    .set(
      {
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
}

export function isCredentialLocked(credential: StaffCredentialRecord, nowMs = Date.now()) {
  if (!credential.lockedUntil) {
    return false
  }
  return credential.lockedUntil.toMillis() > nowMs
}
