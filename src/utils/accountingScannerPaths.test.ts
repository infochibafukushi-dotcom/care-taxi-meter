import { describe, expect, it } from 'vitest'
import {
  buildLegalMasterStoragePath,
  buildLegalThumbnailStoragePath,
  buildLegalTimestampTokenStoragePath,
} from './accountingScannerPaths'

const base = {
  franchiseeId: 'franchisee-a',
  storeId: 'store-b',
  receiptId: 'receipt-xyz',
}

describe('accountingScannerPaths', () => {
  it('builds master path with default v1', () => {
    expect(buildLegalMasterStoragePath(base)).toBe(
      'accounting/franchisee-a/store-b/receipts/receipt-xyz/legal/v1/master.jpg',
    )
  })

  it('builds thumbnail path with default webp', () => {
    expect(buildLegalThumbnailStoragePath(base)).toBe(
      'accounting/franchisee-a/store-b/receipts/receipt-xyz/legal/v1/thumb.webp',
    )
  })

  it('builds thumbnail path with jpg override', () => {
    expect(
      buildLegalThumbnailStoragePath({ ...base, version: 2, thumbExt: 'jpg' }),
    ).toBe('accounting/franchisee-a/store-b/receipts/receipt-xyz/legal/v2/thumb.jpg')
  })

  it('builds timestamp token path', () => {
    expect(buildLegalTimestampTokenStoragePath({ ...base, version: 3 })).toBe(
      'accounting/franchisee-a/store-b/receipts/receipt-xyz/legal/v3/timestamp.tsr',
    )
  })

  it('keeps franchisee/store/receipt segments stable across object types', () => {
    const prefix = `accounting/${base.franchiseeId}/${base.storeId}/receipts/${base.receiptId}/legal/v1`
    expect(buildLegalMasterStoragePath(base)).toBe(`${prefix}/master.jpg`)
    expect(buildLegalThumbnailStoragePath(base)).toBe(`${prefix}/thumb.webp`)
    expect(buildLegalTimestampTokenStoragePath(base)).toBe(`${prefix}/timestamp.tsr`)
  })
})
