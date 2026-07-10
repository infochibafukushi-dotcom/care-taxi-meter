import { createHash } from 'crypto'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'

const DELETE_BATCH_SIZE = 450

type StaffRole = 'driver' | 'manager' | 'owner' | 'hq_admin'

type ExecutorContext = {
  uid: string
  staffId: string
  franchiseeId: string
  storeId: string
}

type DeletedCounts = {
  staffMembers: number
  staffAttendance: number
  workSessions: number
  caseRecords: number
  accountingSales: number
  gpsRoutes: number
  auditLogs: number
  otherLogs: number
  loginAttempts: number
}

const emptyDeletedCounts = (): DeletedCounts => ({
  staffMembers: 0,
  staffAttendance: 0,
  workSessions: 0,
  caseRecords: 0,
  accountingSales: 0,
  gpsRoutes: 0,
  auditLogs: 0,
  otherLogs: 0,
  loginAttempts: 0,
})

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

const ACTOR_FIELD_NAMES = [
  'userId',
  'staffId',
  'driverId',
  'executedBy',
  'changedBy',
  'createdBy',
  'updatedBy',
  'deletedBy',
  'uploadedBy',
  'cancelledBy',
  'restoredBy',
] as const

const OTHER_LOG_COLLECTIONS = ['operationLogs', 'adminActionLogs', 'debugLogs', 'errorLogs'] as const

const docFranchisee = (data: Record<string, unknown>) =>
  toStringValue(data.franchiseeId) || toStringValue(data.companyId)

const isActorDocument = (data: Record<string, unknown>, staffId: string) =>
  ACTOR_FIELD_NAMES.some((fieldName) => toStringValue(data[fieldName]) === staffId)

const assertExecutorAuth = (request: CallableRequest<Record<string, unknown>>): ExecutorContext => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ログインが必要です')
  }

  const role = toRole(request.auth.token.role)
  if (role !== 'owner') {
    throw new HttpsError('permission-denied', '従業員の完全削除はオーナーのみ実行できます')
  }

  const staffId = toStringValue(request.auth.token.staffId)
  if (!staffId) {
    throw new HttpsError('permission-denied', '実行者の従業員IDが確認できません')
  }

  const franchiseeId = toStringValue(request.auth.token.franchiseeId ?? request.auth.token.companyId)
  if (!franchiseeId) {
    throw new HttpsError('permission-denied', '実行者の加盟店IDが確認できません')
  }

  return {
    uid: request.auth.uid,
    staffId,
    franchiseeId,
    storeId: toStringValue(request.auth.token.storeId),
  }
}

async function assertStoreBelongsToFranchisee(storeId: string, franchiseeId: string) {
  const db = getFirestore()
  const storeSnapshot = await db.collection('stores').doc(storeId).get()
  if (!storeSnapshot.exists) {
    throw new HttpsError('not-found', '店舗が見つかりません')
  }

  const storeData = storeSnapshot.data() ?? {}
  const storeFranchiseeId = docFranchisee(storeData)
  if (storeFranchiseeId !== franchiseeId) {
    throw new HttpsError('permission-denied', 'この店舗の従業員は削除できません')
  }
}

async function deleteDocumentsInBatches(refs: FirebaseFirestore.DocumentReference[]) {
  if (refs.length === 0) {
    return
  }

  const db = getFirestore()
  for (let index = 0; index < refs.length; index += DELETE_BATCH_SIZE) {
    const chunk = refs.slice(index, index + DELETE_BATCH_SIZE)
    const batch = db.batch()
    chunk.forEach((ref) => batch.delete(ref))
    await batch.commit()
  }
}

async function deleteGpsRouteForCase(caseRef: FirebaseFirestore.DocumentReference) {
  const summaryRef = caseRef.collection('gpsRoute').doc('summary')
  const chunkRefs = await summaryRef.collection('chunks').listDocuments()
  if (chunkRefs.length > 0) {
    await deleteDocumentsInBatches(chunkRefs)
  }

  const summarySnapshot = await summaryRef.get()
  if (summarySnapshot.exists) {
    await summaryRef.delete()
    return 1
  }

  return 0
}

async function queryCollectionByStaffField(
  collectionName: string,
  fieldName: string,
  staffId: string,
  franchiseeId: string,
) {
  const db = getFirestore()
  const snapshot = await db
    .collection(collectionName)
    .where(fieldName, '==', staffId)
    .where('franchiseeId', '==', franchiseeId)
    .get()

  return snapshot.docs
}

async function collectCaseRecordDocs(staffId: string, franchiseeId: string) {
  const byStaffId = await queryCollectionByStaffField('caseRecords', 'staffId', staffId, franchiseeId)
  const byDriverId = await queryCollectionByStaffField('caseRecords', 'driverId', staffId, franchiseeId)

  const uniqueDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  ;[...byStaffId, ...byDriverId].forEach((docSnapshot) => {
    uniqueDocs.set(docSnapshot.id, docSnapshot)
  })

  return [...uniqueDocs.values()]
}

async function collectAccountingSalesForCaseRecords(
  caseRecordIds: string[],
  franchiseeId: string,
) {
  if (caseRecordIds.length === 0) {
    return [] as FirebaseFirestore.QueryDocumentSnapshot[]
  }

  const db = getFirestore()
  const uniqueDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()

  for (let index = 0; index < caseRecordIds.length; index += 30) {
    const chunk = caseRecordIds.slice(index, index + 30)
    const snapshot = await db
      .collection('accountingSales')
      .where('sourceCaseRecordId', 'in', chunk)
      .where('franchiseeId', '==', franchiseeId)
      .get()

    snapshot.docs.forEach((docSnapshot) => {
      uniqueDocs.set(docSnapshot.id, docSnapshot)
    })
  }

  return [...uniqueDocs.values()]
}

async function collectWorkSessionDocs(staffId: string, franchiseeId: string) {
  return queryCollectionByStaffField('workSessions', 'staffId', staffId, franchiseeId)
}

async function collectAuditLogDocs(staffId: string, franchiseeId: string) {
  const byUserId = await queryCollectionByStaffField('auditLogs', 'userId', staffId, franchiseeId)
  const byChangedBy = await queryCollectionByStaffField('auditLogs', 'changedBy', staffId, franchiseeId)

  const uniqueDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  ;[...byUserId, ...byChangedBy].forEach((docSnapshot) => {
    uniqueDocs.set(docSnapshot.id, docSnapshot)
  })

  return [...uniqueDocs.values()]
}

async function collectOtherLogDocs(staffId: string, franchiseeId: string, storeId: string) {
  const db = getFirestore()
  const uniqueDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()

  for (const collectionName of OTHER_LOG_COLLECTIONS) {
    for (const fieldName of ACTOR_FIELD_NAMES) {
      try {
        const snapshot = await db
          .collection(collectionName)
          .where(fieldName, '==', staffId)
          .where('franchiseeId', '==', franchiseeId)
          .get()
        snapshot.docs.forEach((docSnapshot) => {
          uniqueDocs.set(`${collectionName}/${docSnapshot.id}`, docSnapshot)
        })
      } catch {
        // Index or field may not exist; fall back to scoped scan below.
      }
    }

    try {
      const scopedSnapshot = await db
        .collection(collectionName)
        .where('franchiseeId', '==', franchiseeId)
        .where('storeId', '==', storeId)
        .get()
      scopedSnapshot.docs
        .filter((docSnapshot) => isActorDocument(docSnapshot.data(), staffId))
        .forEach((docSnapshot) => {
          uniqueDocs.set(`${collectionName}/${docSnapshot.id}`, docSnapshot)
        })
    } catch {
      // Collection may be empty or unsupported; continue.
    }
  }

  return [...uniqueDocs.values()]
}

async function clearVehicleDriverLocks(staffId: string, franchiseeId: string) {
  const db = getFirestore()
  const snapshot = await db
    .collection('vehicles')
    .where('currentDriverId', '==', staffId)
    .where('franchiseeId', '==', franchiseeId)
    .get()

  if (snapshot.empty) {
    return 0
  }

  const batch = db.batch()
  snapshot.docs.forEach((docSnapshot) => {
    batch.update(docSnapshot.ref, {
      currentDriverId: '',
      currentDriverName: '',
      currentWorkSessionId: '',
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  await batch.commit()
  return snapshot.size
}

async function deleteLoginAttemptsForStaff({
  companyId,
  staffId,
  userId,
  loginId,
  name,
}: {
  companyId: string
  staffId: string
  userId: string
  loginId: string
  name: string
}) {
  const db = getFirestore()
  const identifiers = [...new Set([userId, loginId, name, staffId].filter(Boolean))]
  let deletedCount = 0

  for (const identifier of identifiers) {
    const attemptId = buildLoginAttemptId(companyId, identifier)
    const attemptRef = db.collection('loginAttempts').doc(attemptId)
    const attemptSnapshot = await attemptRef.get()
    if (attemptSnapshot.exists) {
      await attemptRef.delete()
      deletedCount += 1
    }
  }

  return deletedCount
}

async function loadExecutorName(staffId: string) {
  const db = getFirestore()
  const snapshot = await db.collection('staffMembers').doc(staffId).get()
  if (!snapshot.exists) {
    return ''
  }
  return toStringValue(snapshot.data()?.name)
}

async function createCompleteDeleteAuditLog({
  executor,
  executorName,
  targetStaffId,
  targetName,
  franchiseeId,
  storeId,
  deletedCounts,
}: {
  executor: ExecutorContext
  executorName: string
  targetStaffId: string
  targetName: string
  franchiseeId: string
  storeId: string
  deletedCounts: DeletedCounts
}) {
  const db = getFirestore()
  await db.collection('auditLogs').add({
    action: 'staff_complete_delete',
    actionType: 'staff_complete_delete',
    targetType: 'staffMember',
    targetId: targetStaffId,
    targetName,
    franchiseeId,
    storeId,
    executedByStaffId: executor.staffId,
    executedBy: executor.staffId,
    executedByName: executorName,
    changedBy: executor.staffId,
    changedByName: executorName,
    userId: executor.staffId,
    userName: executorName,
    deletedCounts,
    reason: 'オーナーによる従業員完全削除',
    createdAt: FieldValue.serverTimestamp(),
  })
}

export const deleteStaffMemberCompletely = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    const executor = assertExecutorAuth(request)
    const targetStaffId = toStringValue(request.data?.staffId)
    if (!targetStaffId) {
      throw new HttpsError('invalid-argument', '削除対象の従業員IDが指定されていません')
    }

    if (targetStaffId === executor.staffId) {
      throw new HttpsError('permission-denied', 'ログイン中の本人は完全削除できません')
    }

    const db = getFirestore()
    const targetSnapshot = await db.collection('staffMembers').doc(targetStaffId).get()
    if (!targetSnapshot.exists) {
      throw new HttpsError('not-found', '削除対象の従業員が見つかりません')
    }

    const targetData = targetSnapshot.data() ?? {}
    const targetFranchiseeId = docFranchisee(targetData)
    const targetStoreId = toStringValue(targetData.storeId)
    const targetRole = toRole(targetData.role)
    const targetName = toStringValue(targetData.name) || '名称未設定のスタッフ'

    if (targetFranchiseeId !== executor.franchiseeId) {
      throw new HttpsError('permission-denied', '他加盟店の従業員は削除できません')
    }

    if (targetRole === 'owner') {
      throw new HttpsError('permission-denied', 'オーナー権限の従業員は完全削除できません')
    }

    if (targetRole === 'hq_admin') {
      throw new HttpsError('permission-denied', '本部管理者は完全削除できません')
    }

    if (!targetStoreId) {
      throw new HttpsError('failed-precondition', '削除対象の店舗IDが未設定です')
    }

    await assertStoreBelongsToFranchisee(targetStoreId, executor.franchiseeId)

    const deletedCounts = emptyDeletedCounts()
    const warnings: string[] = [
      '予約システム（reservation-v4）への担当者解除APIは未実装のため、予約データの担当者情報は自動更新されません。必要に応じて予約管理画面で手動確認してください。',
    ]

    try {
      const caseRecordDocs = await collectCaseRecordDocs(targetStaffId, executor.franchiseeId)
      const caseRecordIds = caseRecordDocs.map((docSnapshot) => docSnapshot.id)
      const accountingSalesDocs = await collectAccountingSalesForCaseRecords(
        caseRecordIds,
        executor.franchiseeId,
      )
      const workSessionDocs = await collectWorkSessionDocs(targetStaffId, executor.franchiseeId)
      const auditLogDocs = await collectAuditLogDocs(targetStaffId, executor.franchiseeId)
      const otherLogDocs = await collectOtherLogDocs(
        targetStaffId,
        executor.franchiseeId,
        targetStoreId,
      )

      deletedCounts.caseRecords = caseRecordDocs.length
      deletedCounts.accountingSales = accountingSalesDocs.length
      deletedCounts.workSessions = workSessionDocs.length
      deletedCounts.auditLogs = auditLogDocs.length
      deletedCounts.otherLogs = otherLogDocs.length
      deletedCounts.staffMembers = 1
      deletedCounts.staffAttendance = 1
      deletedCounts.loginAttempts = 0

      const authUid = targetStaffId
      try {
        await getAuth().revokeRefreshTokens(authUid)
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : ''
        if (code !== 'auth/user-not-found') {
          throw error
        }
      }

      let gpsRoutesDeleted = 0
      for (const caseDoc of caseRecordDocs) {
        gpsRoutesDeleted += await deleteGpsRouteForCase(caseDoc.ref)
        await caseDoc.ref.delete()
      }
      deletedCounts.gpsRoutes = gpsRoutesDeleted

      await deleteDocumentsInBatches(accountingSalesDocs.map((docSnapshot) => docSnapshot.ref))
      await deleteDocumentsInBatches(workSessionDocs.map((docSnapshot) => docSnapshot.ref))
      await deleteDocumentsInBatches(auditLogDocs.map((docSnapshot) => docSnapshot.ref))
      await deleteDocumentsInBatches(otherLogDocs.map((docSnapshot) => docSnapshot.ref))

      await clearVehicleDriverLocks(targetStaffId, executor.franchiseeId)

      const companyId = targetFranchiseeId
      const attendanceId = buildStaffAttendanceId({
        companyId,
        staffId: targetStaffId,
        storeId: targetStoreId,
      })
      const attendanceRef = db.collection('staffAttendance').doc(attendanceId)
      const attendanceSnapshot = await attendanceRef.get()
      if (attendanceSnapshot.exists) {
        await attendanceRef.delete()
        deletedCounts.staffAttendance = 1
      } else {
        deletedCounts.staffAttendance = 0
      }

      deletedCounts.loginAttempts = await deleteLoginAttemptsForStaff({
        companyId,
        staffId: targetStaffId,
        userId: toStringValue(targetData.userId),
        loginId: toStringValue(targetData.loginId),
        name: targetName,
      })

      await targetSnapshot.ref.delete()
      deletedCounts.staffMembers = 1

      try {
        await getAuth().deleteUser(authUid)
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : ''
        if (code !== 'auth/user-not-found') {
          throw error
        }
      }

      const executorName = (await loadExecutorName(executor.staffId)) || executor.staffId
      await createCompleteDeleteAuditLog({
        executor,
        executorName,
        targetStaffId,
        targetName,
        franchiseeId: executor.franchiseeId,
        storeId: targetStoreId,
        deletedCounts,
      })

      return {
        success: true,
        targetStaffId,
        targetName,
        deletedCounts,
        warnings,
        message: `${targetName}を完全削除しました。`,
      }
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error
      }

      const message = error instanceof Error ? error.message : String(error ?? '不明なエラー')
      throw new HttpsError(
        'internal',
        `従業員の完全削除に失敗しました。${message}`,
      )
    }
  },
)
