import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import type { AccountingReceiptAccessVariant } from '../utils/accountingReceiptAccessPolicy'

const functionsRegion = 'asia-northeast1'

export type AccountingReceiptAccessUrlResult = {
  url: string
  expiresAt: string
  variant: AccountingReceiptAccessVariant
  receiptId: string
}

type CacheEntry = {
  result: AccountingReceiptAccessUrlResult
  /** 期限の少し前で再取得するため */
  refreshAfterMs: number
}

const memoryCache = new Map<string, CacheEntry>()
const inflightRequests = new Map<string, Promise<AccountingReceiptAccessUrlResult>>()

const cacheKey = (receiptId: string, variant: AccountingReceiptAccessVariant) =>
  `${receiptId}::${variant}`

const REFRESH_SKEW_MS = 30_000

/**
 * 短時間有効な証憑アクセス URL を取得する。
 * - メモリキャッシュのみ（localStorage / sessionStorage には保存しない）
 * - 同一 receiptId+variant の連打は inflight 共有で抑止
 * - 期限切れ（または直前）は再取得
 */
export async function fetchAccountingReceiptAccessUrl({
  receiptId,
  variant = 'preview',
  forceRefresh = false,
}: {
  receiptId: string
  variant?: AccountingReceiptAccessVariant
  forceRefresh?: boolean
}): Promise<AccountingReceiptAccessUrlResult> {
  const id = receiptId.trim()
  if (!id) {
    throw new Error('receiptId は必須です。')
  }

  if (isReviewDemoRuntimeEnabled()) {
    return {
      url: '',
      expiresAt: new Date(Date.now() + 7 * 60 * 1000).toISOString(),
      variant,
      receiptId: id,
    }
  }

  const key = cacheKey(id, variant)
  const now = Date.now()
  const cached = memoryCache.get(key)
  if (!forceRefresh && cached && cached.refreshAfterMs > now) {
    return cached.result
  }

  const inflight = inflightRequests.get(key)
  if (inflight) {
    return inflight
  }

  const request = (async () => {
    const functions = getFunctions(getFirebaseApp(), functionsRegion)
    const callable = httpsCallable<
      { receiptId: string; variant: AccountingReceiptAccessVariant },
      AccountingReceiptAccessUrlResult
    >(functions, 'getAccountingReceiptAccessUrl')

    const response = await callable({ receiptId: id, variant })
    const data = response.data
    const url = typeof data?.url === 'string' ? data.url.trim() : ''
    const expiresAt =
      typeof data?.expiresAt === 'string' && data.expiresAt.trim()
        ? data.expiresAt.trim()
        : new Date(now + 7 * 60 * 1000).toISOString()

    if (!url) {
      throw new Error('証憑URLの取得に失敗しました。')
    }

    const result: AccountingReceiptAccessUrlResult = {
      url,
      expiresAt,
      variant: data?.variant === 'original' ? 'original' : 'preview',
      receiptId: typeof data?.receiptId === 'string' && data.receiptId.trim() ? data.receiptId : id,
    }

    const expiresAtMs = Date.parse(expiresAt)
    memoryCache.set(key, {
      result,
      refreshAfterMs: Number.isFinite(expiresAtMs)
        ? Math.max(now, expiresAtMs - REFRESH_SKEW_MS)
        : now + 6 * 60 * 1000,
    })

    return result
  })()

  inflightRequests.set(key, request)
  try {
    return await request
  } finally {
    inflightRequests.delete(key)
  }
}

/** テスト用: メモリキャッシュと inflight をクリア */
export function clearAccountingReceiptAccessUrlCacheForTests() {
  memoryCache.clear()
  inflightRequests.clear()
}
