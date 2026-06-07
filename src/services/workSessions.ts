import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember, StaffRole, Store, WorkSession } from '../types/work'
import { getFranchiseeId, getStoreId, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'
import type { WorkLocation } from '../utils/workLocation'

const workSessionsCollectionName = 'workSessions'

const createWorkSessionId = () => `work-${Date.now()}-${crypto.randomUUID()}`

const validStaffRoles: StaffRole[] = ['superAdmin', 'owner', 'manager', 'driver']

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toNullableNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const toStaffRole = (value: unknown): StaffRole =>
  typeof value === 'string' && validStaffRoles.includes(value as StaffRole)
    ? (value as StaffRole)
    : 'driver'

const isOpenWorkingSession = (workSession: WorkSession) =>
  workSession.status === 'working' && !workSession.clockOutAt

const toWorkSession = (snapshot: {
  id: string
  data: () => Record<string, unknown>
}): WorkSession => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    companyId: getFranchiseeId(data),
    franchiseeId: getFranchiseeId(data),
    companyName: toStringValue(data.companyName),
    storeId: getStoreId(data),
    storeName: toStringValue(data.storeName),
    staffId: toStringValue(data.staffId),
    staffName: toStringValue(data.staffName),
    staffRole: toStaffRole(data.staffRole),
    clockInAt: toStringValue(data.clockInAt),
    clockOutAt: toStringValue(data.clockOutAt) || null,
    workSeconds: typeof data.workSeconds === 'number' ? data.workSeconds : 0,
    clockInLatitude: toNullableNumber(data.clockInLatitude),
    clockInLongitude: toNullableNumber(data.clockInLongitude),
    clockInAccuracy: toNullableNumber(data.clockInAccuracy),
    clockOutLatitude: toNullableNumber(data.clockOutLatitude),
    clockOutLongitude: toNullableNumber(data.clockOutLongitude),
    clockOutAccuracy: toNullableNumber(data.clockOutAccuracy),
    status: data.status === 'closed' ? 'closed' : 'working',
  }
}

function getWorkSessionRef(workSessionId: string) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, workSessionsCollectionName, workSessionId)
}

function getWorkSessionsCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, workSessionsCollectionName)
}

export async function fetchWorkingWorkSessionCount(scope?: TenantAccessScope) {
  const snapshots = await getDocs(
    query(getWorkSessionsCollection(), where('status', '==', 'working')),
  )

  return snapshots.docs.map(toWorkSession).filter(isOpenWorkingSession).filter((session) => matchesTenantScope(session, scope)).length
}

export async function fetchOpenWorkingWorkSession({
  companyId,
  staffId,
  storeId,
}: {
  companyId: string
  staffId: string
  storeId?: string
}) {
  const snapshots = await getDocs(
    query(getWorkSessionsCollection(), where('status', '==', 'working')),
  )

  return snapshots.docs
    .map(toWorkSession)
    .filter(
      (workSession) =>
        workSession.companyId === companyId &&
        (!storeId || workSession.storeId === storeId) &&
        workSession.staffId === staffId &&
        isOpenWorkingSession(workSession),
    )
    .sort((firstSession, secondSession) =>
      secondSession.clockInAt.localeCompare(firstSession.clockInAt),
    )[0] ?? null
}

export async function clockInWorkSession({
  location,
  staffMember,
  companyName = '',
  store,
}: {
  companyName?: string
  location: WorkLocation
  staffMember: StaffMember
  store: Store
}) {
  const clockInAt = new Date().toISOString()
  const workSession: WorkSession = {
    id: createWorkSessionId(),
    companyId: staffMember.franchiseeId || staffMember.companyId,
    franchiseeId: staffMember.franchiseeId || staffMember.companyId,
    companyName,
    storeId: store.id,
    storeName: store.name,
    staffId: staffMember.id,
    staffName: staffMember.name,
    staffRole: staffMember.role,
    clockInAt,
    clockOutAt: null,
    workSeconds: 0,
    clockInLatitude: location.latitude,
    clockInLongitude: location.longitude,
    clockInAccuracy: location.accuracy,
    clockOutLatitude: null,
    clockOutLongitude: null,
    clockOutAccuracy: null,
    status: 'working',
  }

  await setDoc(getWorkSessionRef(workSession.id), {
    ...workSession,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return workSession
}

export async function clockOutWorkSession({
  location,
  workSession,
}: {
  location: WorkLocation
  workSession: WorkSession
}) {
  const clockOutAt = new Date().toISOString()
  const workSeconds = Math.max(
    Math.floor((new Date(clockOutAt).getTime() - new Date(workSession.clockInAt).getTime()) / 1000),
    0,
  )
  const closedSession: WorkSession = {
    ...workSession,
    clockOutAt,
    workSeconds,
    clockOutLatitude: location.latitude,
    clockOutLongitude: location.longitude,
    clockOutAccuracy: location.accuracy,
    status: 'closed',
  }

  await updateDoc(getWorkSessionRef(workSession.id), {
    clockOutAt,
    clockOutLatitude: location.latitude,
    clockOutLongitude: location.longitude,
    clockOutAccuracy: location.accuracy,
    workSeconds,
    status: 'closed',
    updatedAt: serverTimestamp(),
  })

  return closedSession
}
