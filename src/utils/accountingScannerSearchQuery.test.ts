import { describe, expect, it } from 'vitest'
import type { StoredAccountingReceipt } from '../types/accounting'
import {
  DEFAULT_SCANNER_RECEIPT_LIST_FILTERS,
  describeScannerReceiptFilters,
  queryScannerReceiptList,
} from './accountingScannerSearchQuery'

const receipt = (overrides: Partial<StoredAccountingReceipt>): StoredAccountingReceipt => ({
  id: 'r1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  storagePath: '',
  downloadUrl: '',
  mimeType: 'image/jpeg',
  fileName: 'master.jpg',
  fileSizeBytes: 1000,
  status: 'unorganized',
  uploadedBy: 'u1',
  uploadedByName: 'User',
  captureMode: 'scanner_v1',
  legalStatus: 'legal_saved_accounting_pending',
  timestampStatus: 'issued',
  transactionDate: '2026-07-10',
  receivedDate: '2026-07-08',
  vendorNameCandidate: 'セブンイレブン',
  amountTotalCandidate: 550,
  ...overrides,
})

const sampleReceipts: StoredAccountingReceipt[] = [
  receipt({ id: 'r1' }),
  receipt({
    id: 'r2',
    transactionDate: '2026-07-15',
    receivedDate: '2026-07-14',
    vendorNameCandidate: 'アマゾン',
    amountTotalCandidate: 3200,
    legalStatus: 'legal_pending_timestamp',
    timestampStatus: 'pending',
  }),
  receipt({
    id: 'r3',
    transactionDate: '2026-06-01',
    vendorNameCandidate: '削除済み店',
    legalStatus: 'deleted',
    isDeleted: true,
    timestampStatus: 'issued',
  }),
  receipt({
    id: 'legacy',
    captureMode: 'legacy',
    vendorNameCandidate: 'legacy shop',
  }),
]

describe('queryScannerReceiptList', () => {
  it('returns only scanner_v1 receipts by default', () => {
    const result = queryScannerReceiptList({ receipts: sampleReceipts })
    expect(result.items.map((item) => item.id)).toEqual(['r1', 'r2'])
    expect(result.totalCount).toBe(2)
  })

  it('filters by transaction date range', () => {
    const result = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: { transactionDateFrom: '2026-07-01', transactionDateTo: '2026-07-12' },
    })
    expect(result.items.map((item) => item.id)).toEqual(['r1'])
    expect(result.isFiltered).toBe(true)
  })

  it('filters by received date range', () => {
    const result = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: { receivedDateFrom: '2026-07-14', receivedDateTo: '2026-07-20' },
    })
    expect(result.items.map((item) => item.id)).toEqual(['r2'])
  })

  it('filters by vendor partial match', () => {
    const result = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: { vendorQuery: 'アマゾン' },
    })
    expect(result.items.map((item) => item.id)).toEqual(['r2'])
  })

  it('filters by amount range', () => {
    const result = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: { amountMin: '1000', amountMax: '5000' },
    })
    expect(result.items.map((item) => item.id)).toEqual(['r2'])
  })

  it('filters by legalStatus', () => {
    const result = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: { legalStatus: 'legal_pending_timestamp' },
    })
    expect(result.items.map((item) => item.id)).toEqual(['r2'])
  })

  it('excludes deleted unless includeDeleted', () => {
    const withoutDeleted = queryScannerReceiptList({ receipts: sampleReceipts })
    expect(withoutDeleted.items.some((item) => item.id === 'r3')).toBe(false)

    const withDeleted = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: { includeDeleted: true },
    })
    expect(withDeleted.items.map((item) => item.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('combines multiple filters', () => {
    const result = queryScannerReceiptList({
      receipts: sampleReceipts,
      filters: {
        transactionDateFrom: '2026-07-01',
        vendorQuery: 'セブン',
        amountMax: '1000',
      },
    })
    expect(result.items.map((item) => item.id)).toEqual(['r1'])
    expect(result.activeConditionLabels.length).toBeGreaterThan(0)
  })

  it('describeScannerReceiptFilters returns empty for defaults', () => {
    expect(describeScannerReceiptFilters(DEFAULT_SCANNER_RECEIPT_LIST_FILTERS)).toEqual([])
  })
})
