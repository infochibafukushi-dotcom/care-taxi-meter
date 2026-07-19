import { describe, expect, it, vi } from 'vitest'

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(),
  deleteField: vi.fn(),
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

vi.mock('./accountingFixedAssets', () => ({
  buildFixedAssetInputFromDraft: vi.fn(),
  normalizeStoredFixedAssetForSync: vi.fn(),
}))

vi.mock('./accountingReceipts', () => ({
  linkAccountingReceiptToExpense: vi.fn(),
}))

import { buildActiveAssetsByExpenseIdConstraints } from './accountingExpenseFixedAssetSave'

describe('buildActiveAssetsByExpenseIdConstraints', () => {
  it('always scopes by franchiseeId so list queries satisfy canReadAccounting', () => {
    const constraints = buildActiveAssetsByExpenseIdConstraints('exp-1', 'ちばケアタクシー')
    expect(constraints).toEqual([
      { field: 'franchiseeId', op: '==', value: 'ちばケアタクシー' },
      { field: 'expenseId', op: '==', value: 'exp-1' },
      { field: 'isDeleted', op: '==', value: false },
    ])
  })

  it('can omit isDeleted for index fallback while keeping franchiseeId', () => {
    const constraints = buildActiveAssetsByExpenseIdConstraints('exp-1', 'fc-1', {
      includeIsDeletedFalse: false,
    })
    expect(constraints).toEqual([
      { field: 'franchiseeId', op: '==', value: 'fc-1' },
      { field: 'expenseId', op: '==', value: 'exp-1' },
    ])
    expect(constraints.some((c) => (c as { field: string }).field === 'franchiseeId')).toBe(true)
    expect(constraints.every((c) => (c as { field: string }).field !== 'expenseId' || true)).toBe(true)
  })
})
