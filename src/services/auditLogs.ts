import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffRole } from '../types/work'

export type AuditActor = {
  userId: string
  userName: string
  role: StaffRole | ''
}

export type AuditLogInput = {
  action: string
  targetId: string
  actor?: AuditActor | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  reason: string
}

const auditLogsCollectionName = 'auditLogs'

export async function createAuditLog({
  action,
  actor = null,
  after,
  before,
  reason,
  targetId,
}: AuditLogInput) {
  const db = getFirestore(getFirebaseApp())

  await addDoc(collection(db, auditLogsCollectionName), {
    action,
    targetId,
    userId: actor?.userId ?? '',
    userName: actor?.userName ?? '',
    role: actor?.role ?? '',
    before,
    after,
    reason,
    createdAt: serverTimestamp(),
  })
}
