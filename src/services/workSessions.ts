import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffMember, StaffRole, Store, WorkSession } from '../types/work'
import { getFranchiseeId, getStoreId, isHqRole, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'
import type { QueryConstraint } from 'firebase/firestore'
import type { WorkLocation } from '../utils/workLocation'

const workSessionsCollectionName = 'workSessions'
const staffAttendanceCollectionName = 'staffAttendance'
const activeTripProtectedStatuses = new Set(['走行中', '待機中', '院内付き添い中', '精算前', '精算修正'])

const createWorkSessionId = () => `work-${Date.now()}-${crypto.randomUUID()}`

const validStaffRoles: StaffRole[] = ['hq_admin', 'owner', 'manager', 'driver']

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
    activeTripStatus: toStringValue(data.activeTripStatus) || null,
    activeTripUpdatedAt: toStringValue(data.activeTripUpdatedAt) || null,
    activeTripCaseNumber: toStringValue(data.activeTripCaseNumber) || null,
  }
}

function getWorkSessionRef(workSessionId: string) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, workSessionsCollectionName, workSessionId)
}

const createStaffAttendanceId = ({ companyId, staffId, storeId }: { companyId: string; staffId: string; storeId: string }) =>
  [companyId, storeId, staffId].map((value) => value.replaceAll('/', '_')).join('_')

function getStaffAttendanceRef({ companyId, staffId, storeId }: { companyId: string; staffId: string; storeId: string }) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, staffAttendanceCollectionName, createStaffAttendanceId({ companyId, staffId, storeId }))
}

function getWorkSessionsCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, workSessionsCollectionName)
}

const createWorkingWorkSessionsQuery = (constraints: QueryConstraint[] = []) =>
  query(getWorkSessionsCollection(), where('status', '==', 'working'), ...constraints)

const toTenantCompanyId = (staffMember: Pick<StaffMember, 'companyId' | 'franchiseeId'>) =>
  staffMember.franchiseeId || staffMember.companyId

const matchesStaffWorkSession = ({
  companyId,
  staffId,
  storeId,
  workSession,
}: {
  companyId: string
  staffId: string
  storeId?: string
  workSession: WorkSession
}) =>
  workSession.companyId === companyId &&
  (!storeId || workSession.storeId === storeId) &&
  workSession.staffId === staffId

const findLatestOpenWorkingSession = (workSessions: WorkSession[]) =>
  workSessions
    .filter(isOpenWorkingSession)
    .sort((firstSession, secondSession) =>
      secondSession.clockInAt.localeCompare(firstSession.clockInAt),
    )[0] ?? null


const createWorkSessionTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || isHqRole(scope.role ?? '')) return []

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const constraints: QueryConstraint[] = []

  if (franchiseeId) {
    constraints.push(where('franchiseeId', '==', franchiseeId))
  }

  if (scope.storeId) {
    constraints.push(where('storeId', '==', scope.storeId))
  }

  if (scope.staffId) {
    constraints.push(where('staffId', '==', scope.staffId))
  }

  return constraints
}

export async function fetchClosedWorkSessionsInClockOutRange({
  endIso,
  scope,
  startIso,
}: {
  endIso: string
  scope?: TenantAccessScope
  startIso: string
}) {
  const snapshots = await getDocs(
    query(
      getWorkSessionsCollection(),
      where('status', '==', 'closed'),
      ...createWorkSessionTenantConstraints(scope),
      where('clockOutAt', '>=', startIso),
      where('clockOutAt', '<', endIso),
      orderBy('clockOutAt', 'desc'),
    ),
  )

  return snapshots.docs.map(toWorkSession).filter((session) => matchesTenantScope(session, scope))
}

export async function fetchWorkingWorkSessionCount(scope?: TenantAccessScope) {
  const constraints: QueryConstraint[] = []

  if (scope && !isHqRole(scope.role ?? '')) {
    const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
    if (franchiseeId) {
      constraints.push(where('franchiseeId', '==', franchiseeId))
    }
    if (scope.storeId) {
      constraints.push(where('storeId', '==', scope.storeId))
    }
    if (scope.role === 'driver' && scope.staffId) {
      constraints.push(where('staffId', '==', scope.staffId))
    }
  }

  const snapshots = await getDocs(createWorkingWorkSessionsQuery(constraints))

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
  const constraints: QueryConstraint[] = [
    where('franchiseeId', '==', companyId),
    where('staffId', '==', staffId),
  ]

  if (storeId) {
    constraints.push(where('storeId', '==', storeId))
  }

  const snapshots = await getDocs(createWorkingWorkSessionsQuery(constraints))

  return findLatestOpenWorkingSession(
    snapshots.docs
      .map(toWorkSession)
      .filter((workSession) =>
        matchesStaffWorkSession({ companyId, staffId, storeId, workSession }),
      ),
  )
}

export async function fetchWorkSessionById(workSessionId: string) {
  if (!workSessionId) {
    return null
  }

  const snapshot = await getDoc(getWorkSessionRef(workSessionId))

  return snapshot.exists() ? toWorkSession(snapshot) : null
}

export function subscribeOpenWorkingWorkSession({
  companyId,
  onChange,
  onError,
  staffId,
  storeId,
}: {
  companyId: string
  onChange: (workSession: WorkSession | null) => void
  onError?: (error: Error) => void
  staffId: string
  storeId?: string
}) {
  const constraints: QueryConstraint[] = [
    where('franchiseeId', '==', companyId),
    where('staffId', '==', staffId),
  ]

  if (storeId) {
    constraints.push(where('storeId', '==', storeId))
  }

  return onSnapshot(
    createWorkingWorkSessionsQuery(constraints),
    (snapshots) => {
      console.info(`[workSession] onSnapshot received count: ${snapshots.docs.length}`, {
        companyId,
        staffId,
        storeId: storeId ?? null,
        count: snapshots.docs.length,
      })
      const latestSession = findLatestOpenWorkingSession(
        snapshots.docs
          .map(toWorkSession)
          .filter((workSession) =>
            matchesStaffWorkSession({ companyId, staffId, storeId, workSession }),
          ),
      )
      onChange(latestSession)
    },
    (error) => {
      console.warn('[workSession] onSnapshot error', error)
      onError?.(error)
    },
  )
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
    companyId: toTenantCompanyId(staffMember),
    franchiseeId: toTenantCompanyId(staffMember),
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
    activeTripStatus: null,
    activeTripUpdatedAt: null,
    activeTripCaseNumber: null,
  }

  const attendanceRef = getStaffAttendanceRef({
    companyId: workSession.companyId,
    staffId: workSession.staffId,
    storeId: workSession.storeId,
  })
  const db = getFirestore(getFirebaseApp())

  return runTransaction(db, async (transaction) => {
    const attendanceSnapshot = await transaction.get(attendanceRef)
    const attendanceData = attendanceSnapshot.exists() ? attendanceSnapshot.data() : null
    const existingWorkSessionId = toStringValue(attendanceData?.workSessionId)

    if (attendanceData?.status === 'working' && existingWorkSessionId) {
      const existingWorkSessionRef = getWorkSessionRef(existingWorkSessionId)
      const existingWorkSessionSnapshot = await transaction.get(existingWorkSessionRef)

      if (existingWorkSessionSnapshot.exists()) {
        const existingWorkSession = toWorkSession(existingWorkSessionSnapshot)
        if (isOpenWorkingSession(existingWorkSession)) {
          return existingWorkSession
        }
      }
    }

    transaction.set(getWorkSessionRef(workSession.id), {
      ...workSession,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    transaction.set(attendanceRef, {
      companyId: workSession.companyId,
      franchiseeId: workSession.franchiseeId,
      storeId: workSession.storeId,
      staffId: workSession.staffId,
      status: 'working',
      workSessionId: workSession.id,
      clockInAt: workSession.clockInAt,
      clockOutAt: null,
      updatedAt: serverTimestamp(),
    })

    return workSession
  })
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

  const workSessionRef = getWorkSessionRef(workSession.id)
  const attendanceRef = getStaffAttendanceRef({
    companyId: workSession.companyId,
    staffId: workSession.staffId,
    storeId: workSession.storeId,
  })
  const db = getFirestore(getFirebaseApp())

  await runTransaction(db, async (transaction) => {
    const latestWorkSessionSnapshot = await transaction.get(workSessionRef)
    const latestWorkSession = latestWorkSessionSnapshot.exists()
      ? toWorkSession(latestWorkSessionSnapshot)
      : workSession

    if (latestWorkSession.activeTripStatus && activeTripProtectedStatuses.has(latestWorkSession.activeTripStatus)) {
      throw new Error('運行を終了してから退勤してください')
    }

    transaction.update(workSessionRef, {
      clockOutAt,
      clockOutLatitude: location.latitude,
      clockOutLongitude: location.longitude,
      clockOutAccuracy: location.accuracy,
      workSeconds,
      status: 'closed',
      activeTripStatus: null,
      activeTripUpdatedAt: serverTimestamp(),
      activeTripCaseNumber: null,
      updatedAt: serverTimestamp(),
    })
    transaction.set(attendanceRef, {
      companyId: workSession.companyId,
      franchiseeId: workSession.franchiseeId,
      storeId: workSession.storeId,
      staffId: workSession.staffId,
      status: 'off',
      workSessionId: workSession.id,
      clockInAt: workSession.clockInAt,
      clockOutAt,
      updatedAt: serverTimestamp(),
    })
  })

  return closedSession
}

export async function updateWorkSessionActiveTrip({
  caseNumber,
  status,
  workSessionId,
}: {
  caseNumber?: string
  status: string | null
  workSessionId: string
}) {
  const db = getFirestore(getFirebaseApp())
  await runTransaction(db, async (transaction) => {
    const workSessionRef = getWorkSessionRef(workSessionId)
    const snapshot = await transaction.get(workSessionRef)
    if (!snapshot.exists()) {
      return
    }

    transaction.update(workSessionRef, {
      activeTripStatus: status,
      activeTripUpdatedAt: serverTimestamp(),
      activeTripCaseNumber: status ? caseNumber ?? '' : null,
      updatedAt: serverTimestamp(),
    })
  })
}
