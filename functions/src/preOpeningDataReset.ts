import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  PRE_OPENING_RESET_FIRESTORE_TARGET_KEYS,
  PRE_OPENING_RESET_PRESERVED_CATEGORIES,
  PRE_OPENING_RESET_SCOPED_COLLECTIONS,
  buildAllowlistedStoragePrefixes,
  isAllowlistedScopedCollection,
  isProtectedStoragePath,
} from './preOpeningResetAllowlist'
import {
  assertDevelopmentResetAllowedForFunctions,
} from './developmentResetGuard'

const PRE_OPENING_RESET_CONFIRM_TEXT = 'RESET'
const DELETE_BATCH_SIZE = 450

type PreOpeningResetScope = 'reservations'

const reservationV4AdminToken = defineSecret('RESERVATION_V4_ADMIN_TOKEN')
const reservationV4Origin = defineString('RESERVATION_V4_ORIGIN')

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

const emptyReservationTargets = (): ReservationTargetCounts => ({
  reservations: 0,
  unhandled_reservations: 0,
  confirmed_reservations: 0,
  blocks: 0,
  quotes: 0,
  quote_consents: 0,
  meter_fixed_fare_runs: 0,
  email_logs: 0,
  pre_opening_reset_logs: 0,
})

type ReservationDashboardCounts = {
  totalReservations: number
  unhandledReservations: number
  confirmedReservations: number
}

const emptyFirestoreTargets = (): FirestoreTargetCounts =>
  PRE_OPENING_RESET_FIRESTORE_TARGET_KEYS.reduce<FirestoreTargetCounts>(
    (accumulator, key) => {
      accumulator[key] = 0
      return accumulator
    },
    { storageFiles: 0 },
  )

const buildPreservedPayload = () => ({
  categories: [...PRE_OPENING_RESET_PRESERVED_CATEGORIES],
  accountingProtected: true as const,
  reservationDataUntouched: true as const,
  note: '経理データおよび経理証憑は削除されません。予約データは削除されません。',
})

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const toRole = (value: unknown): StaffRole => {
  if (value === 'hq_admin' || value === 'superAdmin') return 'hq_admin'
  if (value === 'owner' || value === 'manager' || value === 'driver') return value
  return 'driver'
}

type ReservationCapabilityResponse = {
  supported?: boolean
  franchiseeId?: string
  storeId?: string
  targets?: ReservationTargetCounts
  dashboard?: ReservationDashboardCounts
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
  dashboard?: ReservationDashboardCounts
  logId?: number | null
  message?: string
}

const normalizeScopeInput = (data: Record<string, unknown> | undefined) => {
  const franchiseeId = toStringValue(data?.franchiseeId ?? data?.franchisee_id)
  const storeId = toStringValue(data?.storeId ?? data?.store_id)
  if (!franchiseeId || !storeId) {
    throw new HttpsError('invalid-argument', 'franchiseeId と storeId は必須です')
  }
  return { franchiseeId, storeId }
}

const buildCapabilityPath = (
  franchiseeId: string,
  storeId: string,
  resetScope: PreOpeningResetScope,
) =>
  `/api/admin/reservations/pre-opening-reset/capability?franchiseeId=${encodeURIComponent(franchiseeId)}&storeId=${encodeURIComponent(storeId)}&scope=${resetScope}`

const normalizeReservationTargets = (value: unknown): ReservationTargetCounts => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const counts = emptyReservationTargets()
  for (const key of Object.keys(counts)) {
    counts[key] = Number(source[key]) || 0
  }
  for (const [key, raw] of Object.entries(source)) {
    if (!(key in counts)) {
      counts[key] = Number(raw) || 0
    }
  }
  return counts
}

const normalizeReservationDashboard = (
  targets: ReservationTargetCounts,
  dashboard: unknown,
): ReservationDashboardCounts => {
  const source =
    dashboard && typeof dashboard === 'object' ? (dashboard as Record<string, unknown>) : {}
  return {
    totalReservations:
      Number(source.totalReservations ?? source.total_reservations ?? targets.reservations) || 0,
    unhandledReservations:
      Number(
        source.unhandledReservations ??
          source.unhandled_reservations ??
          targets.unhandled_reservations,
      ) || 0,
    confirmedReservations:
      Number(
        source.confirmedReservations ??
          source.confirmed_reservations ??
          targets.confirmed_reservations,
      ) || 0,
  }
}

const sumReservationTargetCounts = (targets: ReservationTargetCounts) =>
  Object.values(targets).reduce((total, count) => total + Number(count || 0), 0)

const assertReservationResetSupported = (capability: {
  supported: boolean
  reservationTargets: ReservationTargetCounts
}) => {
  if (capability.supported) {
    return
  }

  if (sumReservationTargetCounts(capability.reservationTargets) > 0) {
    throw new HttpsError(
      'failed-precondition',
      'reservation-v4 側の開業前予約初期化 API が未対応のため、予約データを削除できません。',
    )
  }
}

const assertReservationResetSucceeded = (reservationResult: ReservationResetResponse) => {
  if (reservationResult.success === true) {
    return
  }

  const message =
    toStringValue(reservationResult.message) || '開業前予約データの初期化に失敗しました。'
  throw new HttpsError('internal', message)
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
  if (!origin) {
    throw new HttpsError(
      'failed-precondition',
      'RESERVATION_V4_ORIGIN が未設定です。Firebase Functions の環境設定を確認してください。',
    )
  }
  if (!token) {
    throw new HttpsError(
      'failed-precondition',
      'RESERVATION_V4_ADMIN_TOKEN が未設定です。Firebase Functions の Secret を確認してください。',
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
      (response.status >= 500
        ? `reservation-v4 管理APIでサーバーエラーが発生しました (${response.status})。`
        : `reservation-v4 API error (${response.status})`)
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

async function countStorageFilesByScope(franchiseeId: string, storeId: string) {
  const bucket = getStorage().bucket()
  const prefixes = buildAllowlistedStoragePrefixes(franchiseeId, storeId).filter(
    (prefix) => !isProtectedStoragePath(prefix),
  )
  const uniquePaths = new Set<string>()
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix })
    files.forEach((file) => {
      if (!isProtectedStoragePath(file.name)) {
        uniquePaths.add(file.name)
      }
    })
  }
  return uniquePaths.size
}

async function countFirestoreTargets(franchiseeId: string, storeId: string) {
  const counts = emptyFirestoreTargets()
  for (const collectionName of PRE_OPENING_RESET_SCOPED_COLLECTIONS) {
    counts[collectionName] = await countCollectionByScope(collectionName, franchiseeId, storeId)
  }
  counts.caseCounters = await countCaseCountersByStore(storeId)
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
  if (!isAllowlistedScopedCollection(collectionName)) {
    throw new HttpsError(
      'failed-precondition',
      `許可リスト外のコレクションは削除できません: ${collectionName}`,
    )
  }

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

async function deleteStorageFilesByScope(franchiseeId: string, storeId: string) {
  const bucket = getStorage().bucket()
  const prefixes = buildAllowlistedStoragePrefixes(franchiseeId, storeId).filter(
    (prefix) => !isProtectedStoragePath(prefix),
  )
  const uniqueFiles = new Map<string, ReturnType<typeof bucket.file>>()
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix })
    files.forEach((file) => {
      if (isProtectedStoragePath(file.name)) {
        return
      }
      uniqueFiles.set(file.name, file)
    })
  }
  await Promise.all([...uniqueFiles.values()].map((file) => file.delete()))
  return uniqueFiles.size
}

async function deleteFirestoreScopedData(franchiseeId: string, storeId: string) {
  const deleted = emptyFirestoreTargets()
  for (const collectionName of PRE_OPENING_RESET_SCOPED_COLLECTIONS) {
    deleted[collectionName] = await deleteCollectionByScope(collectionName, franchiseeId, storeId)
  }
  deleted.caseCounters = await deleteCaseCountersByStore(storeId)
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

async function fetchReservationResetCapability(
  franchiseeId: string,
  storeId: string,
  resetScope: PreOpeningResetScope,
) {
  const capability = await callReservationV4AdminApi<ReservationCapabilityResponse>(
    buildCapabilityPath(franchiseeId, storeId, resetScope),
    { method: 'GET' },
  )
  const reservationTargets = normalizeReservationTargets(capability.targets)
  return {
    supported: capability.supported === true,
    reservationTargets,
    dashboard: normalizeReservationDashboard(reservationTargets, capability.dashboard),
  }
}

async function executeReservationReset({
  franchiseeId,
  storeId,
  executedBy,
  resetScope,
}: {
  franchiseeId: string
  storeId: string
  executedBy: string
  resetScope: PreOpeningResetScope
}) {
  const capability = await fetchReservationResetCapability(franchiseeId, storeId, resetScope)
  assertReservationResetSupported(capability)

  const reservationResult = await callReservationV4AdminApi<ReservationResetResponse>(
    '/api/admin/reservations/pre-opening-reset',
    {
      method: 'POST',
      body: {
        franchiseeId,
        storeId,
        confirmText: PRE_OPENING_RESET_CONFIRM_TEXT,
        executedBy,
        scope: resetScope,
      },
    },
  )

  assertReservationResetSucceeded(reservationResult)

  const deletedReservation = normalizeReservationTargets(reservationResult.deleted)
  const failedReservation = normalizeReservationTargets(reservationResult.failed)
  const targets = normalizeReservationTargets(
    reservationResult.targets ?? capability.reservationTargets,
  )
  const dashboard = normalizeReservationDashboard(targets, reservationResult.dashboard)

  return {
    capability,
    reservationResult,
    deletedReservation,
    failedReservation,
    targets,
    dashboard,
  }
}

/** Meter-side capability: Firestore/Storage counts only. Does not call reservation-v4. */
export const getPreOpeningResetCapability = onCall(
  {
    region: 'asia-northeast1',
  },
  async (request) => {
    try {
      assertDevelopmentResetAllowedForFunctions()
    } catch (error) {
      throw new HttpsError(
        'failed-precondition',
        error instanceof Error ? error.message : '開発データリセットが許可されていません。',
      )
    }
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)

    const firestoreTargets = await countFirestoreTargets(scope.franchiseeId, scope.storeId)

    return {
      supported: true,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      targets: {
        firestore: firestoreTargets,
      },
      preserved: buildPreservedPayload(),
    }
  },
)

export const getPreOpeningReservationResetCapability = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    try {
      assertDevelopmentResetAllowedForFunctions()
    } catch (error) {
      throw new HttpsError(
        'failed-precondition',
        error instanceof Error ? error.message : '開発データリセットが許可されていません。',
      )
    }
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)

    const reservationCapability = await fetchReservationResetCapability(
      scope.franchiseeId,
      scope.storeId,
      'reservations',
    )

    return {
      supported: reservationCapability.supported,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      targets: {
        reservation: reservationCapability.reservationTargets,
      },
      dashboard: reservationCapability.dashboard,
    }
  },
)

/** Meter-side reset: sales/operations only. Does not call reservation-v4. */
export const executePreOpeningDataReset = onCall(
  {
    region: 'asia-northeast1',
  },
  async (request) => {
    try {
      assertDevelopmentResetAllowedForFunctions()
    } catch (error) {
      throw new HttpsError(
        'failed-precondition',
        error instanceof Error ? error.message : '開発データリセットが許可されていません。',
      )
    }
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
    const firestoreTargets = await countFirestoreTargets(scope.franchiseeId, scope.storeId)
    const deletedFirestore = await deleteFirestoreScopedData(scope.franchiseeId, scope.storeId)

    return {
      success: true,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      executedAt: new Date().toISOString(),
      targets: {
        firestore: firestoreTargets,
      },
      deleted: {
        firestore: deletedFirestore,
      },
      failed: {
        firestore: buildFailedFirestoreCounts(firestoreTargets, deletedFirestore),
      },
      preserved: buildPreservedPayload(),
    }
  },
)

export const executePreOpeningReservationReset = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    try {
      assertDevelopmentResetAllowedForFunctions()
    } catch (error) {
      throw new HttpsError(
        'failed-precondition',
        error instanceof Error ? error.message : '開発データリセットが許可されていません。',
      )
    }
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

    const reservationReset = await executeReservationReset({
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      resetScope: 'reservations',
    })

    return {
      success: true,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      executedAt:
        reservationReset.reservationResult.executedAt ?? new Date().toISOString(),
      targets: {
        reservation: reservationReset.targets,
      },
      deleted: {
        reservation: reservationReset.deletedReservation,
      },
      failed: {
        reservation: reservationReset.failedReservation,
      },
      dashboard: reservationReset.dashboard,
      reservationLogId: reservationReset.reservationResult.logId ?? null,
      reservationSupported: reservationReset.capability.supported,
    }
  },
)
