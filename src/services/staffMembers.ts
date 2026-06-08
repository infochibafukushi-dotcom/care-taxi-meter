import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember, StaffRole } from '../types/work'
import { ensureDefaultCompany } from './companies'
import { defaultCompanyId, ensureDefaultStore, ensureHeadquartersStore } from './stores'
import { createAuditLog } from './auditLogs'
import type { AuditActor } from './auditLogs'
import { getFranchiseeId, getStoreId, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'

const staffMembersCollectionName = 'staffMembers'
const validRoles: StaffRole[] = ['driver', 'manager', 'owner', 'hq_admin']

export const defaultAdminStaffMemberId = 'staff_admin'
export const defaultAdminStaffUserId = '山本信勝'
export const defaultAdminStaffPassword = '123'

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
    password: toStringValue(data.password),
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

export async function fetchStaffMembers(scope?: TenantAccessScope) {
  const snapshots = await getDocs(
    query(getStaffMembersCollection(), orderBy('sortOrder', 'asc')),
  )

  return snapshots.docs.map(toStaffMember).filter((staffMember) => matchesTenantScope(staffMember, scope))
}

export async function saveStaffMember(staffMember: StaffMember, actor?: AuditActor | null) {
  const staffMemberRef = getStaffMemberRef(staffMember.id)
  const snapshot = await getDoc(staffMemberRef)
  const document = {
    ...staffMember,
    companyId: staffMember.franchiseeId || staffMember.companyId,
    franchiseeId: staffMember.franchiseeId || staffMember.companyId,
    isActive: staffMember.isActive ?? staffMember.enabled,
    canDrive: staffMember.canDrive ?? (staffMember.role === 'owner' || staffMember.role === 'driver'),
    ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  const previousStaffMember = snapshot.exists() ? toStaffMember(snapshot) : null

  await setDoc(staffMemberRef, document, { merge: true })

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

  return staffMember
}

export async function ensureDefaultAdminStaffMember() {
  await ensureDefaultCompany()
  await ensureDefaultStore(defaultCompanyId)
  const headquartersStore = await ensureHeadquartersStore(defaultCompanyId)
  const staffMemberRef = getStaffMemberRef(defaultAdminStaffMemberId)
  const snapshot = await getDoc(staffMemberRef)

  if (snapshot.exists()) {
    const existingStaffMember = toStaffMember(snapshot)
    if (
      existingStaffMember.userId === defaultAdminStaffUserId ||
      existingStaffMember.userId === 'admin' ||
      existingStaffMember.name === '山本信勝'
    ) {
      const migratedStaffMember: StaffMember = {
        ...existingStaffMember,
        name: '山本信勝',
        userId: defaultAdminStaffUserId,
        password: defaultAdminStaffPassword,
        role: 'hq_admin',
        enabled: true,
        storeId: headquartersStore.id,
        storeName: headquartersStore.name,
        memo: existingStaffMember.memo || 'FC本部初期管理者アカウント',
      }

      await setDoc(staffMemberRef, {
        ...migratedStaffMember,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      return migratedStaffMember
    }

    return existingStaffMember
  }

  const staffMember: StaffMember = {
    id: defaultAdminStaffMemberId,
    companyId: defaultCompanyId,
    franchiseeId: defaultCompanyId,
    storeId: headquartersStore.id,
    storeName: 'FC本部',
    userId: defaultAdminStaffUserId,
    password: defaultAdminStaffPassword,
    name: '山本信勝',
    role: 'hq_admin',
    canDrive: false,
    isActive: true,
    phoneNumber: '',
    email: '',
    address: '',
    licenseNumber: '',
    licenseExpiresAt: '',
    accidentHistory: '',
    memo: 'FC本部初期管理者アカウント',
    enabled: true,
    sortOrder: 1,
  }

  await setDoc(staffMemberRef, {
    ...staffMember,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return staffMember
}


async function migrateLegacySuperAdminStaffMembers() {
  const staffMembers = await fetchStaffMembers()
  const legacySuperAdminStaffMembers = staffMembers.filter(
    (staffMember) =>
      staffMember.userId === defaultAdminStaffUserId ||
      staffMember.userId === 'admin' ||
      staffMember.name === '山本信勝',
  )

  if (legacySuperAdminStaffMembers.length === 0) {
    return
  }

  const headquartersStore = await ensureHeadquartersStore(defaultCompanyId)
  await Promise.all(
    legacySuperAdminStaffMembers.map((staffMember) =>
      setDoc(
        getStaffMemberRef(staffMember.id),
        {
          ...staffMember,
          companyId: defaultCompanyId,
          franchiseeId: defaultCompanyId,
          storeId: headquartersStore.id,
          storeName: headquartersStore.name,
          role: 'hq_admin',
          userId: defaultAdminStaffUserId,
          password: defaultAdminStaffPassword,
          enabled: true,
          memo: staffMember.memo || 'FC本部管理者アカウント',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ),
  )
}

export async function authenticateStaff({
  companyId,
  password,
  userId,
}: {
  companyId: string
  password: string
  userId: string
}) {
  await ensureDefaultAdminStaffMember()
  await migrateLegacySuperAdminStaffMembers()
  const normalizedCompanyId = companyId.trim()
  const normalizedUserId = userId.trim()
  const normalizedPassword = password.trim()
  const staffMembers = await fetchStaffMembers()
  return staffMembers.find(
    (staffMember) =>
      staffMember.enabled &&
      staffMember.companyId === normalizedCompanyId &&
      (staffMember.userId === normalizedUserId || staffMember.loginId === normalizedUserId) &&
      staffMember.password === normalizedPassword,
  ) ?? null
}
