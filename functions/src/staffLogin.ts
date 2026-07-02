import { createHash } from 'crypto'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const defaultFranchiseeId = 'default-franchisee'
const LOGIN_ATTEMPTS_COLLECTION = 'loginAttempts'
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MINUTES = 15
const LOGIN_LOCK_MESSAGE = 'しばらくしてから再度お試しください。'
const AUTH_FAILURE_MESSAGE = '会社ID・ログインID・パスワードが一致するスタッフが見つかりません。'

type StaffRole = 'driver' | 'manager' | 'owner' | 'hq_admin'

type StaffMemberRecord = {
  id: string
  companyId: string
  franchiseeId: string
  storeId: string
  storeName: string
  userId: string
  loginId: string
  password: string
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
  representativeName?: string
  representativeLoginId?: string
  representativeInitialPassword: string
  ownerPassword: string
  initialPassword: string
  ownerName?: string
  phoneNumber?: string
  email?: string
  address?: string
}

const COMPANY_LOGIN_ALIASES: Record<string, string> = {
  ちばケアタクシー: defaultFranchiseeId,
}

const normalizeLoginInput = (value: string) => value.trim()
const normalizeLoginIdentifier = (value: string) => normalizeLoginInput(value).replace(/[\s\u3000]+/g, '')
const normalizeCompanyIdInput = (value: string) =>
  value.trim().toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toPasswordValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
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
  password: toPasswordValue(data.password),
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
  representativeName: toStringValue(data.representativeName) || toStringValue(data.ownerName),
  representativeLoginId: toStringValue(data.representativeLoginId) || toStringValue(data.ownerLoginId),
  representativeInitialPassword: toStringValue(data.representativeInitialPassword),
  ownerPassword: toStringValue(data.ownerPassword),
  initialPassword: toStringValue(data.initialPassword),
  ownerName: toStringValue(data.ownerName),
  phoneNumber: toStringValue(data.phoneNumber),
  email: toStringValue(data.email),
  address: toStringValue(data.address),
})

const getRepresentativePassword = (company: CompanyRecord) => {
  const password =
    company.representativeInitialPassword || company.ownerPassword || company.initialPassword
  return password || null
}

const toAuthRole = (role: StaffRole) => {
  if (role === 'hq_admin') return 'hq_admin'
  if (role === 'owner') return 'owner'
  if (role === 'manager') return 'manager'
  return 'driver'
}

const buildLoginAttemptId = (companyId: string, userId: string) =>
  createHash('sha256')
    .update(`${normalizeLoginInput(companyId)}\0${normalizeLoginIdentifier(userId)}`)
    .digest('hex')

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

async function assertLoginNotLocked(
  db: FirebaseFirestore.Firestore,
  companyId: string,
  userId: string,
) {
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

async function recordLoginFailure(
  db: FirebaseFirestore.Firestore,
  companyId: string,
  userId: string,
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
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return failureCount
  })
}

async function clearLoginAttempts(db: FirebaseFirestore.Firestore, companyId: string, userId: string) {
  const attemptRef = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(buildLoginAttemptId(companyId, userId))
  await attemptRef.delete()
}

async function loadCompanies(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection('companies').orderBy('sortOrder', 'asc').get()
  return snapshot.docs.map((doc) => toCompany(doc.id, doc.data()))
}

async function loadStaffMembers(db: FirebaseFirestore.Firestore): Promise<StaffMemberRecord[]> {
  const snapshot = await db.collection('staffMembers').get()
  return snapshot.docs
    .map((doc) => toStaffMember(doc.id, doc.data()))
    .sort((firstStaff, secondStaff) => firstStaff.sortOrder - secondStaff.sortOrder)
}

const matchesCompanyId = (staffMember: StaffMemberRecord, candidateCompanyIds: Set<string>) =>
  candidateCompanyIds.has(staffMember.companyId) || candidateCompanyIds.has(staffMember.franchiseeId)

const matchesLoginIdentifier = (staffMember: StaffMemberRecord, normalizedUserLoginIdentifier: string) =>
  [
    staffMember.userId,
    staffMember.loginId,
    staffMember.name,
    staffMember.id,
  ].some((candidate) => normalizeLoginIdentifier(candidate) === normalizedUserLoginIdentifier)

function resolveCandidateCompanyIds(companyId: string, companies: CompanyRecord[]) {
  const normalizedCompanyId = normalizeLoginInput(companyId)
  const normalizedCompanyIdSlug = normalizeCompanyIdInput(companyId)
  const aliasCompanyId = COMPANY_LOGIN_ALIASES[normalizedCompanyId]

  const matchedCompanies = companies.filter(
    (company) =>
      company.id === normalizedCompanyId ||
      company.name === normalizedCompanyId ||
      company.corporateName === normalizedCompanyId ||
      company.tradeName === normalizedCompanyId ||
      company.id === normalizedCompanyIdSlug ||
      (aliasCompanyId ? company.id === aliasCompanyId : false),
  )

  return {
    matchedCompanies,
    candidateCompanyIds: new Set([
      normalizedCompanyId,
      normalizedCompanyIdSlug,
      ...(aliasCompanyId ? [aliasCompanyId] : []),
      ...matchedCompanies.map((company) => company.id),
    ]),
  }
}

async function fetchStoresForCompany(db: FirebaseFirestore.Firestore, companyId: string) {
  const snapshot = await db.collection('stores').where('franchiseeId', '==', companyId).get()
  if (!snapshot.empty) {
    return snapshot.docs
  }

  const legacySnapshot = await db.collection('stores').where('companyId', '==', companyId).get()
  return legacySnapshot.docs
}

async function repairOwnerStaffMember({
  db,
  company,
  normalizedUserId,
  normalizedPassword,
}: {
  db: FirebaseFirestore.Firestore
  company: CompanyRecord
  normalizedUserId: string
  normalizedPassword: string
}) {
  const storeDocs = await fetchStoresForCompany(db, company.id)
  let ownerStoreId = ''
  let ownerStoreName = company.name

  if (storeDocs.length > 0) {
    const storeData = storeDocs[0].data()
    ownerStoreId = toStringValue(storeData.id) || storeDocs[0].id
    ownerStoreName = toStringValue(storeData.storeName) || toStringValue(storeData.name) || company.name
  } else {
    ownerStoreId = `${company.id}_main-store`
    await db.collection('stores').doc(ownerStoreId).set(
      {
        id: ownerStoreId,
        companyId: company.id,
        franchiseeId: company.id,
        name: company.name,
        storeName: company.name,
        companyName: company.name,
        ownerName: company.representativeName || company.ownerName || '',
        address: company.address || '',
        phoneNumber: company.phoneNumber || '',
        email: company.email || '',
        status: 'active',
        enabled: true,
        isActive: true,
        sortOrder: 1,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  const ownerStaffMember: StaffMemberRecord = {
    id: `${company.id}_owner`,
    companyId: company.id,
    franchiseeId: company.id,
    storeId: ownerStoreId,
    storeName: ownerStoreName,
    userId: normalizedUserId,
    loginId: normalizedUserId,
    password: normalizedPassword,
    name: company.representativeName || company.ownerName || normalizedUserId,
    role: 'owner',
    enabled: true,
    sortOrder: 1,
  }

  await db.collection('staffMembers').doc(ownerStaffMember.id).set(
    {
      ...ownerStaffMember,
      canDrive: true,
      isActive: true,
      status: 'employed',
      memo: '加盟店代表者ログイン時に復旧したオーナーアカウント',
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return ownerStaffMember
}

async function resolveStaffMemberForLogin({
  companyId,
  password,
  userId,
}: {
  companyId: string
  password: string
  userId: string
}) {
  const db = getFirestore()
  const normalizedUserId = normalizeLoginInput(userId)
  const normalizedUserLoginIdentifier = normalizeLoginIdentifier(userId)
  const normalizedPassword = normalizeLoginInput(password)

  const [staffMembers, companies] = await Promise.all([loadStaffMembers(db), loadCompanies(db)])
  const { matchedCompanies, candidateCompanyIds } = resolveCandidateCompanyIds(companyId, companies)

  const matchedStaffMember = staffMembers.find(
    (staffMember) =>
      staffMember.enabled &&
      matchesCompanyId(staffMember, candidateCompanyIds) &&
      matchesLoginIdentifier(staffMember, normalizedUserLoginIdentifier) &&
      staffMember.password === normalizedPassword,
  )

  if (matchedStaffMember) {
    return {
      staffMember: matchedStaffMember,
      companyName:
        matchedCompanies[0]?.name ||
        companies.find((company) => company.id === matchedStaffMember.companyId)?.name ||
        '',
    }
  }

  const representativeCompany = matchedCompanies.find((company) => {
    const representativeLoginId =
      company.representativeLoginId || company.representativeName || company.ownerName || ''
    const representativePassword = getRepresentativePassword(company)
    if (!representativePassword) {
      return false
    }

    return (
      normalizeLoginIdentifier(representativeLoginId) === normalizedUserLoginIdentifier &&
      representativePassword === normalizedPassword
    )
  })

  if (!representativeCompany) {
    return null
  }

  const repairedOwnerStaffMember = await repairOwnerStaffMember({
    db,
    company: representativeCompany,
    normalizedUserId,
    normalizedPassword,
  })

  return {
    staffMember: repairedOwnerStaffMember,
    companyName: representativeCompany.name,
  }
}

export const loginStaff = onCall({ region: 'asia-northeast1' }, async (request) => {
  const companyId = normalizeLoginInput(String(request.data?.companyId || ''))
  const userId = normalizeLoginInput(String(request.data?.userId || ''))
  const password = normalizeLoginInput(String(request.data?.password || ''))

  if (!companyId || !userId || !password) {
    throw new HttpsError('invalid-argument', '会社ID・ログインID・パスワードを入力してください。')
  }

  const db = getFirestore()
  await assertLoginNotLocked(db, companyId, userId)

  const resolved = await resolveStaffMemberForLogin({ companyId, userId, password })
  if (!resolved) {
    const failureCount = await recordLoginFailure(db, companyId, userId)
    if (failureCount >= MAX_LOGIN_FAILURES) {
      throw new HttpsError('resource-exhausted', LOGIN_LOCK_MESSAGE)
    }
    throw new HttpsError('not-found', AUTH_FAILURE_MESSAGE)
  }

  await clearLoginAttempts(db, companyId, userId)

  const { staffMember, companyName } = resolved
  const customToken = await getAuth().createCustomToken(staffMember.id, {
    role: toAuthRole(staffMember.role),
    franchiseeId: staffMember.franchiseeId || staffMember.companyId,
    companyId: staffMember.companyId,
    storeId: staffMember.storeId,
    staffId: staffMember.id,
  })

  return {
    customToken,
    companyName,
    staffMember: sanitizeStaffMemberResponse(staffMember),
  }
})
