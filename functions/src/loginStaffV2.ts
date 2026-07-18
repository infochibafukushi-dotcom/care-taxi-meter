import { createHash } from 'crypto'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import {
  AUTH_FAILURE_MESSAGE_V2,
  AUTH_V2_ENABLED,
  AUTH_V2_ENFORCE,
  LOGIN_LOCK_MESSAGE,
  LOGIN_LOCK_MINUTES,
  MAX_LOGIN_FAILURES,
  assertAuthV2Enabled,
} from './authFlags'
import { isCompanyLoginAllowed } from './authPolicy'
import { redactAuthSecrets, verifyPassword } from './passwordCrypto'
import { buildStaffCustomClaims, claimsMatchStaffRole, type StaffCustomClaims } from './staffClaims'
import {
  clearCredentialLoginFailures,
  findStaffCredentialByLogin,
  isCredentialLocked,
  normalizeCompanyIdInput,
  normalizeLoginIdentifier,
  normalizeLoginInput,
  recordCredentialLoginFailure,
} from './staffCredentials'

const defaultFranchiseeId = 'default-franchisee'
const LOGIN_ATTEMPTS_COLLECTION = 'loginAttempts'

type StaffRole = 'driver' | 'manager' | 'owner' | 'hq_admin'

type StaffMemberRecord = {
  id: string
  companyId: string
  franchiseeId: string
  storeId: string
  storeName: string
  userId: string
  loginId: string
  name: string
  role: StaffRole
  enabled: boolean
  sortOrder: number
}

type CompanyRecord = {
  id: string
  name: string
  corporateName: string
  tradeName?: string
  status?: string
  enabled: boolean
}

const HEADQUARTERS_LOGIN_ALIASES: Record<string, string> = {
  株式会社千葉福祉サポート: defaultFranchiseeId,
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback

const toRole = (value: unknown): StaffRole => {
  if (value === 'superAdmin' || value === 'hq_admin') return 'hq_admin'
  if (value === 'owner' || value === 'manager' || value === 'driver') return value
  return 'driver'
}

const docFranchisee = (data: Record<string, unknown>) =>
  toStringValue(data.franchiseeId) || toStringValue(data.companyId)

const toStaffMember = (id: string, data: Record<string, unknown>): StaffMemberRecord => ({
  id: toStringValue(data.id) || id,
  companyId: docFranchisee(data),
  franchiseeId: docFranchisee(data),
  storeId: toStringValue(data.storeId),
  storeName: toStringValue(data.storeName),
  userId: toStringValue(data.userId),
  loginId: toStringValue(data.loginId) || toStringValue(data.userId),
  name: toStringValue(data.name) || '名称未設定のスタッフ',
  role: toRole(data.role),
  enabled: toBooleanValue(data.enabled ?? data.isActive),
  sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
})

const toCompany = (id: string, data: Record<string, unknown>): CompanyRecord => ({
  id,
  name: toStringValue(data.name),
  corporateName: toStringValue(data.corporateName),
  tradeName: toStringValue(data.tradeName),
  status: toStringValue(data.status) || undefined,
  enabled: toBooleanValue(data.enabled, true),
})

const sanitizeStaffMemberResponse = (staffMember: StaffMemberRecord) => ({
  id: staffMember.id,
  companyId: staffMember.companyId,
  franchiseeId: staffMember.franchiseeId,
  storeId: staffMember.storeId,
  storeName: staffMember.storeName,
  userId: staffMember.userId,
  loginId: staffMember.loginId,
  name: staffMember.name,
  role: staffMember.role,
  canDrive: staffMember.role === 'owner' || staffMember.role === 'driver',
  isActive: staffMember.enabled,
  phoneNumber: '',
  email: '',
  address: '',
  licenseNumber: '',
  licenseExpiresAt: '',
  accidentHistory: '',
  memo: '',
  enabled: staffMember.enabled,
  sortOrder: staffMember.sortOrder,
})

const buildLoginAttemptId = (companyId: string, userId: string) =>
  createHash('sha256')
    .update(`${normalizeLoginInput(companyId)}\0${normalizeLoginIdentifier(userId)}`)
    .digest('hex')

async function assertAttemptNotLocked(db: FirebaseFirestore.Firestore, companyId: string, userId: string) {
  const attemptRef = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(buildLoginAttemptId(companyId, userId))
  const snapshot = await attemptRef.get()
  if (!snapshot.exists) {
    return
  }

  const lockedUntil = snapshot.get('lockedUntil')
  const lockedUntilMs =
    lockedUntil instanceof Timestamp ? lockedUntil.toMillis() : Number(lockedUntil ?? 0)

  if (lockedUntilMs > Date.now()) {
    throw new HttpsError('resource-exhausted', LOGIN_LOCK_MESSAGE)
  }
}

async function recordAttemptFailure(
  db: FirebaseFirestore.Firestore,
  companyId: string,
  userId: string,
  ipAddress: string,
) {
  const attemptRef = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(buildLoginAttemptId(companyId, userId))

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef)
    const failureCount = Number(snapshot.get('failureCount') ?? 0) + 1
    const shouldLock = failureCount >= MAX_LOGIN_FAILURES
    const lockedUntil = shouldLock
      ? Timestamp.fromMillis(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000)
      : null

    transaction.set(
      attemptRef,
      {
        failureCount,
        lockedUntil,
        companyIdHash: createHash('sha256').update(normalizeLoginInput(companyId)).digest('hex').slice(0, 12),
        userIdHash: createHash('sha256').update(normalizeLoginIdentifier(userId)).digest('hex').slice(0, 12),
        lastIpHash: ipAddress
          ? createHash('sha256').update(ipAddress).digest('hex').slice(0, 12)
          : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return failureCount
  })
}

async function clearAttemptFailures(db: FirebaseFirestore.Firestore, companyId: string, userId: string) {
  const attemptRef = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(buildLoginAttemptId(companyId, userId))
  await attemptRef.delete()
}

async function loadCompanies(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection('companies').get()
  return snapshot.docs.map((doc) => toCompany(doc.id, doc.data()))
}

function resolveCandidateCompanyIds(companyId: string, companies: CompanyRecord[]) {
  const normalizedCompanyId = normalizeLoginInput(companyId)
  const normalizedCompanyIdSlug = normalizeCompanyIdInput(companyId)
  const headquartersAliasCompanyId = HEADQUARTERS_LOGIN_ALIASES[normalizedCompanyId]

  const matchedCompanies = companies.filter(
    (company) =>
      company.id === normalizedCompanyId ||
      company.name === normalizedCompanyId ||
      company.corporateName === normalizedCompanyId ||
      company.tradeName === normalizedCompanyId ||
      company.id === normalizedCompanyIdSlug ||
      (headquartersAliasCompanyId ? company.id === headquartersAliasCompanyId : false),
  )

  return {
    matchedCompanies,
    candidateCompanyIds: [
      normalizedCompanyId,
      normalizedCompanyIdSlug,
      ...(headquartersAliasCompanyId ? [headquartersAliasCompanyId] : []),
      ...matchedCompanies.map((company) => company.id),
    ],
  }
}

async function ensureAuthUserWithClaims({
  authUid,
  claims,
  displayName,
}: {
  authUid: string
  claims: StaffCustomClaims
  displayName: string
}) {
  const auth = getAuth()
  try {
    await auth.getUser(authUid)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'auth/user-not-found') {
      throw error
    }
    await auth.createUser({
      uid: authUid,
      displayName,
      disabled: false,
    })
  }

  await auth.setCustomUserClaims(authUid, claims)
  return auth.createCustomToken(authUid, claims)
}

/** Reasons that may fall back to loginStaff while AUTH_V2_ENFORCE=false. */
const FALLBACK_ELIGIBLE_REASONS = new Set(['credential_not_found'])

async function rejectAuthFailure({
  db,
  companyId,
  userId,
  ipAddress,
  credentialId,
  reason,
}: {
  db: FirebaseFirestore.Firestore
  companyId: string
  userId: string
  ipAddress: string
  credentialId?: string
  reason: string
}): Promise<never> {
  const failureCount = await recordAttemptFailure(db, companyId, userId, ipAddress)
  if (credentialId) {
    const result = await recordCredentialLoginFailure(
      credentialId,
      MAX_LOGIN_FAILURES,
      LOGIN_LOCK_MINUTES,
    )
    if (result.locked || failureCount >= MAX_LOGIN_FAILURES) {
      logger.warn('loginStaffV2 locked', redactAuthSecrets({ reason, failureCount }))
      throw new HttpsError('resource-exhausted', LOGIN_LOCK_MESSAGE, {
        authFallback: false,
        reason: 'locked',
      })
    }
  } else if (failureCount >= MAX_LOGIN_FAILURES) {
    logger.warn('loginStaffV2 locked', redactAuthSecrets({ reason, failureCount }))
    throw new HttpsError('resource-exhausted', LOGIN_LOCK_MESSAGE, {
      authFallback: false,
      reason: 'locked',
    })
  }

  const authFallback = !AUTH_V2_ENFORCE && FALLBACK_ELIGIBLE_REASONS.has(reason)
  logger.info('loginStaffV2 auth failure', redactAuthSecrets({ reason, failureCount, authFallback }))

  // not_migrated → failed-precondition only when ENFORCE=false (legacy fallback window).
  // With ENFORCE=true, all auth failures are unauthenticated / no fallback.
  if (authFallback) {
    throw new HttpsError('failed-precondition', AUTH_FAILURE_MESSAGE_V2, {
      authFallback: true,
      reason,
    })
  }

  throw new HttpsError('unauthenticated', AUTH_FAILURE_MESSAGE_V2, {
    authFallback: false,
    reason,
  })
}

export const loginStaffV2 = onCall({ region: 'asia-northeast1' }, async (request) => {
  assertAuthV2Enabled()

  const companyId = normalizeLoginInput(String(request.data?.companyId || ''))
  const userId = normalizeLoginInput(String(request.data?.userId || ''))
  const password = normalizeLoginInput(String(request.data?.password || ''))
  const ipAddress = String(request.rawRequest?.ip || request.rawRequest?.headers['x-forwarded-for'] || '')

  if (!companyId || !userId || !password) {
    throw new HttpsError('invalid-argument', '会社ID・ユーザーID・パスワードを入力してください。')
  }

  const db = getFirestore()
  await assertAttemptNotLocked(db, companyId, userId)

  const companies = await loadCompanies(db)
  const { matchedCompanies, candidateCompanyIds } = resolveCandidateCompanyIds(companyId, companies)
  const normalizedUserId = normalizeLoginIdentifier(userId)

  const credential = await findStaffCredentialByLogin({
    companyIds: candidateCompanyIds,
    normalizedUserId,
  })

  if (!credential) {
    return rejectAuthFailure({
      db,
      companyId,
      userId,
      ipAddress,
      reason: 'credential_not_found',
    })
  }

  if (isCredentialLocked(credential)) {
    throw new HttpsError('resource-exhausted', LOGIN_LOCK_MESSAGE)
  }

  const passwordOk = await verifyPassword(password, credential)
  if (!passwordOk) {
    return rejectAuthFailure({
      db,
      companyId,
      userId,
      ipAddress,
      credentialId: credential.credentialId,
      reason: 'bad_password',
    })
  }

  const staffSnap = await db.collection('staffMembers').doc(credential.staffId).get()
  if (!staffSnap.exists) {
    return rejectAuthFailure({
      db,
      companyId,
      userId,
      ipAddress,
      credentialId: credential.credentialId,
      reason: 'staff_missing',
    })
  }

  const staffMember = toStaffMember(staffSnap.id, staffSnap.data() || {})
  if (!staffMember.enabled) {
    return rejectAuthFailure({
      db,
      companyId,
      userId,
      ipAddress,
      credentialId: credential.credentialId,
      reason: 'staff_disabled',
    })
  }

  const company =
    matchedCompanies.find((item) => item.id === staffMember.companyId) ||
    companies.find((item) => item.id === staffMember.companyId) ||
    null

  if (!isCompanyLoginAllowed(company)) {
    return rejectAuthFailure({
      db,
      companyId,
      userId,
      ipAddress,
      credentialId: credential.credentialId,
      reason: 'company_inactive',
    })
  }

  const claims = buildStaffCustomClaims(staffMember)
  if (!claimsMatchStaffRole(staffMember.role, claims.role)) {
    return rejectAuthFailure({
      db,
      companyId,
      userId,
      ipAddress,
      credentialId: credential.credentialId,
      reason: 'role_mismatch',
    })
  }

  const authUid = credential.authUid || staffMember.id
  const customToken = await ensureAuthUserWithClaims({
    authUid,
    claims,
    displayName: staffMember.name,
  })

  await clearCredentialLoginFailures(credential.credentialId)
  await clearAttemptFailures(db, companyId, userId)

  logger.info('loginStaffV2 success', {
    staffId: staffMember.id,
    role: staffMember.role,
    companyId: staffMember.companyId,
    storeId: staffMember.storeId,
    authV2Enabled: AUTH_V2_ENABLED,
  })

  return {
    customToken,
    companyName: company?.name || '',
    staffMember: sanitizeStaffMemberResponse(staffMember),
    claims,
  }
})
