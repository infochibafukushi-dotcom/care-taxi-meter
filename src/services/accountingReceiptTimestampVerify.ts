import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'

const functionsRegion = 'asia-northeast1'

export type VerifyAccountingReceiptTimestampResult =
  | {
      ok: true
      result: 'verified'
      code: string
      message: string
      fileHashMatches: true
      currentHash: string
      expectedHash: string
      provider: string
      verifiedAt: string
    }
  | {
      ok: false
      result: 'verification_failed'
      code: string
      message: string
      fileHashMatches: boolean
      currentHash?: string
      expectedHash?: string
      provider?: string
    }

/**
 * 保存済みタイムスタンプの事後検証（サーバー Callable）。
 * 異常時も Firestore / Storage は変更しない。
 */
export async function verifyAccountingReceiptTimestampClient(input: {
  receiptId: string
  version?: number
}): Promise<VerifyAccountingReceiptTimestampResult> {
  const receiptId = input.receiptId.trim()
  if (!receiptId) {
    throw new Error('receiptId は必須です。')
  }

  if (isReviewDemoRuntimeEnabled()) {
    return {
      ok: false,
      result: 'verification_failed',
      code: 'TIMESTAMP_PROVIDER_NOT_CONFIGURED',
      message: 'タイムスタンプサービス未設定（デモ）',
      fileHashMatches: false,
    }
  }

  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    { receiptId: string; version?: number },
    VerifyAccountingReceiptTimestampResult
  >(functions, 'verifyAccountingReceiptTimestamp')

  const response = await callable({
    receiptId,
    version: input.version,
  })
  return response.data
}
