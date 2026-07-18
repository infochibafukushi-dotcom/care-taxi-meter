import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { onSchedule } from 'firebase-functions/v2/scheduler'

export { loginStaff } from './staffLogin'
export {
  executePreOpeningDataReset,
  executePreOpeningReservationReset,
  getPreOpeningResetCapability,
  getPreOpeningReservationResetCapability,
} from './preOpeningDataReset'
export { deleteStaffMemberCompletely } from './deleteStaffMemberCompletely'
export { runLightweightFirestoreBackup } from './lightweightFirestoreBackup'

initializeApp()

const GPS_ROUTE_SUMMARY_DOC_ID = 'summary'
const DELETE_BATCH_SIZE = 100

const deleteExpiredGpsRouteSummary = async (
  summaryDoc: FirebaseFirestore.QueryDocumentSnapshot,
) => {
  const data = summaryDoc.data()
  const chunkCount = typeof data.chunkCount === 'number' ? data.chunkCount : 0
  const caseRecordId = typeof data.caseRecordId === 'string'
    ? data.caseRecordId
    : summaryDoc.ref.parent.parent?.id ?? 'unknown'

  const batch = getFirestore().batch()
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    batch.delete(summaryDoc.ref.collection('chunks').doc(String(chunkIndex)))
  }
  batch.delete(summaryDoc.ref)
  await batch.commit()

  logger.info('Deleted expired GPS route', {
    caseRecordId,
    chunkCount,
    expiresAt: data.expiresAt,
  })
}

export const purgeExpiredGpsRoutes = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'Asia/Tokyo',
  },
  async () => {
    const cutoffIso = new Date().toISOString()
    let deletedCount = 0

    while (true) {
      const snapshot = await getFirestore()
        .collectionGroup('gpsRoute')
        .where('expiresAt', '<=', cutoffIso)
        .limit(DELETE_BATCH_SIZE)
        .get()

      if (snapshot.empty) {
        break
      }

      const summaryDocs = snapshot.docs.filter(
        (documentSnapshot) => documentSnapshot.id === GPS_ROUTE_SUMMARY_DOC_ID,
      )

      for (const summaryDoc of summaryDocs) {
        await deleteExpiredGpsRouteSummary(summaryDoc)
        deletedCount += 1
      }

      if (snapshot.size < DELETE_BATCH_SIZE) {
        break
      }
    }

    logger.info('GPS route purge completed', {
      cutoffIso,
      deletedCount,
    })
  },
)
