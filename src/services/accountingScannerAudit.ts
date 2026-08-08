import { createAuditLog, type AuditActor } from './auditLogs'

export const SCANNER_AUDIT_EVENTS = [
  'receipt_created',
  'image_confirmed',
  'timestamp_requested',
  'timestamp_issued',
  'timestamp_failed',
  'timestamp_verified',
  'timestamp_verification_failed',
  'accounting_linked',
  'version_created',
  'deleted',
  'hard_deleted_pre_timestamp',
  'exported',
  'hash_mismatch',
] as const

export type ScannerAuditEventType = (typeof SCANNER_AUDIT_EVENTS)[number]

export async function recordScannerAuditEvent(input: {
  eventType: ScannerAuditEventType
  receiptId: string
  version?: number
  actor?: AuditActor | null
  reason?: string
  franchiseeId?: string
  storeId?: string
  metadata?: Record<string, unknown>
}) {
  await createAuditLog({
    action: `accounting.scanner.${input.eventType}`,
    targetType: 'accountingReceipt',
    targetId: input.receiptId,
    actor: input.actor,
    reason: input.reason ?? '',
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    after: {
      eventType: input.eventType,
      receiptId: input.receiptId,
      version: input.version ?? null,
      metadata: input.metadata ?? {},
    },
  })
}
