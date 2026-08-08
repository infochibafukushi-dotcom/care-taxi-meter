import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  resolveServerTimestampProvider,
  type TimestampIssueRequest,
} from './accountingTimestampProvider'

type RequestBody = {
  receiptId?: string
  version?: number
  fileHash?: string
  legalMasterStoragePath?: string
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * タイムスタンプ発行・検証（サーバー側）。
 * 未設定時は issued にせず failed を返す。ダミー発行はしない。
 */
export const issueAccountingReceiptTimestamp = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', '認証が必要です。')
    }

    const role = toStringValue(request.auth.token.role)
    const allowed =
      role === 'hq_admin' ||
      role === 'superAdmin' ||
      role === 'owner' ||
      role === 'franchisee_owner'
    if (!allowed) {
      throw new HttpsError('permission-denied', 'タイムスタンプ発行権限がありません。')
    }

    const data = (request.data ?? {}) as RequestBody
    const receiptId = toStringValue(data.receiptId)
    const fileHash = toStringValue(data.fileHash).toLowerCase()
    const legalMasterStoragePath = toStringValue(data.legalMasterStoragePath)
    const version = typeof data.version === 'number' && data.version > 0 ? data.version : 1

    if (!receiptId || !fileHash || !legalMasterStoragePath) {
      throw new HttpsError('invalid-argument', 'receiptId / fileHash / legalMasterStoragePath は必須です。')
    }

    const db = getFirestore()
    const receiptRef = db.collection('accountingReceipts').doc(receiptId)
    const snapshot = await receiptRef.get()
    if (!snapshot.exists) {
      throw new HttpsError('not-found', '証憑が見つかりません。')
    }

    const receipt = snapshot.data() ?? {}
    const storedHash = toStringValue(receipt.fileHash).toLowerCase()
    if (storedHash && storedHash !== fileHash) {
      throw new HttpsError(
        'failed-precondition',
        '保存済み fileHash と要求 hash が一致しません。master を変更していないか確認してください。',
      )
    }

    if (toStringValue(receipt.timestampStatus) === 'issued') {
      return {
        ok: true as const,
        alreadyIssued: true,
        configured: true,
        provider: toStringValue(receipt.timestampProvider) || 'unknown',
        tokenId: toStringValue(receipt.timestampTokenId),
        algorithm: toStringValue(receipt.timestampAlgorithm),
        timestampedAt: toStringValue(receipt.timestampedAt),
        legalStatus: toStringValue(receipt.legalStatus),
        timestampStatus: 'issued' as const,
      }
    }

    const provider = resolveServerTimestampProvider()
    const issueInput: TimestampIssueRequest = {
      receiptId,
      version,
      fileHash,
      legalMasterStoragePath,
      franchiseeId: toStringValue(receipt.franchiseeId || receipt.companyId),
      storeId: toStringValue(receipt.storeId),
    }

    await receiptRef.update({
      timestampStatus: 'pending',
      updatedAt: new Date().toISOString(),
    })

    const issued = await provider.issue(issueInput)
    if (!issued.ok) {
      await receiptRef.update({
        timestampStatus: 'failed',
        timestampProvider: issued.provider,
        updatedAt: new Date().toISOString(),
      })
      logger.warn('Accounting timestamp issue failed', {
        receiptId,
        code: issued.code,
        configured: issued.configured,
      })
      return {
        ok: false as const,
        configured: issued.configured,
        provider: issued.provider,
        code: issued.code,
        message: issued.message,
        legalStatus: toStringValue(receipt.legalStatus) || 'legal_pending_timestamp',
        timestampStatus: 'failed' as const,
      }
    }

    const verified = await provider.verify({
      receiptId,
      version,
      fileHash,
      tokenBase64: issued.tokenBase64,
      provider: issued.provider,
    })

    if (!verified.ok) {
      await receiptRef.update({
        timestampStatus: 'verification_failed',
        timestampProvider: issued.provider,
        timestampTokenId: issued.tokenId,
        timestampAlgorithm: issued.algorithm,
        updatedAt: new Date().toISOString(),
      })
      return {
        ok: false as const,
        configured: true,
        provider: issued.provider,
        code: verified.code,
        message: verified.message,
        legalStatus: toStringValue(receipt.legalStatus) || 'legal_pending_timestamp',
        timestampStatus: 'verification_failed' as const,
      }
    }

    // 検証成功時のみ formal 状態へ。トークンはクライアントが Storage へ保存する。
    const requiresPaper =
      receipt.requiresPaperOriginal === true ||
      toStringValue(receipt.paperOriginalReason) === 'deadline_overdue' ||
      toStringValue(receipt.paperOriginalReason) === 'received_date_unknown' ||
      !toStringValue(receipt.receivedDate)
    const nextLegalStatus = requiresPaper
      ? 'late_saved'
      : 'legal_saved_accounting_pending'

    await receiptRef.update({
      timestampStatus: 'issued',
      timestampProvider: issued.provider,
      timestampTokenId: issued.tokenId,
      timestampAlgorithm: issued.algorithm,
      timestampedAt: issued.timestampedAt,
      timestampVerifiedAt: verified.verifiedAt,
      legalStatus: nextLegalStatus,
      legalSavedAt: issued.timestampedAt,
      requiresPaperOriginal: requiresPaper,
      updatedAt: new Date().toISOString(),
    })

    await receiptRef.collection('versions').doc(`v${version}`).set(
      {
        timestampStatus: 'issued',
        timestampProvider: issued.provider,
        timestampTokenId: issued.tokenId,
        timestampAlgorithm: issued.algorithm,
        timestampedAt: issued.timestampedAt,
        timestampVerifiedAt: verified.verifiedAt,
      },
      { merge: true },
    )

    return {
      ok: true as const,
      alreadyIssued: false,
      configured: true,
      provider: issued.provider,
      tokenId: issued.tokenId,
      algorithm: issued.algorithm,
      timestampedAt: issued.timestampedAt,
      verifiedAt: verified.verifiedAt,
      tokenBase64: issued.tokenBase64,
      legalStatus: nextLegalStatus,
      timestampStatus: 'issued' as const,
    }
  },
)
