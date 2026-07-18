import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHttpsCallable, mockCallable } = vi.hoisted(() => {
  const mockCallable = vi.fn()
  const mockHttpsCallable = vi.fn(() => mockCallable)
  return { mockHttpsCallable, mockCallable }
})

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: mockHttpsCallable,
}))

vi.mock('../lib/firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
}))

const { mockIsReviewDemoRuntimeEnabled } = vi.hoisted(() => ({
  mockIsReviewDemoRuntimeEnabled: vi.fn(() => false),
}))

vi.mock('../utils/reviewDemo', () => ({
  isReviewDemoRuntimeEnabled: mockIsReviewDemoRuntimeEnabled,
}))

import {
  clearAccountingReceiptAccessUrlCacheForTests,
  fetchAccountingReceiptAccessUrl,
} from './accountingReceiptAccess'

describe('fetchAccountingReceiptAccessUrl', () => {
  beforeEach(() => {
    clearAccountingReceiptAccessUrlCacheForTests()
    mockCallable.mockReset()
    mockHttpsCallable.mockClear()
    mockIsReviewDemoRuntimeEnabled.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('receiptId が空なら呼び出さずに例外を投げる', async () => {
    await expect(fetchAccountingReceiptAccessUrl({ receiptId: '' })).rejects.toThrow()
    expect(mockCallable).not.toHaveBeenCalled()
  })

  it('Cloud Function を呼び出し URL を取得する', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        url: 'https://storage.googleapis.com/signed-url-1',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        variant: 'preview',
        receiptId: 'r1',
      },
    })

    const result = await fetchAccountingReceiptAccessUrl({ receiptId: 'r1', variant: 'preview' })

    expect(result.url).toBe('https://storage.googleapis.com/signed-url-1')
    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(mockCallable).toHaveBeenCalledWith({ receiptId: 'r1', variant: 'preview' })
  })

  it('同一 receiptId+variant の連打は inflight 共有で1回だけ呼ばれる', async () => {
    let resolveCallable: (value: unknown) => void = () => {}
    mockCallable.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCallable = resolve
        }),
    )

    const promise1 = fetchAccountingReceiptAccessUrl({ receiptId: 'r2', variant: 'preview' })
    const promise2 = fetchAccountingReceiptAccessUrl({ receiptId: 'r2', variant: 'preview' })

    resolveCallable({
      data: {
        url: 'https://storage.googleapis.com/signed-url-2',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        variant: 'preview',
        receiptId: 'r2',
      },
    })

    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(result1.url).toBe('https://storage.googleapis.com/signed-url-2')
    expect(result2.url).toBe('https://storage.googleapis.com/signed-url-2')
  })

  it('有効期限内のキャッシュは再取得せず再利用する', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        url: 'https://storage.googleapis.com/signed-url-3',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        variant: 'preview',
        receiptId: 'r3',
      },
    })

    const first = await fetchAccountingReceiptAccessUrl({ receiptId: 'r3', variant: 'preview' })
    const second = await fetchAccountingReceiptAccessUrl({ receiptId: 'r3', variant: 'preview' })

    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(second.url).toBe(first.url)
  })

  it('forceRefresh を指定するとキャッシュを無視して再取得する', async () => {
    mockCallable
      .mockResolvedValueOnce({
        data: {
          url: 'https://storage.googleapis.com/signed-url-4a',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          variant: 'preview',
          receiptId: 'r4',
        },
      })
      .mockResolvedValueOnce({
        data: {
          url: 'https://storage.googleapis.com/signed-url-4b',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          variant: 'preview',
          receiptId: 'r4',
        },
      })

    const first = await fetchAccountingReceiptAccessUrl({ receiptId: 'r4', variant: 'preview' })
    const second = await fetchAccountingReceiptAccessUrl({
      receiptId: 'r4',
      variant: 'preview',
      forceRefresh: true,
    })

    expect(mockCallable).toHaveBeenCalledTimes(2)
    expect(first.url).toBe('https://storage.googleapis.com/signed-url-4a')
    expect(second.url).toBe('https://storage.googleapis.com/signed-url-4b')
  })

  it('異なる variant はキャッシュを共有しない', async () => {
    mockCallable
      .mockResolvedValueOnce({
        data: {
          url: 'https://storage.googleapis.com/signed-url-preview',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          variant: 'preview',
          receiptId: 'r5',
        },
      })
      .mockResolvedValueOnce({
        data: {
          url: 'https://storage.googleapis.com/signed-url-original',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          variant: 'original',
          receiptId: 'r5',
        },
      })

    const preview = await fetchAccountingReceiptAccessUrl({ receiptId: 'r5', variant: 'preview' })
    const original = await fetchAccountingReceiptAccessUrl({ receiptId: 'r5', variant: 'original' })

    expect(mockCallable).toHaveBeenCalledTimes(2)
    expect(preview.url).not.toBe(original.url)
  })

  it('レビューデモ実行時は Cloud Function を呼ばず空 URL を返す', async () => {
    mockIsReviewDemoRuntimeEnabled.mockReturnValue(true)

    const result = await fetchAccountingReceiptAccessUrl({ receiptId: 'r6', variant: 'preview' })

    expect(result.url).toBe('')
    expect(mockCallable).not.toHaveBeenCalled()
  })

  it('URL が空で返ってきた場合は例外を投げる', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        url: '',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        variant: 'preview',
        receiptId: 'r7',
      },
    })

    await expect(fetchAccountingReceiptAccessUrl({ receiptId: 'r7', variant: 'preview' })).rejects.toThrow()
  })
})
