import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { createHash } from 'node:crypto'
import { logger } from 'firebase-functions'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveServerTimestampProvider } from './accountingTimestampProvider'

type RequestBody = {
  receiptId?: string
  version?: number
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * 保存済みタイムスタンプの事後検証。
 * 異常時もデータは自動変更・削除しない（監査用に結果のみ返す）。
 */
export const verifyAccountingReceiptTimestamp = onCall(
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
      throw new HttpsError('permission-denied', 'タイムスタンプ検証権限がありません。')
    }

    const data = (request.data ?? {}) as RequestBody
    const receiptId = toStringValue(data.receiptId)
    const version = typeof data.version === 'number' && data.version > 0 ? data.version : 0
    if (!receiptId) {
      throw new HttpsError('invalid-argument', 'receiptId は必須です。')
    }

    const db = getFirestore()
    const receiptRef = db.collection('accountingReceipts').doc(receiptId)
    const snapshot = await receiptRef.get()
    if (!snapshot.exists) {
      throw new HttpsError('not-found', '証憑が見つかりません。')
    }
    const receipt = snapshot.data() ?? {}
    const activeVersion =
      version ||
      (typeof receipt.activeVersion === 'number' ? receipt.activeVersion : 0) ||
      (typeof receipt.version === 'number' ? receipt.version : 1)

    const versionSnap = await receiptRef.collection('versions').doc(`v${activeVersion}`).get()
    const versionData = versionSnap.exists ? versionSnap.data() ?? {} : {}

    const legalMasterStoragePath =
      toStringValue(versionData.legalMasterStoragePath) ||
      toStringValue(receipt.legalMasterStoragePath)
    const expectedHash =
      toStringValue(versionData.fileHash).toLowerCase() ||
      toStringValue(receipt.fileHash).toLowerCase()
    const tokenPath =
      toStringValue(versionData.timestampTokenStoragePath) ||
      toStringValue(receipt.timestampTokenStoragePath)
    const providerName =
      toStringValue(versionData.timestampProvider) ||
      toStringValue(receipt.timestampProvider) ||
      'unconfigured'

    if (!legalMasterStoragePath || !expectedHash) {
      return {
        ok: false as const,
        result: 'verification_failed' as const,
        code: 'MISSING_HASH_OR_MASTER',
        message: 'fileHash または master パスがありません。',
        fileHashMatches: false,
        currentHash: '',
        expectedHash,
      }
    }

    const bucket = getStorage().bucket()
    const masterFile = bucket.file(legalMasterStoragePath)
    const [exists] = await masterFile.exists()
    if (!exists) {
      return {
        ok: false as const,
        result: 'verification_failed' as const,
        code: 'MASTER_NOT_FOUND',
        message: '保存画像のハッシュが一致しません（master が存在しません）。',
        fileHashMatches: false,
        currentHash: '',
        expectedHash,
      }
    }

    const [masterBytes] = await masterFile.download()
    const currentHash = createHash('sha256').update(masterBytes).digest('hex')
    const fileHashMatches = currentHash === expectedHash

    if (!fileHashMatches) {
      logger.warn('Scanner master hash mismatch on verify', { receiptId, activeVersion })
      return {
        ok: false as const,
        result: 'verification_failed' as const,
        code: 'HASH_MISMATCH',
        message: '保存画像のハッシュが一致しません',
        fileHashMatches: false,
        currentHash,
        expectedHash,
      }
    }

    if (!tokenPath) {
      return {
        ok: false as const,
        result: 'verification_failed' as const,
        code: 'TOKEN_MISSING',
        message: 'タイムスタンプトークンが保存されていません。',
        fileHashMatches: true,
        currentHash,
        expectedHash,
      }
    }

    const tokenFile = bucket.file(tokenPath)
    const [tokenExists] = await tokenFile.exists()
    if (!tokenExists) {
      return {
        ok: false as const,
        result: 'verification_failed' as const,
        code: 'TOKEN_NOT_FOUND',
        message: 'タイムスタンプトークンファイルが見つかりません。',
        fileHashMatches: true,
        currentHash,
        expectedHash,
      }
    }

    const [tokenBytes] = await tokenFile.download()
    const tokenBase64 = Buffer.from(tokenBytes).toString('base64')
    const provider = resolveServerTimestampProvider()
    const verified = await provider.verify({
      receiptId,
      version: activeVersion,
      fileHash: expectedHash,
      tokenBase64,
      provider: providerName,
    })

    if (!verified.ok) {
      return {
        ok: false as const,
        result: 'verification_failed' as const,
        code: verified.code,
        message: verified.message,
        fileHashMatches: true,
        currentHash,
        expectedHash,
        provider: verified.provider,
      }
    }

    return {
      ok: true as const,
      result: 'verified' as const,
      code: 'OK',
      message: 'タイムスタンプ検証に成功しました。',
      fileHashMatches: true,
      currentHash,
      expectedHash,
      provider: verified.provider,
      verifiedAt: verified.verifiedAt,
    }
  },
)
