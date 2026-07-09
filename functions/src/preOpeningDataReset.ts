import { createHash } from 'crypto'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'

const PRE_OPENING_RESET_CONFIRM_TEXT = 'RESET'
const DELETE_BATCH_SIZE = 450

const reservationV4AdminToken = defineSecret('RESERVATION_V4_ADMIN_TOKEN')
const reservationV4Origin = defineString('RESERVATION_V4_ORIGIN')

const SCOPED_TENANT_COLLECTIONS = [
  'caseRecords',
  'workSessions',
  'auditLogs',
  'accountingReceipts',
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'maintenanceLogs',
  'adminActionLogs',
  'operationLogs',
  'debugLogs',
  'errorLogs',
  'resetLogs',
] as const

type StaffRole = 'driver' | 'manager' | 'owner' | 'hq_admin'

type ResetRoleContext = {
  uid: string
  role: StaffRole
  franchiseeId: string
  storeId: string
}

type ReservationTargetCounts = Record<string, number>

type FirestoreTargetCounts = Record<string, number> & {
  storageFiles: number
}

type ResetTargets = {
  firestore: FirestoreTargetCounts
  reservation: ReservationTargetCounts
}

const emptyReservationTargets = (): ReservationTargetCounts => ({
  reservations: 0,
  blocks: 0,
  quotes: 0,
  quote_consents: 0,
  meter_fixed_fare_runs: 0,
  email_logs: 0,
  pre_opening_reset_logs: 0,
})

const emptyFirestoreTargets = (): FirestoreTargetCounts => {
  const counts = SCOPED_TENANT_COLLECTIONS.reduce<FirestoreTargetCounts>(
    (accumulator, collectionName) => {
      accumulator[collectionName] = 0
      return accumulator
    },
    { storageFiles: 0 },
  )
  counts.caseCounters = 0
  counts.staffAttendance = 0
  counts.loginAttempts = 0
  return counts
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const toRole = (value: unknown): StaffRole => {
  if (value === 'hq_admin' || value === 'superAdmin') return 'hq_admin'
  if (value === 'owner' || value === 'manager' || value === 'driver') return value
  return 'driver'
}

const normalizeLoginIdentifier = (value: string) => value.trim().replace(/[\s\u3000]+/g, '')

const buildLoginAttemptId = (companyId: string, userId: string) =>
  createHash('sha256')
    .update(`${companyId.trim()}\0${normalizeLoginIdentifier(userId)}`)
    .digest('hex')

const buildStaffAttendanceId = ({
  companyId,
  staffId,
  storeId,
}: {
  companyId: string
  staffId: string
  storeId: string
}) => [companyId, storeId, staffId].map((value) => value.replaceAll('/', '_')).join('_')

const normalizeScopeInput = (data: Record<string, unknown> | undefined) => {
  const franchiseeId = toStringValue(data?.franchiseeId ?? data?.franchisee_id)
  const storeId = toStringValue(data?.storeId ?? data?.store_id)
  if (!franchiseeId || !storeId) {
    throw new HttpsError('invalid-argument', 'franchiseeId と storeId は必須です')
  }
  return { franchiseeId, storeId }
}

const assertCallableAuth = (request: CallableRequest<Record<string, unknown>>): ResetRoleContext => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ログインが必要です')
  }

  const role = toRole(request.auth.token.role)
  if (role !== 'owner' && role !== 'hq_admin') {
    throw new HttpsError(
      'permission-denied',
      '開業前テストデータ初期化は owner または hq_admin のみ実行できます',
    )
  }

  return {
    uid: request.auth.uid,
    role,
    franchiseeId: toStringValue(request.auth.token.franchiseeId ?? request.auth.token.companyId),
    storeId: toStringValue(request.auth.token.storeId),
  }
}

const assertScopeAuthorized = async (
  auth: ResetRoleContext,
  scope: { franchiseeId: string; storeId: string },
) => {
  if (auth.role === 'hq_admin') {
    return
  }

  if (scope.franchiseeId !== auth.franchiseeId) {
    throw new HttpsError('permission-denied', '他加盟店のデータは初期化できません')
  }

  const db = getFirestore()
  const storeSnapshot = await db.collection('stores').doc(scope.storeId).get()
  if (!storeSnapshot.exists) {
    throw new HttpsError('not-found', '店舗が見つかりません')
  }

  const storeData = storeSnapshot.data() ?? {}
  const storeFranchiseeId =
    toStringValue(storeData.franchiseeId) || toStringValue(storeData.companyId)
  if (storeFranchiseeId !== auth.franchiseeId) {
    throw new HttpsError('permission-denied', 'この店舗は操作できません')
  }
}

const getReservationV4Config = () => {
  const origin = reservationV4Origin.value().trim().replace(/\/+$/, '')
  const token = reservationV4AdminToken.value().trim()
  if (!origin || !token) {
    throw new HttpsError(
      'failed-precondition',
      'reservation-v4 管理APIの接続設定が未完了です',
    )
  }
  return { origin, token }
}

async function callReservationV4AdminApi<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
): Promise<T> {
  const { origin, token } = getReservationV4Config()
  const response = await fetch(`${origin}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })

  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    payload = {}
  }

  if (response.status === 401) {
    throw new HttpsError(
      'permission-denied',
      'reservation-v4 管理APIの認証に失敗しました。サーバー設定を確認してください。',
    )
  }

  if (!response.ok) {
    const message =
      toStringValue(payload.message) ||
      `reservation-v4 API error (${response.status})`
    throw new HttpsError('internal', message)
  }

  return payload as T
}

async function countCollectionByScope(
  collectionName: string,
  franchiseeId: string,
  storeId: string,
) {
  const db = getFirestore()
  const snapshot = await db
    .collection(collectionName)
    .where('franchiseeId', '==', franchiseeId)
    .where('storeId', '==', storeId)
    .count()
    .get()
  return Number(snapshot.data().count || 0)
}

async function countCaseCountersByStore(storeId: string) {
  const db = getFirestore()
  const prefix = `${storeId}_`
  const snapshot = await db
    .collection('caseCounters')
    .where(FieldPath.documentId(), '>=', prefix)
    .where(FieldPath.documentId(), '<', `${storeId}_\uf8ff`)
    .count()
    .get()
  return Number(snapshot.data().count || 0)
}

async function loadStaffDocsForScope(franchiseeId: string, storeId: string) {
  const db = getFirestore()
  const primarySnapshot = await db
    .collection('staffMembers')
    .where('franchiseeId', '==', franchiseeId)
    .where('storeId', '==', storeId)
    .get()
  if (!primarySnapshot.empty) {
    return primarySnapshot.docs
  }
  const legacySnapshot = await db
    .collection('staffMembers')
    .where('companyId', '==', franchiseeId)
    .where('storeId', '==', storeId)
    .get()
  return legacySnapshot.docs
}

async function countStaffAttendanceByScope(franchiseeId: string, storeId: string) {
  const staffDocs = await loadStaffDocsForScope(franchiseeId, storeId)
  if (staffDocs.length === 0) {
    return 0
  }

  const db = getFirestore()
  let count = 0
  for (const staffDoc of staffDocs) {
    const staffData = staffDoc.data()
    const companyId =
      toStringValue(staffData.franchiseeId) || toStringValue(staffData.companyId) || franchiseeId
    const staffId = toStringValue(staffData.id) || staffDoc.id
    const attendanceId = buildStaffAttendanceId({ companyId, staffId, storeId })
    const attendanceSnapshot = await db.collection('staffAttendance').doc(attendanceId).get()
    if (attendanceSnapshot.exists) {
      count += 1
    }
  }
  return count
}

async function countLoginAttemptsByScope(franchiseeId: string, storeId: string) {
  const staffDocs = await loadStaffDocsForScope(franchiseeId, storeId)
  if (staffDocs.length === 0) {
    return 0
  }

  const db = getFirestore()
  let count = 0
  for (const staffDoc of staffDocs) {
    const staffData = staffDoc.data()
    const companyId =
      toStringValue(staffData.franchiseeId) || toStringValue(staffData.companyId) || franchiseeId
    const identifiers = [
      toStringValue(staffData.userId),
      toStringValue(staffData.loginId),
      toStringValue(staffData.name),
      staffDoc.id,
    ].filter(Boolean)
    const uniqueIds = [...new Set(identifiers)]
    for (const identifier of uniqueIds) {
      const attemptId = buildLoginAttemptId(companyId, identifier)
      const attemptSnapshot = await db.collection('loginAttempts').doc(attemptId).get()
      if (attemptSnapshot.exists) {
        count += 1
      }
    }
  }
  return count
}

async function countStorageFilesByScope(franchiseeId: string, storeId: string) {
  const bucket = getStorage().bucket()
  const prefixes = [
    `accounting/${franchiseeId}/${storeId}/`,
    `operations/${franchiseeId}/${storeId}/`,
    `receipts/${franchiseeId}/${storeId}/`,
  ]
  const uniquePaths = new Set<string>()
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix })
    files.forEach((file) => uniquePaths.add(file.name))
  }
  return uniquePaths.size
}

async function countFirestoreTargets(franchiseeId: string, storeId: string) {
  const counts = emptyFirestoreTargets()
  for (const collectionName of SCOPED_TENANT_COLLECTIONS) {
    counts[collectionName] = await countCollectionByScope(collectionName, franchiseeId, storeId)
  }
  counts.caseCounters = await countCaseCountersByStore(storeId)
  counts.staffAttendance = await countStaffAttendanceByScope(franchiseeId, storeId)
  counts.loginAttempts = await countLoginAttemptsByScope(franchiseeId, storeId)
  try {
    counts.storageFiles = await countStorageFilesByScope(franchiseeId, storeId)
  } catch {
    counts.storageFiles = 0
  }
  return counts
}

async function deleteGpsRouteForCase(caseRef: FirebaseFirestore.DocumentReference) {
  const db = getFirestore()
  const summaryRef = caseRef.collection('gpsRoute').doc('summary')
  const chunkRefs = await summaryRef.collection('chunks').listDocuments()
  if (chunkRefs.length > 0) {
    const batch = db.batch()
    chunkRefs.forEach((chunkRef) => batch.delete(chunkRef))
    await batch.commit()
  }
  await summaryRef.delete()
}

async function deleteCollectionByScope(
  collectionName: string,
  franchiseeId: string,
  storeId: string,
) {
  const db = getFirestore()
  let deletedCount = 0

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where('franchiseeId', '==', franchiseeId)
      .where('storeId', '==', storeId)
      .limit(DELETE_BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      return deletedCount
    }

    if (collectionName === 'caseRecords') {
      for (const docSnapshot of snapshot.docs) {
        await deleteGpsRouteForCase(docSnapshot.ref)
        await docSnapshot.ref.delete()
        deletedCount += 1
      }
      continue
    }

    const batch = db.batch()
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    await batch.commit()
    deletedCount += snapshot.size

    if (snapshot.size < DELETE_BATCH_SIZE) {
      return deletedCount
    }
  }
}

async function deleteCaseCountersByStore(storeId: string) {
  const db = getFirestore()
  const prefix = `${storeId}_`
  let deletedCount = 0

  while (true) {
    const snapshot = await db
      .collection('caseCounters')
      .where(FieldPath.documentId(), '>=', prefix)
      .where(FieldPath.documentId(), '<', `${storeId}_\uf8ff`)
      .limit(DELETE_BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      return deletedCount
    }

    const batch = db.batch()
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    await batch.commit()
    deletedCount += snapshot.size

    if (snapshot.size < DELETE_BATCH_SIZE) {
      return deletedCount
    }
  }
}

async function deleteStaffAttendanceByScope(franchiseeId: string, storeId: string) {
  const db = getFirestore()
  const staffDocs = await loadStaffDocsForScope(franchiseeId, storeId)

  let deletedCount = 0
  for (const staffDoc of staffDocs) {
    const staffData = staffDoc.data()
    const companyId =
      toStringValue(staffData.franchiseeId) || toStringValue(staffData.companyId) || franchiseeId
    const staffId = toStringValue(staffData.id) || staffDoc.id
    const attendanceId = buildStaffAttendanceId({ companyId, staffId, storeId })
    const attendanceRef = db.collection('staffAttendance').doc(attendanceId)
    const attendanceSnapshot = await attendanceRef.get()
    if (attendanceSnapshot.exists) {
      await attendanceRef.delete()
      deletedCount += 1
    }
  }
  return deletedCount
}

async function deleteLoginAttemptsByScope(franchiseeId: string, storeId: string) {
  const db = getFirestore()
  const staffDocs = await loadStaffDocsForScope(franchiseeId, storeId)

  let deletedCount = 0
  for (const staffDoc of staffDocs) {
    const staffData = staffDoc.data()
    const companyId =
      toStringValue(staffData.franchiseeId) || toStringValue(staffData.companyId) || franchiseeId
    const identifiers = [
      toStringValue(staffData.userId),
      toStringValue(staffData.loginId),
      toStringValue(staffData.name),
      staffDoc.id,
    ].filter(Boolean)
    const uniqueIds = [...new Set(identifiers)]
    for (const identifier of uniqueIds) {
      const attemptId = buildLoginAttemptId(companyId, identifier)
      const attemptRef = db.collection('loginAttempts').doc(attemptId)
      const attemptSnapshot = await attemptRef.get()
      if (attemptSnapshot.exists) {
        await attemptRef.delete()
        deletedCount += 1
      }
    }
  }
  return deletedCount
}

async function deleteStorageFilesByScope(franchiseeId: string, storeId: string) {
  const bucket = getStorage().bucket()
  const prefixes = [
    `accounting/${franchiseeId}/${storeId}/`,
    `operations/${franchiseeId}/${storeId}/`,
    `receipts/${franchiseeId}/${storeId}/`,
  ]
  const uniqueFiles = new Map<string, ReturnType<typeof bucket.file>>()
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix })
    files.forEach((file) => {
      uniqueFiles.set(file.name, file)
    })
  }
  await Promise.all([...uniqueFiles.values()].map((file) => file.delete()))
  return uniqueFiles.size
}

async function deleteFirestoreScopedData(franchiseeId: string, storeId: string) {
  const deleted = emptyFirestoreTargets()
  for (const collectionName of SCOPED_TENANT_COLLECTIONS) {
    deleted[collectionName] = await deleteCollectionByScope(collectionName, franchiseeId, storeId)
  }
  deleted.caseCounters = await deleteCaseCountersByStore(storeId)
  deleted.staffAttendance = await deleteStaffAttendanceByScope(franchiseeId, storeId)
  deleted.loginAttempts = await deleteLoginAttemptsByScope(franchiseeId, storeId)
  try {
    deleted.storageFiles = await deleteStorageFilesByScope(franchiseeId, storeId)
  } catch {
    deleted.storageFiles = 0
  }
  return deleted
}

function buildFailedFirestoreCounts(
  targets: FirestoreTargetCounts,
  deleted: FirestoreTargetCounts,
) {
  const failed = emptyFirestoreTargets()
  for (const key of Object.keys(targets)) {
    failed[key] = Math.max(0, Number(targets[key] || 0) - Number(deleted[key] || 0))
  }
  return failed
}

type ReservationCapabilityResponse = {
  supported?: boolean
  franchiseeId?: string
  storeId?: string
  targets?: ReservationTargetCounts
}

type ReservationResetResponse = {
  success?: boolean
  franchiseeId?: string
  storeId?: string
  executedBy?: string
  executedAt?: string
  targets?: ReservationTargetCounts
  deleted?: ReservationTargetCounts
  failed?: ReservationTargetCounts
  logId?: number | null
  message?: string
}

export const getPreOpeningResetCapability = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)

    const [firestoreTargets, reservationCapability] = await Promise.all([
      countFirestoreTargets(scope.franchiseeId, scope.storeId),
      callReservationV4AdminApi<ReservationCapabilityResponse>(
        `/api/admin/reservations/pre-opening-reset/capability?franchiseeId=${encodeURIComponent(scope.franchiseeId)}&storeId=${encodeURIComponent(scope.storeId)}`,
        { method: 'GET' },
      ),
    ])

    return {
      supported: reservationCapability.supported === true,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      targets: {
        firestore: firestoreTargets,
        reservation: reservationCapability.targets ?? emptyReservationTargets(),
      },
    }
  },
)

export const executePreOpeningDataReset = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)

    const confirmText = toStringValue(request.data?.confirmText)
    if (confirmText !== PRE_OPENING_RESET_CONFIRM_TEXT) {
      throw new HttpsError(
        'invalid-argument',
        'confirmText が不正です。RESET を指定してください。',
      )
    }

    const executedBy = toStringValue(request.data?.executedBy) || auth.uid

    const targets: ResetTargets = {
      firestore: await countFirestoreTargets(scope.franchiseeId, scope.storeId),
      reservation: emptyReservationTargets(),
    }

    const capability = await callReservationV4AdminApi<ReservationCapabilityResponse>(
      `/api/admin/reservations/pre-opening-reset/capability?franchiseeId=${encodeURIComponent(scope.franchiseeId)}&storeId=${encodeURIComponent(scope.storeId)}`,
      { method: 'GET' },
    )
    targets.reservation = capability.targets ?? emptyReservationTargets()

    const deletedFirestore = await deleteFirestoreScopedData(
      scope.franchiseeId,
      scope.storeId,
    )

    const reservationResult = await callReservationV4AdminApi<ReservationResetResponse>(
      '/api/admin/reservations/pre-opening-reset',
      {
        method: 'POST',
        body: {
          franchiseeId: scope.franchiseeId,
          storeId: scope.storeId,
          confirmText: PRE_OPENING_RESET_CONFIRM_TEXT,
          executedBy,
        },
      },
    )

    const deletedReservation = reservationResult.deleted ?? emptyReservationTargets()
    const failedReservation = reservationResult.failed ?? emptyReservationTargets()

    return {
      success: reservationResult.success === true,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      executedAt: reservationResult.executedAt ?? new Date().toISOString(),
      targets,
      deleted: {
        firestore: deletedFirestore,
        reservation: deletedReservation,
      },
      failed: {
        firestore: buildFailedFirestoreCounts(targets.firestore, deletedFirestore),
        reservation: failedReservation,
      },
      reservationLogId: reservationResult.logId ?? null,
      reservationSupported: capability.supported === true,
    }
  },
)
