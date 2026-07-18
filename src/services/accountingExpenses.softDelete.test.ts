import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetDoc,
  mockGetDocs,
  mockUpdate,
  mockCommit,
  mockWriteBatch,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
} = vi.hoisted(() => {
  const mockUpdate = vi.fn()
  const mockCommit = vi.fn(async () => undefined)
  const mockWriteBatch = vi.fn(() => ({
    update: mockUpdate,
    commit: mockCommit,
  }))
  return {
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockUpdate,
    mockCommit,
    mockWriteBatch,
    mockDoc: vi.fn((_db: unknown, collectionName: string, id: string) => ({
      path: `${collectionName}/${id}`,
      id,
      collectionName,
    })),
    mockCollection: vi.fn((_db: unknown, name: string) => ({ name })),
    mockQuery: vi.fn((...args: unknown[]) => args),
    mockWhere: vi.fn((...args: unknown[]) => args),
  }
})

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: mockDoc,
  collection: mockCollection,
  query: mockQuery,
  where: mockWhere,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  writeBatch: mockWriteBatch,
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  deleteField: vi.fn(() => ({ __delete: true })),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  orderBy: vi.fn(),
}))

vi.mock('../lib/firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
}))

vi.mock('../utils/reviewDemo', () => ({
  isReviewDemoRuntimeEnabled: vi.fn(() => false),
}))

vi.mock('./auditLogs', () => ({
  createAuditLog: vi.fn(async () => undefined),
}))

import { softDeleteAccountingExpense } from './accountingExpenses'

describe('softDeleteAccountingExpense receipt unlink', () => {
  beforeEach(() => {
    mockUpdate.mockClear()
    mockCommit.mockClear()
    mockGetDoc.mockReset()
    mockGetDocs.mockReset()
  })

  it('unlinks linked receipt in the same batch as expense soft-delete', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          receiptId: 'r1',
          franchiseeId: 'f1',
          storeId: 's1',
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          linkedExpenseId: 'e1',
          ocrCandidates: { vendorName: 'x' },
        }),
      })
    // receipts by linkedExpenseId, then assets by expenseId (+ optional fallback)
    mockGetDocs
      .mockResolvedValueOnce({
        docs: [{ id: 'r1' }],
      })
      .mockResolvedValue({
        docs: [],
      })

    await softDeleteAccountingExpense({
      expenseId: 'e1',
      deletedBy: 'staff-1',
      deletedByName: '担当',
    })

    expect(mockWriteBatch).toHaveBeenCalled()
    expect(mockCommit).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalled()
    const expenseUpdate = mockUpdate.mock.calls.find(
      (call) => call[0]?.path === 'accountingExpenses/e1',
    )
    const receiptUpdate = mockUpdate.mock.calls.find(
      (call) => call[0]?.path === 'accountingReceipts/r1',
    )
    expect(expenseUpdate?.[1]).toMatchObject({
      isDeleted: true,
      receiptId: { __delete: true },
    })
    expect(receiptUpdate?.[1]).toMatchObject({
      status: 'unorganized',
      receiptStatus: 'ocr_ready',
      linkedExpenseId: { __delete: true },
    })
  })

  it('soft-deletes linked fixed assets with the expense', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        franchiseeId: 'f1',
        storeId: 's1',
        linkedAssetId: 'a1',
      }),
    })
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] }) // receipts
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'a1',
            data: () => ({
              expenseId: 'e1',
              isDeleted: false,
              assetKind: 'fixed',
              purchaseDate: '2026-07-01',
              useStartDate: '2026-07-01',
              assetCategory: 'PC',
              assetName: 'PC',
              condition: '新品',
              acquisitionCost: 150000,
              standardUsefulLifeYears: 4,
              appliedUsefulLifeYears: 4,
              monthlyDepreciationYen: 3125,
              depreciationStartYearMonth: '2026-07',
              depreciationEndYearMonth: '2030-06',
              remainingBookValue: 150000,
              status: 'active',
              franchiseeId: 'f1',
              companyId: 'f1',
              storeId: 's1',
            }),
          },
        ],
      })

    await softDeleteAccountingExpense({
      expenseId: 'e1',
      deletedBy: 'staff-1',
      deletedByName: '担当',
    })

    const assetUpdate = mockUpdate.mock.calls.find(
      (call) => call[0]?.path === 'accountingFixedAssets/a1',
    )
    expect(assetUpdate?.[1]).toMatchObject({
      isDeleted: true,
      deletedBy: 'staff-1',
    })
  })
})
