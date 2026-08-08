import { describe, expect, it } from 'vitest'
import { resolveAccountingReceiptStoragePathForVariant } from './accountingReceiptAccessPolicy'

describe('accountingReceiptAccessPolicy variants', () => {
  const scannerReceipt = {
    id: 'r1',
    franchiseeId: 'f1',
    companyId: 'f1',
    storeId: 's1',
    legalMasterStoragePath: 'accounting/f1/s1/receipts/r1/legal/v1/master.jpg',
    thumbnailStoragePath: 'accounting/f1/s1/receipts/r1/legal/v1/thumb.webp',
    originalStoragePath: '',
    ocrImageStoragePath: '',
    storagePath: 'accounting/f1/s1/receipts/r1/legal/v1/master.jpg',
    captureMode: 'scanner_v1',
  }

  const legacyReceipt = {
    id: 'r2',
    franchiseeId: 'f1',
    companyId: 'f1',
    storeId: 's1',
    originalStoragePath: 'accounting/f1/s1/receipts/r2/original/a.jpg',
    ocrImageStoragePath: 'accounting/f1/s1/receipts/r2/original/a.jpg',
    storagePath: 'accounting/f1/s1/receipts/r2/original/a.jpg',
  }

  it('prefers thumbnail for preview on scanner receipts', () => {
    expect(resolveAccountingReceiptStoragePathForVariant(scannerReceipt, 'preview')).toBe(
      scannerReceipt.thumbnailStoragePath,
    )
    expect(resolveAccountingReceiptStoragePathForVariant(scannerReceipt, 'master')).toBe(
      scannerReceipt.legalMasterStoragePath,
    )
  })

  it('keeps legacy preview/original behavior', () => {
    expect(resolveAccountingReceiptStoragePathForVariant(legacyReceipt, 'preview')).toBe(
      legacyReceipt.ocrImageStoragePath,
    )
    expect(resolveAccountingReceiptStoragePathForVariant(legacyReceipt, 'original')).toBe(
      legacyReceipt.originalStoragePath,
    )
  })
})
