import { v1 } from '@google-cloud/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { onSchedule } from 'firebase-functions/v2/scheduler'

/** Keep in sync with src/utils/lightweightBackupPolicy.ts allowlist */
const LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST = [
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'accountingFixedAssets',
  'accountingSettlementAuxiliary',
  'caseRecords',
  'workSessions',
  'staffAttendance',
  'companies',
  'stores',
  'vehicles',
  'meterSettings',
  'hqSettings',
  'fcPlans',
  'appSettings',
  'preOpeningResetState',
] as const

const BACKUP_BUCKET = 'care-taxi-meter-fs-backup-ane1'
const STATUS_COLLECTION = 'lightweightBackupStatus'
const STATUS_DOC_ID = 'latest'

const countCollectionDocuments = async (collectionId: string): Promise<number> => {
  const aggregate = await getFirestore().collection(collectionId).count().get()
  return aggregate.data().count
}

const writeBackupStatus = async (input: {
  result: 'success' | 'failure'
  collectionCounts: Record<string, number>
  totalDocuments: number
  outputUriPrefix?: string
  operationName?: string
  message?: string
}) => {
  const nowIso = new Date().toISOString()
  const payload: Record<string, unknown> = {
    result: input.result,
    collectionCounts: input.collectionCounts,
    totalDocuments: input.totalDocuments,
    outputUriPrefix: input.outputUriPrefix ?? null,
    operationName: input.operationName ?? null,
    message: input.message ?? null,
    updatedAt: nowIso,
  }
  if (input.result === 'success') {
    payload.lastSuccessAt = nowIso
  }
  await getFirestore().collection(STATUS_COLLECTION).doc(STATUS_DOC_ID).set(payload, { merge: true })
}

export async function executeLightweightFirestoreBackup(): Promise<{
  outputUriPrefix: string
  operationName: string
  totalDocuments: number
  collectionCounts: Record<string, number>
}> {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'care-taxi-meter'
  const day = new Date().toISOString().slice(0, 10)
  const outputUriPrefix = `gs://${BACKUP_BUCKET}/daily/${day}`

  const collectionCounts: Record<string, number> = {}
  let totalDocuments = 0
  for (const collectionId of LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST) {
    const count = await countCollectionDocuments(collectionId)
    collectionCounts[collectionId] = count
    totalDocuments += count
  }

  const client = new v1.FirestoreAdminClient()
  const databaseName = client.databasePath(projectId, '(default)')

  try {
    const [operation] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix,
      collectionIds: [...LIGHTWEIGHT_BACKUP_COLLECTION_ALLOWLIST],
    })

    const operationName = operation.name || ''
    await writeBackupStatus({
      result: 'success',
      collectionCounts,
      totalDocuments,
      outputUriPrefix,
      operationName,
      message: 'export_started',
    })

    logger.info('Lightweight Firestore backup export started', {
      outputUriPrefix,
      operationName,
      totalDocuments,
      collectionCounts,
    })

    return { outputUriPrefix, operationName, totalDocuments, collectionCounts }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Firestore export failed'
    await writeBackupStatus({
      result: 'failure',
      collectionCounts,
      totalDocuments,
      outputUriPrefix,
      message,
    })
    throw error
  }
}

export const runLightweightFirestoreBackup = onSchedule(
  {
    schedule: 'every day 03:30',
    timeZone: 'Asia/Tokyo',
    region: 'asia-northeast1',
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    await executeLightweightFirestoreBackup()
  },
)
