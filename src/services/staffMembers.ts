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
import { defaultCompanyId } from './stores'

const staffMembersCollectionName = 'staffMembers'
const validRoles: StaffRole[] = ['superAdmin', 'owner', 'manager', 'driver']

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
    companyId: toStringValue(data.companyId) || defaultCompanyId,
    storeId: toStringValue(data.storeId),
    storeName: toStringValue(data.storeName),
    userId: toStringValue(data.userId),
    password: toStringValue(data.password),
    name: toStringValue(data.name) || '名称未設定のスタッフ',
    role: toRole(data.role),
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

export async function fetchStaffMembers() {
  const snapshots = await getDocs(
    query(getStaffMembersCollection(), orderBy('sortOrder', 'asc')),
  )

  return snapshots.docs.map(toStaffMember)
}

export async function saveStaffMember(staffMember: StaffMember) {
  const db = getFirestore(getFirebaseApp())
  const staffMemberRef = doc(db, staffMembersCollectionName, staffMember.id)
  const snapshot = await getDoc(staffMemberRef)
  const document = {
    ...staffMember,
    ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  await setDoc(staffMemberRef, document, { merge: true })
  return staffMember
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
  const staffMembers = await fetchStaffMembers()
  return staffMembers.find(
    (staffMember) =>
      staffMember.enabled &&
      staffMember.companyId === companyId &&
      staffMember.userId === userId &&
      staffMember.password === password,
  ) ?? null
}
