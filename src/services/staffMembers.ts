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

const staffMembersCollectionName = 'staffMembers'
const validRoles: StaffRole[] = ['admin', 'manager', 'driver', 'staff']

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
    name: toStringValue(data.name) || '名称未設定のスタッフ',
    role: toRole(data.role),
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
