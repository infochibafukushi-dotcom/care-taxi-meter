import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  PRE_OPENING_RESET_FIRESTORE_TARGET_KEYS,
  PRE_OPENING_RESET_PRESERVED_CATEGORIES,
  PRE_OPENING_RESET_SCOPED_COLLECTIONS,
  PRE_OPENING_RESET_STATE_COLLECTION,
  buildAllowlistedStoragePrefixes,
  buildPreOpeningResetStateDocId,
  isAllowlistedScopedCollection,
  isProtectedStoragePath,
} from './preOpeningResetAllowlist'
import {
  evaluatePreOpeningResetEligibility,
  matchesStoreIdConfirmText,
} from './preOpeningResetGuard'

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

type CategorySummaryCounts = {
  salesOperations: number
  reservationsCustomers: number
  attendance: number
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
  reservationBlocksProtected: true as const,
  mastersProtected: true as const,
  auditLogsProtected: true as const,
  note: '経理・加盟店・店舗・スタッフ・予約ブロック・料金/車両/設定・監査/認証ログは削除しません。',
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
  preOpeningAllowed?: boolean
  locked?: boolean
  message?: string
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
  locked?: boolean
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

const sumReservationDeleteTargets = (targets: ReservationTargetCounts) =>
  Number(targets.reservations || 0) +
  Number(targets.quotes || 0) +
  Number(targets.quote_consents || 0) +
  Number(targets.email_logs || 0) +
  Number(targets.meter_fixed_fare_runs || 0) +
  Number(targets.pre_opening_reset_logs || 0)

const buildCategorySummary = (
  firestore: FirestoreTargetCounts,
  reservation: ReservationTargetCounts,
): CategorySummaryCounts => ({
  salesOperations:
    Number(firestore.caseRecords || 0) +
    Number(firestore.caseCounters || 0) +
    Number(firestore.storageFiles || 0),
  reservationsCustomers: sumReservationDeleteTargets(reservation),
  attendance:
    Number(firestore.workSessions || 0) + Number(firestore.staffAttendance || 0),
})

const assertReservationResetSupported = (capability: {
  supported: boolean
  reservationTargets: ReservationTargetCounts
}) => {
  if (capability.supported) {
    return
  }

  if (sumReservationDeleteTargets(capability.reservationTargets) > 0) {
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
      '開業前データリセットは owner または hq_admin のみ実行できます',
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

async function readCompanyStatus(franchiseeId: string): Promise<string> {
  const db = getFirestore()
  const snapshot = await db.collection('companies').doc(franchiseeId).get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', '加盟店が見つかりません')
  }
  const data = snapshot.data() ?? {}
  return toStringValue(data.status) || (data.enabled === false ? 'suspended' : 'active')
}

async function readResetLockState(franchiseeId: string, storeId: string): Promise<boolean> {
  const db = getFirestore()
  const docId = buildPreOpeningResetStateDocId(franchiseeId, storeId)
  const snapshot = await db.collection(PRE_OPENING_RESET_STATE_COLLECTION).doc(docId).get()
  if (!snapshot.exists) {
    return false
  }
  return snapshot.data()?.locked === true
}

async function assertPreOpeningResetAllowed(franchiseeId: string, storeId: string) {
  const companyStatus = await readCompanyStatus(franchiseeId)
  const locked = await readResetLockState(franchiseeId, storeId)
  const decision = evaluatePreOpeningResetEligibility({ companyStatus, locked })
  if (!decision.allowed) {
    throw new HttpsError('failed-precondition', decision.reason)
  }
  return decision
}

async function writeResetLockState({
  franchiseeId,
  storeId,
  executedBy,
}: {
  franchiseeId: string
  storeId: string
  executedBy: string
}) {
  const db = getFirestore()
  const docId = buildPreOpeningResetStateDocId(franchiseeId, storeId)
  await db
    .collection(PRE_OPENING_RESET_STATE_COLLECTION)
    .doc(docId)
    .set(
      {
        franchiseeId,
        storeId,
        locked: true,
        executedAt: new Date().toISOString(),
        executedBy,
      },
      { merge: true },
    )
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
    throw new HttpsError(
      response.status === 409 || response.status === 400 ? 'failed-precondition' : 'internal',
      message,
    )
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
  const failed = emptyFirestoreTargets()

  for (const collectionName of PRE_OPENING_RESET_SCOPED_COLLECTIONS) {
    try {
      deleted[collectionName] = await deleteCollectionByScope(
        collectionName,
        franchiseeId,
        storeId,
      )
    } catch {
      deleted[collectionName] = 0
      failed[collectionName] = -1
    }
  }

  try {
    deleted.caseCounters = await deleteCaseCountersByStore(storeId)
  } catch {
    deleted.caseCounters = 0
    failed.caseCounters = -1
  }

  try {
    deleted.storageFiles = await deleteStorageFilesByScope(franchiseeId, storeId)
  } catch {
    deleted.storageFiles = 0
    failed.storageFiles = -1
  }

  return { deleted, failed }
}

function buildFailedFirestoreCounts(
  targets: FirestoreTargetCounts,
  deleted: FirestoreTargetCounts,
  hardFailed: FirestoreTargetCounts,
) {
  const failed = emptyFirestoreTargets()
  for (const key of Object.keys(targets)) {
    if (Number(hardFailed[key] || 0) < 0) {
      failed[key] = Number(targets[key] || 0)
      continue
    }
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
    preOpeningAllowed: capability.preOpeningAllowed !== false,
    locked: capability.locked === true,
    message: toStringValue(capability.message),
  }
}

async function executeReservationReset({
  franchiseeId,
  storeId,
  executedBy,
  confirmText,
  resetScope,
}: {
  franchiseeId: string
  storeId: string
  executedBy: string
  confirmText: string
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
        confirmText,
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

async function buildUnifiedCapability(franchiseeId: string, storeId: string) {
  const companyStatus = await readCompanyStatus(franchiseeId)
  const locked = await readResetLockState(franchiseeId, storeId)
  const eligibility = evaluatePreOpeningResetEligibility({ companyStatus, locked })

  const firestoreTargets = await countFirestoreTargets(franchiseeId, storeId)

  let reservationSupported = false
  let reservationTargets = emptyReservationTargets()
  let dashboard: ReservationDashboardCounts = {
    totalReservations: 0,
    unhandledReservations: 0,
    confirmedReservations: 0,
  }
  let reservationMessage = ''

  try {
    const reservationCapability = await fetchReservationResetCapability(
      franchiseeId,
      storeId,
      'reservations',
    )
    reservationSupported = reservationCapability.supported
    reservationTargets = reservationCapability.reservationTargets
    dashboard = reservationCapability.dashboard
    reservationMessage = reservationCapability.message
    if (reservationCapability.locked) {
      // reservation-v4 lock also blocks selective reset
    }
  } catch (error) {
    reservationMessage =
      error instanceof Error ? error.message : 'reservation-v4 capability の取得に失敗しました'
  }

  return {
    supported: eligibility.allowed,
    franchiseeId,
    storeId,
    companyStatus: eligibility.companyStatus,
    locked: eligibility.locked,
    reason: eligibility.allowed ? '' : eligibility.reason,
    targets: {
      firestore: firestoreTargets,
      reservation: reservationTargets,
    },
    categories: buildCategorySummary(firestoreTargets, reservationTargets),
    dashboard,
    reservationSupported,
    reservationMessage,
    preserved: buildPreservedPayload(),
  }
}

/** Unified selective pre-opening reset capability (meter + reservation + attendance). */
export const getPreOpeningResetCapability = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)
    return buildUnifiedCapability(scope.franchiseeId, scope.storeId)
  },
)

export const getPreOpeningReservationResetCapability = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)
    await assertPreOpeningResetAllowed(scope.franchiseeId, scope.storeId)

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

/** Unified selective reset: sales/ops + attendance + reservations. Not the dev full wipe. */
export const executePreOpeningDataReset = onCall(
  {
    region: 'asia-northeast1',
    secrets: [reservationV4AdminToken],
  },
  async (request) => {
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)
    await assertPreOpeningResetAllowed(scope.franchiseeId, scope.storeId)

    if (!matchesStoreIdConfirmText(request.data?.confirmText, scope.storeId)) {
      throw new HttpsError(
        'invalid-argument',
        'confirmText が不正です。店舗IDを完全一致で入力してください。',
      )
    }

    const executedBy = toStringValue(request.data?.executedBy) || auth.uid
    const confirmText = scope.storeId

    const firestoreTargets = await countFirestoreTargets(scope.franchiseeId, scope.storeId)
    const firestoreDelete = await deleteFirestoreScopedData(scope.franchiseeId, scope.storeId)
    const failedFirestore = buildFailedFirestoreCounts(
      firestoreTargets,
      firestoreDelete.deleted,
      firestoreDelete.failed,
    )

    let reservationTargets = emptyReservationTargets()
    let deletedReservation = emptyReservationTargets()
    let failedReservation = emptyReservationTargets()
    let dashboard: ReservationDashboardCounts = {
      totalReservations: 0,
      unhandledReservations: 0,
      confirmedReservations: 0,
    }
    let reservationSupported = false
    let reservationError = ''

    try {
      const reservationReset = await executeReservationReset({
        franchiseeId: scope.franchiseeId,
        storeId: scope.storeId,
        executedBy,
        confirmText,
        resetScope: 'reservations',
      })
      reservationSupported = reservationReset.capability.supported
      reservationTargets = reservationReset.targets
      deletedReservation = reservationReset.deletedReservation
      failedReservation = reservationReset.failedReservation
      dashboard = reservationReset.dashboard
    } catch (error) {
      reservationError =
        error instanceof Error ? error.message : '予約データの初期化に失敗しました。'
      try {
        const capability = await fetchReservationResetCapability(
          scope.franchiseeId,
          scope.storeId,
          'reservations',
        )
        reservationTargets = capability.reservationTargets
        failedReservation = { ...capability.reservationTargets }
        dashboard = capability.dashboard
        reservationSupported = capability.supported
      } catch {
        // keep zeros
      }
    }

    await writeResetLockState({
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
    })

    const categories = buildCategorySummary(firestoreTargets, reservationTargets)
    const hasHardFailure =
      Object.values(failedFirestore).some((count) => Number(count) > 0) ||
      Object.values(failedReservation).some((count) => Number(count) > 0) ||
      Boolean(reservationError)

    return {
      success: !hasHardFailure,
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      executedAt: new Date().toISOString(),
      locked: true,
      targets: {
        firestore: firestoreTargets,
        reservation: reservationTargets,
      },
      deleted: {
        firestore: firestoreDelete.deleted,
        reservation: deletedReservation,
      },
      failed: {
        firestore: failedFirestore,
        reservation: failedReservation,
      },
      categories,
      dashboard,
      reservationSupported,
      reservationError,
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
    const auth = assertCallableAuth(request)
    const scope = normalizeScopeInput(request.data)
    await assertScopeAuthorized(auth, scope)
    await assertPreOpeningResetAllowed(scope.franchiseeId, scope.storeId)

    if (!matchesStoreIdConfirmText(request.data?.confirmText, scope.storeId)) {
      throw new HttpsError(
        'invalid-argument',
        'confirmText が不正です。店舗IDを完全一致で入力してください。',
      )
    }

    const executedBy = toStringValue(request.data?.executedBy) || auth.uid

    const reservationReset = await executeReservationReset({
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      confirmText: scope.storeId,
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
