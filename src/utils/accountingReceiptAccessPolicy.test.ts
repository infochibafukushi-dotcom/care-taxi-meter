import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE,
  ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS,
  ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE,
  ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE,
  assertAccountingReceiptStoragePathBelongsToReceipt,
  assertCanAccessAccountingReceipt,
  buildAccountingReceiptAccessLogFields,
  stripPersistentAccountingReceiptUrls,
  type AccountingReceiptAccessAuth,
  type AccountingReceiptAccessRecord,
} from './accountingReceiptAccessPolicy'

const baseReceipt: AccountingReceiptAccessRecord = {
  id: 'r1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  storagePath: 'accounting/f1/s1/receipts/r1/original/a.jpg',
}

const authOf = (overrides: Partial<AccountingReceiptAccessAuth>): AccountingReceiptAccessAuth => ({
  uid: 'u1',
  role: 'owner',
  franchiseeId: 'f1',
  storeId: 's1',
  ...overrides,
})

describe('assertCanAccessAccountingReceipt', () => {
  it('未認証は拒否される', () => {
    expect(() => assertCanAccessAccountingReceipt(null, baseReceipt)).toThrow(
      ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE,
    )
    expect(() => assertCanAccessAccountingReceipt(undefined, baseReceipt)).toThrow(
      ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE,
    )
    expect(() => assertCanAccessAccountingReceipt({ uid: '', role: 'owner', franchiseeId: 'f1', storeId: 's1' }, baseReceipt)).toThrow(
      ACCOUNTING_RECEIPT_UNAUTHENTICATED_MESSAGE,
    )
  })

  it('driver ロールは拒否される', () => {
    expect(() =>
      assertCanAccessAccountingReceipt(authOf({ role: 'driver' }), baseReceipt),
    ).toThrow(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  })

  it('他加盟店の owner は拒否される', () => {
    expect(() =>
      assertCanAccessAccountingReceipt(
        authOf({ role: 'owner', franchiseeId: 'other-f' }),
        baseReceipt,
      ),
    ).toThrow(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  })

  it('同一加盟店の owner は他店舗でも許可される', () => {
    expect(() =>
      assertCanAccessAccountingReceipt(
        authOf({ role: 'owner', franchiseeId: 'f1', storeId: 'other-store' }),
        baseReceipt,
      ),
    ).not.toThrow()
  })

  it('同一加盟店・他店舗の manager は拒否される', () => {
    expect(() =>
      assertCanAccessAccountingReceipt(
        authOf({ role: 'manager', franchiseeId: 'f1', storeId: 'other-store' }),
        baseReceipt,
      ),
    ).toThrow(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  })

  it('同一店舗の manager は許可される', () => {
    expect(() =>
      assertCanAccessAccountingReceipt(
        authOf({ role: 'manager', franchiseeId: 'f1', storeId: 's1' }),
        baseReceipt,
      ),
    ).not.toThrow()
  })

  it('hq_admin は加盟店・店舗を問わず許可される', () => {
    expect(() =>
      assertCanAccessAccountingReceipt(
        authOf({ role: 'hq_admin', franchiseeId: 'other-f', storeId: 'other-s' }),
        baseReceipt,
      ),
    ).not.toThrow()
    expect(() =>
      assertCanAccessAccountingReceipt(
        authOf({ role: 'superAdmin', franchiseeId: 'other-f', storeId: 'other-s' }),
        baseReceipt,
      ),
    ).not.toThrow()
  })
})

describe('buildAccountingReceiptAccessLogFields', () => {
  it('url / token を含まないログフィールドのみ返す', () => {
    const fields = buildAccountingReceiptAccessLogFields({
      receiptId: 'r1',
      variant: 'preview',
      uid: 'u1',
      role: 'owner',
      franchiseeId: 'f1',
      storeId: 's1',
      expiresAt: '2026-07-18T00:00:00.000Z',
      url: 'https://storage.googleapis.com/secret-token-url',
      token: 'secret-token',
    })

    expect(fields).not.toHaveProperty('url')
    expect(fields).not.toHaveProperty('token')
    expect(JSON.stringify(fields)).not.toContain('secret-token')
    expect(fields).toEqual({
      receiptId: 'r1',
      variant: 'preview',
      uid: 'u1',
      role: 'owner',
      franchiseeId: 'f1',
      storeId: 's1',
      expiresAt: '2026-07-18T00:00:00.000Z',
    })
  })
})

describe('assertAccountingReceiptStoragePathBelongsToReceipt', () => {
  it('自テナント配下の正しいパスは許可される', () => {
    expect(() =>
      assertAccountingReceiptStoragePathBelongsToReceipt(
        'accounting/f1/s1/receipts/r1/original/a.jpg',
        baseReceipt,
      ),
    ).not.toThrow()
  })

  it('他社（他 franchiseeId）配下のパスは拒否される', () => {
    expect(() =>
      assertAccountingReceiptStoragePathBelongsToReceipt(
        'accounting/other-f/s1/receipts/r1/original/a.jpg',
        baseReceipt,
      ),
    ).toThrow(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  })

  it('他 receiptId 配下のパスは拒否される', () => {
    expect(() =>
      assertAccountingReceiptStoragePathBelongsToReceipt(
        'accounting/f1/s1/receipts/other-receipt/original/a.jpg',
        baseReceipt,
      ),
    ).toThrow(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  })

  it('パストラバーサルは拒否される', () => {
    expect(() =>
      assertAccountingReceiptStoragePathBelongsToReceipt(
        'accounting/f1/s1/receipts/r1/../../../etc/passwd',
        baseReceipt,
      ),
    ).toThrow(ACCOUNTING_RECEIPT_ACCESS_DENIED_MESSAGE)
  })

  it('空パスは拒否される', () => {
    expect(() => assertAccountingReceiptStoragePathBelongsToReceipt('', baseReceipt)).toThrow(
      ACCOUNTING_RECEIPT_PATH_MISSING_MESSAGE,
    )
  })
})

describe('stripPersistentAccountingReceiptUrls', () => {
  it('永続 URL フィールドを全て空文字にする', () => {
    const stripped = stripPersistentAccountingReceiptUrls({
      downloadUrl: 'https://example.com/a.jpg',
      imageUrl: 'https://example.com/a.jpg',
      originalDownloadUrl: 'https://example.com/a.jpg',
      ocrImageDownloadUrl: 'https://example.com/a.jpg',
      receiptImageUrl: 'https://example.com/a.jpg',
      receiptPreviewImageUrl: 'https://example.com/a.jpg',
      receiptFileUrl: 'https://example.com/a.jpg',
      storagePath: 'accounting/f1/s1/receipts/r1/original/a.jpg',
      receiptId: 'r1',
    })

    expect(stripped.downloadUrl).toBe('')
    expect(stripped.imageUrl).toBe('')
    expect(stripped.originalDownloadUrl).toBe('')
    expect(stripped.ocrImageDownloadUrl).toBe('')
    expect(stripped.receiptImageUrl).toBe('')
    expect(stripped.receiptPreviewImageUrl).toBe('')
    expect(stripped.receiptFileUrl).toBe('')
    expect(stripped.storagePath).toBe('accounting/f1/s1/receipts/r1/original/a.jpg')
    expect(stripped.receiptId).toBe('r1')
  })

  it('存在しないフィールドは追加しない', () => {
    const stripped = stripPersistentAccountingReceiptUrls({ receiptId: 'r1' })
    expect(stripped).toEqual({ receiptId: 'r1' })
  })
})

describe('ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS', () => {
  it('5分〜10分の範囲である', () => {
    expect(ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
    expect(ACCOUNTING_RECEIPT_ACCESS_URL_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000)
  })
})
