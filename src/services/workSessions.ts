import {
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember, Store, WorkSession } from '../types/work'
import type { WorkLocation } from '../utils/workLocation'

const workSessionsCollectionName = 'workSessions'

const createWorkSessionId = () => `work-${Date.now()}-${crypto.randomUUID()}`

function getWorkSessionRef(workSessionId: string) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, workSessionsCollectionName, workSessionId)
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
    companyId: staffMember.companyId,
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
