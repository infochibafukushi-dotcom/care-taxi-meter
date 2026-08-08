import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, getFirestore, updateDoc } from 'firebase/firestore'
import { getStorage, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import { buildLegalTimestampTokenStoragePath } from '../utils/accountingScannerPaths'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { recordScannerAuditEvent } from './accountingScannerAudit'
import type { AuditActor } from './auditLogs'

const functionsRegion = 'asia-northeast1'

export type IssueTimestampClientResult =
  | {
      ok: true
      alreadyIssued?: boolean
      configured: true
      provider: string
      tokenId: string
      algorithm: string
      timestampedAt: string
      verifiedAt?: string
      legalStatus: string
      timestampStatus: 'issued'
    }
  | {
      ok: false
      configured: boolean
      provider: string
      code: string
      message: string
      legalStatus: string
      timestampStatus: 'failed' | 'verification_failed' | 'pending'
    }

/**
 * サーバーへタイムスタンプ発行を要求する。
 * 未設定時は issued にならない（サーバーが保証）。
 */
export async function issueAccountingReceiptTimestampClient(input: {
  receiptId: string
  version: number
  fileHash: string
  legalMasterStoragePath: string
  franchiseeId: string
  storeId: string
  actor?: AuditActor | null
}): Promise<IssueTimestampClientResult> {
  await recordScannerAuditEvent({
    eventType: 'timestamp_requested',
    receiptId: input.receiptId,
    version: input.version,
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    actor: input.actor,
  })

  if (isReviewDemoRuntimeEnabled()) {
    return {
      ok: false,
      configured: false,
      provider: 'unconfigured',
      code: 'TIMESTAMP_PROVIDER_NOT_CONFIGURED',
      message: 'タイムスタンプサービス未設定（デモ）',
      legalStatus: 'legal_pending_timestamp',
      timestampStatus: 'failed',
    }
  }

  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    {
      receiptId: string
      version: number
      fileHash: string
      legalMasterStoragePath: string
    },
    IssueTimestampClientResult & { tokenBase64?: string }
  >(functions, 'issueAccountingReceiptTimestamp')

  const response = await callable({
    receiptId: input.receiptId,
    version: input.version,
    fileHash: input.fileHash,
    legalMasterStoragePath: input.legalMasterStoragePath,
  })
  const data = response.data

  if (!data.ok) {
    await recordScannerAuditEvent({
      eventType: data.timestampStatus === 'verification_failed'
        ? 'timestamp_verification_failed'
        : 'timestamp_failed',
      receiptId: input.receiptId,
      version: input.version,
      franchiseeId: input.franchiseeId,
      storeId: input.storeId,
      actor: input.actor,
      metadata: { code: data.code, message: data.message },
    })
    return data
  }

  if (data.tokenBase64 && !data.alreadyIssued) {
    const tokenPath = buildLegalTimestampTokenStoragePath({
      franchiseeId: input.franchiseeId,
      storeId: input.storeId,
      receiptId: input.receiptId,
      version: input.version,
    })
    const binary = Uint8Array.from(atob(data.tokenBase64), (c) => c.charCodeAt(0))
    const storage = getStorage(getFirebaseApp())
    await uploadBytes(ref(storage, tokenPath), binary, {
      contentType: 'application/timestamp-reply',
    })
    const db = getFirestore(getFirebaseApp())
    await updateDoc(doc(db, 'accountingReceipts', input.receiptId), {
      timestampTokenStoragePath: tokenPath,
    })
  }

  await recordScannerAuditEvent({
    eventType: 'timestamp_issued',
    receiptId: input.receiptId,
    version: input.version,
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
    actor: input.actor,
    metadata: {
      provider: data.provider,
      tokenId: data.tokenId,
      legalStatus: data.legalStatus,
    },
  })

  return {
    ok: true,
    alreadyIssued: data.alreadyIssued,
    configured: true,
    provider: data.provider,
    tokenId: data.tokenId,
    algorithm: data.algorithm,
    timestampedAt: data.timestampedAt,
    verifiedAt: data.verifiedAt,
    legalStatus: data.legalStatus,
    timestampStatus: 'issued',
  }
}
