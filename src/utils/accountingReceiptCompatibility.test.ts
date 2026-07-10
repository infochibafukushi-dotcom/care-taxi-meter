import { describe, expect, it } from 'vitest'
import { toStoredReceipt, getAccountingReceiptPreviewImageUrl } from '../services/accountingReceipts'
import {
  buildExpenseFormFromReceipt,
  hasStoredAccountingReceiptOcrImage,
} from './accountingExpenseForm'

const makeSnapshot = (data: Record<string, unknown>) => ({
  id: 'receipt-1',
  data: () => data,
})

describe('toStoredReceipt compatibility', () => {
  it('falls back legacy image fields', () => {
    const receipt = toStoredReceipt(
      makeSnapshot({
        franchiseeId: 'f1',
        storeId: 's1',
        storagePath: 'accounting/f1/s1/receipts/r1/a.jpg',
        downloadUrl: 'https://example.com/a.jpg',
        imageUrl: 'https://example.com/a.jpg',
        mimeType: 'image/jpeg',
        fileName: 'a.jpg',
        fileSizeBytes: 12,
        status: 'unorganized',
        uploadedBy: 'u1',
        uploadedByName: 'User',
      }),
    )

    expect(receipt.documentType).toBe('image')
    expect(receipt.originalDownloadUrl).toBe('https://example.com/a.jpg')
    expect(receipt.ocrImageDownloadUrl).toBe('https://example.com/a.jpg')
    expect(hasStoredAccountingReceiptOcrImage(receipt)).toBe(true)
    expect(getAccountingReceiptPreviewImageUrl(receipt)).toBe('https://example.com/a.jpg')
  })

  it('keeps PDF original and OCR preview separate', () => {
    const receipt = toStoredReceipt(
      makeSnapshot({
        franchiseeId: 'f1',
        storeId: 's1',
        storagePath: 'accounting/f1/s1/receipts/r1/original/a.pdf',
        downloadUrl: 'https://example.com/a.pdf',
        mimeType: 'application/pdf',
        fileName: 'a.pdf',
        fileSizeBytes: 100,
        documentType: 'pdf',
        originalStoragePath: 'accounting/f1/s1/receipts/r1/original/a.pdf',
        originalDownloadUrl: 'https://example.com/a.pdf',
        ocrImageStoragePath: 'accounting/f1/s1/receipts/r1/ocr/a.jpg',
        ocrImageDownloadUrl: 'https://example.com/a.jpg',
        pdfPageCount: 2,
        status: 'unorganized',
        uploadedBy: 'u1',
        uploadedByName: 'User',
      }),
    )

    expect(receipt.documentType).toBe('pdf')
    expect(receipt.pdfPageCount).toBe(2)
    expect(getAccountingReceiptPreviewImageUrl(receipt)).toBe('https://example.com/a.jpg')
    expect(receipt.originalDownloadUrl).toBe('https://example.com/a.pdf')

    const form = buildExpenseFormFromReceipt({
      receipt,
      franchiseeId: 'f1',
      storeId: 's1',
      staffId: 'u1',
      staffName: 'User',
    })

    expect(form.receiptImageUrl).toBe('https://example.com/a.jpg')
    expect(form.receiptFileUrl).toBe('https://example.com/a.pdf')
    expect(form.receiptFileMimeType).toBe('application/pdf')
    expect(form.receiptPreviewImageUrl).toBe('https://example.com/a.jpg')
  })

  it('does not treat legacy PDF downloadUrl as preview image', () => {
    const receipt = toStoredReceipt(
      makeSnapshot({
        franchiseeId: 'f1',
        storeId: 's1',
        storagePath: 'accounting/f1/s1/receipts/r1/a.pdf',
        downloadUrl: 'https://example.com/a.pdf',
        mimeType: 'application/pdf',
        fileName: 'a.pdf',
        fileSizeBytes: 100,
        status: 'unorganized',
        uploadedBy: 'u1',
        uploadedByName: 'User',
      }),
    )

    expect(receipt.documentType).toBe('pdf')
    expect(getAccountingReceiptPreviewImageUrl(receipt)).toBe('')
    expect(hasStoredAccountingReceiptOcrImage(receipt)).toBe(false)
  })
})

describe('delete path dedupe helper', () => {
  it('dedupes identical storage paths with Set', () => {
    const paths = new Set(
      [
        'accounting/f1/s1/receipts/r1/original/a.pdf',
        'accounting/f1/s1/receipts/r1/ocr/a.jpg',
        'accounting/f1/s1/receipts/r1/original/a.pdf',
        '',
      ]
        .map((path) => path.trim())
        .filter(Boolean),
    )

    expect([...paths]).toEqual([
      'accounting/f1/s1/receipts/r1/original/a.pdf',
      'accounting/f1/s1/receipts/r1/ocr/a.jpg',
    ])
  })
})
