import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE,
  ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE,
  buildAccountingReceiptStorageFileName,
  detectAccountingReceiptDocumentType,
  sanitizeAccountingReceiptFileName,
  validateAccountingReceiptUploadFile,
} from './accountingReceiptFile'
import {
  hasStoredAccountingReceiptFile,
  hasStoredAccountingReceiptImage,
  hasStoredAccountingReceiptOcrImage,
} from './accountingExpenseForm'
import type { StoredAccountingReceipt } from '../types/accounting'

const makeFile = (name: string, type: string, sizeBytes: number) => {
  const buffer = new Uint8Array(Math.min(sizeBytes, 16))
  const file = new File([buffer], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

describe('accountingReceiptFile validation', () => {
  it('accepts JPEG, PNG, WebP, and PDF', () => {
    expect(validateAccountingReceiptUploadFile(makeFile('a.jpg', 'image/jpeg', 100)).ok).toBe(true)
    expect(validateAccountingReceiptUploadFile(makeFile('a.png', 'image/png', 100)).ok).toBe(true)
    expect(validateAccountingReceiptUploadFile(makeFile('a.webp', 'image/webp', 100)).ok).toBe(true)
    expect(validateAccountingReceiptUploadFile(makeFile('a.pdf', 'application/pdf', 100)).ok).toBe(true)
  })

  it('rejects unsupported types', () => {
    const gif = validateAccountingReceiptUploadFile(makeFile('a.gif', 'image/gif', 100))
    expect(gif.ok).toBe(false)
    if (!gif.ok) {
      expect(gif.message).toBe(ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE)
    }

    const bad = validateAccountingReceiptUploadFile(makeFile('a.txt', 'text/plain', 100))
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.message).toBe(ACCOUNTING_RECEIPT_UNSUPPORTED_TYPE_MESSAGE)
    }
  })

  it('rejects files 10MB or larger', () => {
    const result = validateAccountingReceiptUploadFile(
      makeFile('big.pdf', 'application/pdf', 10 * 1024 * 1024),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(ACCOUNTING_RECEIPT_FILE_TOO_LARGE_MESSAGE)
    }
  })

  it('detects document type from mime and extension', () => {
    expect(detectAccountingReceiptDocumentType({ name: 'x.pdf', type: '' })).toBe('pdf')
    expect(detectAccountingReceiptDocumentType({ name: 'x.jpg', type: 'image/jpeg' })).toBe('image')
  })

  it('sanitizes file names safely', () => {
    expect(sanitizeAccountingReceiptFileName('../../evil\\name.pdf')).toBe('.._.._evil_name.pdf')
    expect(sanitizeAccountingReceiptFileName('   ')).toBe('receipt')
    expect(buildAccountingReceiptStorageFileName('invoice.pdf', { uniqueSuffix: 'abc' })).toBe(
      'invoice-abc.pdf',
    )
    expect(
      buildAccountingReceiptStorageFileName('invoice.pdf', {
        forceExtension: 'jpg',
        uniqueSuffix: 'abc',
      }),
    ).toBe('invoice-abc.jpg')
  })
})

describe('receipt OCR image helpers', () => {
  const baseReceipt = (overrides: Partial<StoredAccountingReceipt> = {}): StoredAccountingReceipt => ({
    id: 'r1',
    franchiseeId: 'f1',
    companyId: 'f1',
    storeId: 's1',
    storagePath: 'path/a.jpg',
    downloadUrl: 'https://example.com/a.jpg',
    imageUrl: 'https://example.com/a.jpg',
    mimeType: 'image/jpeg',
    fileName: 'a.jpg',
    fileSizeBytes: 10,
    status: 'unorganized',
    uploadedBy: 'u1',
    uploadedByName: 'User',
    ...overrides,
  })

  it('treats legacy image receipts as OCR-ready', () => {
    const receipt = baseReceipt()
    expect(hasStoredAccountingReceiptImage(receipt)).toBe(true)
    expect(hasStoredAccountingReceiptOcrImage(receipt)).toBe(true)
    expect(hasStoredAccountingReceiptFile(receipt)).toBe(true)
  })

  it('requires OCR preview for PDF receipts', () => {
    const pdfOnly = baseReceipt({
      documentType: 'pdf',
      mimeType: 'application/pdf',
      downloadUrl: 'https://example.com/a.pdf',
      imageUrl: '',
      storagePath: 'path/a.pdf',
      ocrImageDownloadUrl: '',
      ocrImageStoragePath: '',
    })
    expect(hasStoredAccountingReceiptOcrImage(pdfOnly)).toBe(false)
    expect(hasStoredAccountingReceiptFile(pdfOnly)).toBe(true)

    const pdfWithPreview = baseReceipt({
      documentType: 'pdf',
      mimeType: 'application/pdf',
      downloadUrl: 'https://example.com/a.pdf',
      ocrImageDownloadUrl: 'https://example.com/a-ocr.jpg',
      ocrImageStoragePath: 'path/a-ocr.jpg',
    })
    expect(hasStoredAccountingReceiptOcrImage(pdfWithPreview)).toBe(true)
  })
})