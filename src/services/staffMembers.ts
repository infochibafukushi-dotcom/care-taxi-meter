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
import { getFranchiseeId, getStoreId, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'

const staffMembersCollectionName = 'staffMembers'
const validRoles: StaffRole[] = ['driver', 'manager', 'owner', 'superAdmin']

export const defaultAdminStaffMemberId = 'staff_admin'
export const defaultAdminStaffUserId = 'admin'
export const defaultAdminStaffPassword = 'admin123'

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const toRole = (value: unknown): StaffRole =>
  typeof value === 'string' && validRoles.includes(value as StaffRole)
    ? (value as StaffRole)
    : 'driver'

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
    password: toStringValue(data.password),
    name: toStringValue(data.name) || '名称未設定のスタッフ',
    role: toRole(data.role),
    canDrive: toBooleanValue(data.canDrive, toRole(data.role) === 'owner' || toRole(data.role) === 'driver'),
    isActive: toBooleanValue(data.isActive ?? data.enabled),
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

export async function saveStaffMember(staffMember: StaffMember) {
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

  await setDoc(staffMemberRef, document, { merge: true })
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
      existingStaffMember.name === '山本信勝'
    ) {
      const migratedStaffMember: StaffMember = {
        ...existingStaffMember,
        name: '山本信勝',
        userId: defaultAdminStaffUserId,
        role: 'superAdmin',
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
    role: 'superAdmin',
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
      staffMember.userId === defaultAdminStaffUserId || staffMember.name === '山本信勝',
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
          role: 'superAdmin',
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
  const staffMembers = await fetchStaffMembers()
  return staffMembers.find(
    (staffMember) =>
      staffMember.enabled &&
      staffMember.companyId === companyId &&
      staffMember.userId === userId &&
      staffMember.password === password,
  ) ?? null
}
