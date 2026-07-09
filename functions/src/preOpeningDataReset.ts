import { getStorage } from 'firebase-admin/storage'
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const RESET_BATCH_SIZE = 450
const GPS_ROUTE_SUMMARY_DOC_ID = 'summary'
const MAINTENANCE_LOGS_COLLECTION = 'maintenanceLogs'

type ResetRole = 'owner' | 'hq_admin'

type TenantScope = {
  franchiseeId: string
  storeId: string
}

type DeleteFailure = {
  collection: string
  documentId: string
  message: string
}

type ResetCounts = {
  reservations: number
  trips: number
  sales: number
  accounting: number
  storageFiles: number
}

type ResetRequest = {
  franchiseeId?: string
  storeId?: string
  executedBy?: string
  executedByName?: string
}

type ResetResponse = {
  deletedCounts: ResetCounts
  deletedByCollection: Record<string, number>
  failedItems: DeleteFailure[]
  preservedSettings: boolean
}

const businessDataCollections = [
  'caseRecords',
  'workSessions',
  'staffAttendance',
  'caseCounters',
  'accountingExpenses',
  'accountingReceipts',
  'accountingAdjustments',
  'accountingExports',
  'accountingSales',
  'accountingSettlementAuxiliary',
  'accountingFixedAssets',
] as const

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeRole = (value: unknown): ResetRole | '' => {
  if (value === 'hq_admin' || value === 'superAdmin') return 'hq_admin'
  if (value === 'owner' || value === 'franchisee_owner') return 'owner'
  return ''
}

const docFranchiseeId = (data: Record<string, unknown>) =>
  toStringValue(data.franchiseeId) || toStringValue(data.companyId)

const matchesTenantScope = (data: Record<string, unknown>, scope: TenantScope) => {
  const franchiseeId = docFranchiseeId(data)
  const storeId = toStringValue(data.storeId)
  if (!franchiseeId || !storeId) {
    return false
  }
  return franchiseeId === scope.franchiseeId && storeId === scope.storeId
}

const assertResetPermission = (auth: { token: Record<string, unknown> }, scope: TenantScope) => {
  const role = normalizeRole(auth.token.role)
  if (role !== 'owner' && role !== 'hq_admin') {
    throw new HttpsError('permission-denied', '開業前データリセットは管理者のみ実行できます。')
  }

  const tokenFranchiseeId =
    toStringValue(auth.token.franchiseeId) || toStringValue(auth.token.companyId)
  const tokenStoreId = toStringValue(auth.token.storeId)

  if (!scope.franchiseeId || !scope.storeId) {
    throw new HttpsError('invalid-argument', 'franchiseeId と storeId が必要です。')
  }

  if (role === 'owner') {
    if (!tokenFranchiseeId || !tokenStoreId) {
      throw new HttpsError('permission-denied', 'テナント情報が不足しています。')
    }
    if (tokenFranchiseeId !== scope.franchiseeId || tokenStoreId !== scope.storeId) {
      throw new HttpsError('permission-denied', 'ログイン中の加盟店・店舗以外のデータは削除できません。')
    }
  }
}

const deleteGpsRouteForCase = async (caseRecordRef: DocumentReference) => {
  const summaryRef = caseRecordRef.collection('gpsRoute').doc(GPS_ROUTE_SUMMARY_DOC_ID)
  const summarySnapshot = await summaryRef.get()
  if (!summarySnapshot.exists) {
    return 0
  }

  const chunkCount =
    typeof summarySnapshot.data()?.chunkCount === 'number' ? summarySnapshot.data()!.chunkCount : 0

  for (let offset = 0; offset < chunkCount; offset += RESET_BATCH_SIZE) {
    const batch = getFirestore().batch()
    const limit = Math.min(offset + RESET_BATCH_SIZE, chunkCount)
    for (let chunkIndex = offset; chunkIndex < limit; chunkIndex += 1) {
      batch.delete(summaryRef.collection('chunks').doc(String(chunkIndex)))
    }
    await batch.commit()
  }

  await summaryRef.delete()
  return chunkCount + 1
}

const deleteStorageObject = async (storagePath: string) => {
  if (!storagePath) {
    return false
  }

  const bucket = getStorage().bucket()
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    return false
  }

  await file.delete()
  return true
}

const deleteTenantDocuments = async (
  collectionName: string,
  scope: TenantScope,
  failures: DeleteFailure[],
) => {
  const db = getFirestore()
  let deletedCount = 0
  let storageDeletedCount = 0

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where('franchiseeId', '==', scope.franchiseeId)
      .where('storeId', '==', scope.storeId)
      .limit(RESET_BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      break
    }

    for (const documentSnapshot of snapshot.docs) {
      const data = documentSnapshot.data() as Record<string, unknown>
      if (!matchesTenantScope(data, scope)) {
        continue
      }

      try {
        if (collectionName === 'caseRecords') {
          await deleteGpsRouteForCase(documentSnapshot.ref)
        }

        if (collectionName === 'accountingReceipts') {
          const storagePath = toStringValue(data.storagePath)
          if (storagePath.startsWith(`accounting/${scope.franchiseeId}/${scope.storeId}/`)) {
            try {
              if (await deleteStorageObject(storagePath)) {
                storageDeletedCount += 1
              }
            } catch (error) {
              failures.push({
                collection: 'storage',
                documentId: storagePath,
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }

        await documentSnapshot.ref.delete()
        deletedCount += 1
      } catch (error) {
        failures.push({
          collection: collectionName,
          documentId: documentSnapshot.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (snapshot.size < RESET_BATCH_SIZE) {
      break
    }
  }

  return { deletedCount, storageDeletedCount }
}

const deleteCaseCountersForStore = async (scope: TenantScope, failures: DeleteFailure[]) => {
  const db = getFirestore()
  let deletedCount = 0

  while (true) {
    const snapshot = await db
      .collection('caseCounters')
      .where('storeId', '==', scope.storeId)
      .limit(RESET_BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      return deletedCount
    }

    const batch = db.batch()
    let batchCount = 0

    for (const documentSnapshot of snapshot.docs) {
      const data = documentSnapshot.data() as Record<string, unknown>
      if (!matchesTenantScope(data, scope)) {
        continue
      }

      try {
        batch.delete(documentSnapshot.ref)
        batchCount += 1
      } catch (error) {
        failures.push({
          collection: 'caseCounters',
          documentId: documentSnapshot.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (batchCount > 0) {
      await batch.commit()
      deletedCount += batchCount
    }

    if (snapshot.size < RESET_BATCH_SIZE) {
      return deletedCount
    }
  }
}

const deleteRemainingStoragePrefix = async (scope: TenantScope, failures: DeleteFailure[]) => {
  const prefix = `accounting/${scope.franchiseeId}/${scope.storeId}/receipts/`
  const bucket = getStorage().bucket()
  let deletedCount = 0

  try {
    const [files] = await bucket.getFiles({ prefix })
    for (const file of files) {
      if (!file.name.startsWith(prefix)) {
        continue
      }
      try {
        await file.delete()
        deletedCount += 1
      } catch (error) {
        failures.push({
          collection: 'storage',
          documentId: file.name,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    failures.push({
      collection: 'storage',
      documentId: prefix,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return deletedCount
}

const summarizeDeletedCounts = (
  deletedByCollection: Record<string, number>,
  storageFiles: number,
): ResetCounts => ({
  reservations: 0,
  trips:
    (deletedByCollection.caseRecords ?? 0) +
    (deletedByCollection.workSessions ?? 0) +
    (deletedByCollection.staffAttendance ?? 0) +
    (deletedByCollection.caseCounters ?? 0),
  sales: deletedByCollection.caseRecords ?? 0,
  accounting:
    (deletedByCollection.accountingExpenses ?? 0) +
    (deletedByCollection.accountingReceipts ?? 0) +
    (deletedByCollection.accountingAdjustments ?? 0) +
    (deletedByCollection.accountingExports ?? 0) +
    (deletedByCollection.accountingSales ?? 0) +
    (deletedByCollection.accountingSettlementAuxiliary ?? 0) +
    (deletedByCollection.accountingFixedAssets ?? 0),
  storageFiles,
})

export const resetPreOpeningBusinessData = onCall(
  { region: 'asia-northeast1' },
  async (request): Promise<ResetResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '認証が必要です。')
    }

    const payload = (request.data ?? {}) as ResetRequest
    const scope: TenantScope = {
      franchiseeId: toStringValue(payload.franchiseeId),
      storeId: toStringValue(payload.storeId),
    }

    assertResetPermission(request.auth, scope)

    const failures: DeleteFailure[] = []
    const deletedByCollection: Record<string, number> = {}
    let storageDeletedCount = 0

    for (const collectionName of businessDataCollections) {
      if (collectionName === 'caseCounters') {
        deletedByCollection.caseCounters = await deleteCaseCountersForStore(scope, failures)
        continue
      }

      const result = await deleteTenantDocuments(collectionName, scope, failures)
      deletedByCollection[collectionName] = result.deletedCount
      storageDeletedCount += result.storageDeletedCount
    }

    storageDeletedCount += await deleteRemainingStoragePrefix(scope, failures)

    const deletedCounts = summarizeDeletedCounts(deletedByCollection, storageDeletedCount)
    const executedBy =
      toStringValue(payload.executedBy) ||
      toStringValue(request.auth.token.staffId) ||
      request.auth.uid
    const executedByName = toStringValue(payload.executedByName)

    await getFirestore().collection(MAINTENANCE_LOGS_COLLECTION).add({
      action: 'RESET_PRE_OPENING_BUSINESS_DATA',
      franchiseeId: scope.franchiseeId,
      storeId: scope.storeId,
      executedBy,
      executedByName,
      executedAt: FieldValue.serverTimestamp(),
      deletedCounts,
      deletedByCollection,
      failedItems: failures,
      preservedSettings: true,
      role: normalizeRole(request.auth.token.role),
    })

    return {
      deletedCounts,
      deletedByCollection,
      failedItems: failures,
      preservedSettings: true,
    }
  },
)
