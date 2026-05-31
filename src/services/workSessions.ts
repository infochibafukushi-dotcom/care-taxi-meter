import {
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember, Store, Vehicle, WorkSession } from '../types/work'
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
  store,
  vehicle,
}: {
  location: WorkLocation
  staffMember: StaffMember
  store: Store
  vehicle: Vehicle
}) {
  const clockInAt = new Date().toISOString()
  const workSession: WorkSession = {
    id: createWorkSessionId(),
    storeId: store.id,
    storeName: store.name,
    staffId: staffMember.id,
    staffName: staffMember.name,
    staffRole: staffMember.role,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    vehicleNumber: vehicle.number,
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
