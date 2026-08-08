import { describe, expect, it } from 'vitest'
import type { StoredAccountingReceipt } from '../types/accounting'
import {
  buildScannerReceiptExportCsv,
  buildScannerReceiptExportFileName,
  buildScannerReceiptExportIndexJson,
  SCANNER_RECEIPT_EXPORT_CSV_HEADERS,
  toScannerReceiptExportRow,
} from './accountingScannerExport'

const receipt = (overrides: Partial<StoredAccountingReceipt>): StoredAccountingReceipt => ({
  id: 'r-export-1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  storagePath: 'accounting/f1/s1/receipts/r-export-1/legal/v1/master.jpg',
  downloadUrl: '',
  mimeType: 'image/jpeg',
  fileName: 'master.jpg',
  fileSizeBytes: 2048,
  status: 'unorganized',
  uploadedBy: 'u1',
  uploadedByName: 'User',
  captureMode: 'scanner_v1',
  legalStatus: 'legal_saved_accounting_pending',
  timestampStatus: 'issued',
  transactionDate: '2026-07-10',
  receivedDate: '2026-07-08',
  vendorNameCandidate: 'テスト商店',
  amountTotalCandidate: 1080,
  version: 1,
  activeVersion: 1,
  fileHash: 'abc123',
  capturedAt: '2026-07-10T09:00:00.000Z',
  legalSavedAt: '2026-07-10T09:05:00.000Z',
  timestampedAt: '2026-07-10T09:05:01.000Z',
  legalMasterStoragePath: 'accounting/f1/s1/receipts/r-export-1/legal/v1/master.jpg',
  timestampTokenStoragePath: 'accounting/f1/s1/receipts/r-export-1/legal/v1/timestamp.tsr',
  ...overrides,
})

describe('accountingScannerExport', () => {
  it('maps receipt to export row with required fields', () => {
    const row = toScannerReceiptExportRow(receipt({}))
    expect(row.receiptId).toBe('r-export-1')
    expect(row.vendorName).toBe('テスト商店')
    expect(row.amount).toBe(1080)
    expect(row.legalStatus).toBe('legal_saved_accounting_pending')
    expect(row.timestampStatus).toBe('issued')
    expect(row.fileHash).toBe('abc123')
    expect(row.deleted).toBe('no')
  })

  it('builds CSV with UTF-8 BOM and required headers', () => {
    const csv = buildScannerReceiptExportCsv([
      receipt({}),
      receipt({ id: 'legacy', captureMode: 'legacy' }),
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain(SCANNER_RECEIPT_EXPORT_CSV_HEADERS.join(','))
    expect(csv).toContain('r-export-1,1,2026-07-10,2026-07-08,1080,テスト商店')
    expect(csv).not.toContain('legacy')
  })

  it('escapes vendor names containing commas', () => {
    const csv = buildScannerReceiptExportCsv([
      receipt({ vendorNameCandidate: '店舗,株式会社' }),
    ])
    expect(csv).toContain('"店舗,株式会社"')
  })

  it('builds deterministic export file name from date', () => {
    expect(buildScannerReceiptExportFileName('2026-07-10T12:00:00.000Z')).toBe(
      'scanner-receipts-20260710.csv',
    )
  })

  it('builds JSON index for bulk export manifest', () => {
    const json = buildScannerReceiptExportIndexJson([receipt({})])
    const parsed = JSON.parse(json) as {
      schemaVersion: number
      entries: Array<{ receiptId: string; fileHash: string }>
    }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].receiptId).toBe('r-export-1')
    expect(parsed.entries[0].fileHash).toBe('abc123')
  })
})
