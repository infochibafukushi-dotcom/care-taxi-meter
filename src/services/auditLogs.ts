import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffRole } from '../types/work'
import { toFranchiseRole } from './tenancy'

export type AuditActor = {
  userId: string
  userName: string
  role: StaffRole | ''
  franchiseeId?: string
  storeId?: string
}

export type AuditLogInput = {
  action: string
  targetId?: string
  targetType?: string
  actor?: AuditActor | null
  before?: unknown
  after?: unknown
  reason?: string
  franchiseeId?: string
  storeId?: string
}

const auditLogsCollectionName = 'auditLogs'

export async function createAuditLog({
  action,
  actor = null,
  after,
  before,
  franchiseeId,
  reason = '',
  storeId,
  targetId = '',
  targetType = 'unknown',
}: AuditLogInput) {
  const db = getFirestore(getFirebaseApp())

  await addDoc(collection(db, auditLogsCollectionName), {
    action,
    targetType,
    targetId,
    franchiseeId: franchiseeId ?? actor?.franchiseeId ?? '',
    storeId: storeId ?? actor?.storeId ?? '',
    before: before ?? null,
    after: after ?? null,
    changedBy: actor?.userId ?? '',
    changedByName: actor?.userName ?? '',
    changedByRole: toFranchiseRole(actor?.role ?? '') || actor?.role || '',
    reason,
    createdAt: serverTimestamp(),
  })
}
