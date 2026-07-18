import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember, StaffRole } from '../types/work'
import { signInStaffWithFirebaseAuth, type LoginStaffResult } from './firebaseAuth'
import { createAuditLog } from './auditLogs'
import type { AuditActor } from './auditLogs'
import { defaultStoreId, getFranchiseeId, getStoreId, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'

export const STAFF_SAVE_PERMISSION_MESSAGE =
  '従業員情報を保存できませんでした。編集権限または保存対象項目を確認してください。'
export const STAFF_INCOMPLETE_MESSAGE = '従業員名とログインIDを入力してください。'
export const STAFF_EDIT_FORBIDDEN_MESSAGE = '従業員情報の編集権限がありません。'

const staffMembersCollectionName = 'staffMembers'
const validRoles: StaffRole[] = ['driver', 'manager', 'owner', 'hq_admin']

/** Document id for HQ bootstrap admin created only by gated development reset. */
export const defaultAdminStaffMemberId = 'staff_admin'
/** Login userId label for HQ bootstrap admin (not a secret). */
export const defaultAdminStaffUserId = '山本信勝'

const AUTH_SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'initialPassword',
  'ownerPassword',
  'representativeInitialPassword',
  'hash',
  'salt',
  'customToken',
  'idToken',
  'refreshToken',
  'Authorization',
])

/** Strip auth-sensitive fields from objects before console logging. */
export const redactAuthSensitiveFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuthSensitiveFields(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (AUTH_SENSITIVE_KEYS.has(key)) {
      result[key] = nested == null || nested === '' ? '' : '[redacted]'
      continue
    }
    result[key] = redactAuthSensitiveFields(nested)
  }
  return result
}

/** UI/list mapping: never expose stored password to form state. */
export const stripStaffPasswordForClient = <T extends { password?: string }>(staff: T): T => ({
  ...staff,
  password: '',
})

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const toRole = (value: unknown): StaffRole => {
  if (value === 'superAdmin' || value === 'hq_admin') return 'hq_admin'
  return typeof value === 'string' && validRoles.includes(value as StaffRole)
    ? (value as StaffRole)
    : 'driver'
}

const toStaffMember = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
): StaffMember => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    companyId: getFranchiseeId(data),
    franchiseeId: getFranchiseeId(data),
    storeId: getStoreId(data),
    storeName: toStringValue(data.storeName),
    userId: toStringValue(data.userId),
    loginId: toStringValue(data.loginId) || toStringValue(data.userId),
    // Never hydrate passwords into client staff objects (forms must stay blank).
    password: '',
    name: toStringValue(data.name) || '名称未設定のスタッフ',
    role: toRole(data.role),
    canDrive: toBooleanValue(data.canDrive, toRole(data.role) === 'owner' || toRole(data.role) === 'driver'),
    isActive: toBooleanValue(data.isActive ?? data.enabled),
    status: ['employed', 'leave', 'retired', 'disabled'].includes(toStringValue(data.status)) ? data.status as StaffMember['status'] : (toBooleanValue(data.enabled) ? 'employed' : 'disabled'),
    joinedAt: toStringValue(data.joinedAt),
    retiredAt: toStringValue(data.retiredAt),
    lastLoginAt: toStringValue(data.lastLoginAt),
    phoneNumber: toStringValue(data.phoneNumber),
    email: toStringValue(data.email),
    address: toStringValue(data.address),
    licenseNumber: toStringValue(data.licenseNumber),
    licenseExpiresAt: toStringValue(data.licenseExpiresAt),
    accidentHistory: toStringValue(data.accidentHistory),
    memo: toStringValue(data.memo),
    enabled: toBooleanValue(data.enabled),
    sortOrder: toNumberValue(data.sortOrder),
  }
}

function getStaffMembersCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, staffMembersCollectionName)
}

function getStaffMemberRef(staffMemberId: string) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, staffMembersCollectionName, staffMemberId)
}

const createStaffMemberTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || scope.role === 'hq_admin') return []

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const constraints: QueryConstraint[] = []

  if (franchiseeId) {
    constraints.push(where('franchiseeId', '==', franchiseeId))
  }

  if ((scope.role === 'manager' || scope.role === 'driver') && scope.storeId) {
    constraints.push(where('storeId', '==', scope.storeId))
  }

  if (scope.role === 'driver' && scope.staffId) {
    constraints.push(where('id', '==', scope.staffId))
  }

  return constraints
}

export async function fetchStaffMembers(scope?: TenantAccessScope) {
  const snapshots = await getDocs(
    query(
      getStaffMembersCollection(),
      ...createStaffMemberTenantConstraints(scope),
      orderBy('sortOrder', 'asc'),
    ),
  )

  return snapshots.docs.map(toStaffMember).filter((staffMember) => matchesTenantScope(staffMember, scope))
}

type StaffSaveSessionContext = {
  companyId?: string
  franchiseeId?: string
  storeId?: string
  staffRole?: string
  staffId?: string
}

const getErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '')
  }
  return ''
}

/**
 * 従業員管理画面用の保存ペイロード。undefined は送らない。
 * password は includePassword が true のときだけ含める（空欄更新で既存値を消さない）。
 */
export const buildStaffAdminPayload = (
  staffMember: StaffMember,
  options: { includePassword: boolean } = { includePassword: false },
) => {
  const franchiseeId = (staffMember.franchiseeId || staffMember.companyId || '').trim()
  const storeId = (staffMember.storeId || defaultStoreId).trim() || defaultStoreId
  const name = staffMember.name.trim()
  const loginId = (staffMember.loginId || staffMember.userId || name).trim() || name
  const role = toRole(staffMember.role)
  const trimmedPassword = staffMember.password?.trim() ?? ''

  const base = {
    id: staffMember.id,
    companyId: franchiseeId,
    franchiseeId,
    storeId,
    storeName: (staffMember.storeName || '').trim(),
    userId: (staffMember.userId || loginId).trim() || loginId,
    loginId,
    name,
    role,
    status: staffMember.status ?? (staffMember.enabled !== false ? 'employed' : 'disabled'),
    joinedAt: staffMember.joinedAt || '',
    retiredAt: staffMember.retiredAt || '',
    lastLoginAt: staffMember.lastLoginAt || '',
    canDrive: staffMember.canDrive ?? (role === 'owner' || role === 'driver'),
    isActive: staffMember.isActive ?? staffMember.enabled !== false,
    phoneNumber: staffMember.phoneNumber || '',
    email: staffMember.email || '',
    address: staffMember.address || '',
    licenseNumber: staffMember.licenseNumber || '',
    licenseExpiresAt: staffMember.licenseExpiresAt || '',
    accidentHistory: staffMember.accidentHistory || '',
    memo: staffMember.memo || '',
    enabled: staffMember.enabled !== false,
    sortOrder: Math.max(staffMember.sortOrder || 1, 1),
  }

  if (options.includePassword && trimmedPassword) {
    return { ...base, password: trimmedPassword }
  }

  return base
}

export const isStaffReadyToSave = (staffMember: StaffMember) => {
  const name = staffMember.name.trim()
  const loginId = (staffMember.loginId || staffMember.userId || '').trim()
  const franchiseeId = (staffMember.franchiseeId || staffMember.companyId || '').trim()
  return Boolean(name && loginId && franchiseeId)
}

export const toStaffSaveUserMessage = (error: unknown) => {
  if (error instanceof FirebaseError && error.code === 'permission-denied') {
    return STAFF_SAVE_PERMISSION_MESSAGE
  }

  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/missing or insufficient permissions|permission-denied|permission_denied/i.test(message)) {
    return STAFF_SAVE_PERMISSION_MESSAGE
  }

  if (error instanceof Error && error.message) {
    return `従業員情報を保存できませんでした。${error.message}`
  }

  return STAFF_SAVE_PERMISSION_MESSAGE
}

export async function saveStaffMember(
  staffMember: StaffMember,
  actor?: AuditActor | null,
  sessionContext: StaffSaveSessionContext = {},
) {
  const staffMemberRef = getStaffMemberRef(staffMember.id)

  if (!(staffMember.franchiseeId || staffMember.companyId || '').trim()) {
    throw new Error('従業員の会社ID（franchiseeId）が未設定です。')
  }
  if (!(staffMember.storeId || '').trim() && !defaultStoreId) {
    throw new Error('従業員の店舗ID（storeId）が未設定です。')
  }

  let operation: 'create' | 'update'
  let previousStaffMember: StaffMember | null = null

  try {
    const snapshot = await getDoc(staffMemberRef)
    operation = snapshot.exists() ? 'update' : 'create'
    previousStaffMember = snapshot.exists() ? toStaffMember(snapshot) : null
  } catch (error) {
    operation = 'create'
    console.warn('[StaffManagement] getDoc before save failed; treating as create', {
      staffId: staffMember.id,
      errorCode: getErrorCode(error),
      errorMessage: error instanceof Error ? error.message : String(error ?? ''),
      session: sessionContext,
    })
  }

  const trimmedPassword = staffMember.password?.trim() ?? ''
  if (operation === 'create' && !trimmedPassword) {
    throw new Error('新規スタッフにはパスワードが必要です。')
  }

  const includePassword = operation === 'create' || Boolean(trimmedPassword)
  const masterPayload = buildStaffAdminPayload(staffMember, { includePassword })

  if (!masterPayload.franchiseeId) {
    throw new Error('従業員の会社ID（franchiseeId）が未設定です。')
  }
  if (!masterPayload.storeId) {
    throw new Error('従業員の店舗ID（storeId）が未設定です。')
  }

  const payload = {
    ...masterPayload,
    ...(operation === 'create' ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  try {
    await setDoc(staffMemberRef, payload, { merge: true })
  } catch (error) {
    console.warn(
      '[StaffManagement] save failed',
      redactAuthSensitiveFields({
        operation,
        staffId: staffMember.id,
        payloadKeys: Object.keys(payload),
        session: {
          companyId: sessionContext.companyId ?? '',
          franchiseeId: sessionContext.franchiseeId ?? '',
          storeId: sessionContext.storeId ?? '',
          staffRole: sessionContext.staffRole ?? '',
          staffId: sessionContext.staffId ?? '',
        },
        errorCode: getErrorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error ?? ''),
      }),
    )
    throw error
  }

  if (actor && previousStaffMember?.role && previousStaffMember.role !== staffMember.role) {
    await createAuditLog({
      action: 'role_change',
      actor,
      after: { role: staffMember.role },
      before: { role: previousStaffMember.role },
      franchiseeId: staffMember.franchiseeId || staffMember.companyId,
      reason: 'スタッフ権限変更',
      storeId: staffMember.storeId,
      targetId: staffMember.id,
      targetType: 'staffMember',
    })
  }

  if (actor && previousStaffMember?.enabled === true && staffMember.enabled === false) {
    await createAuditLog({
      action: 'staff_delete',
      actor,
      after: { enabled: false },
      before: { enabled: true },
      franchiseeId: staffMember.franchiseeId || staffMember.companyId,
      reason: 'スタッフ無効化',
      storeId: staffMember.storeId,
      targetId: staffMember.id,
      targetType: 'staffMember',
    })
  }

  return stripStaffPasswordForClient(staffMember)
}

export async function authenticateStaff({
  companyId,
  password,
  userId,
}: {
  companyId: string
  password: string
  userId: string
}): Promise<LoginStaffResult | null> {
  return signInStaffWithFirebaseAuth({ companyId, password, userId })
}
