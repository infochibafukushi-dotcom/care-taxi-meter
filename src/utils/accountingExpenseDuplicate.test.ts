import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import { findExpenseDuplicates } from './accountingExpenseDuplicate'

const baseExpense = (overrides: Partial<StoredAccountingExpense> = {}): StoredAccountingExpense => ({
  id: 'exp-1',
  franchiseeId: 'fc-1',
  companyId: 'fc-1',
  storeId: 'store-1',
  transactionDate: '2026-04-15',
  receiptDate: '2026-04-10',
  postingDate: '2026-04-15',
  vendorName: 'セリア',
  description: '',
  expenseCategory: '消耗品費',
  taxIncludedAmount: 110,
  taxRate: 10,
  consumptionTaxAmount: 10,
  paymentMethod: '',
  confirmationStatus: '確認済み',
  createdBy: 'u1',
  createdByName: 'User',
  updatedBy: 'u1',
  updatedByName: 'User',
  ...overrides,
})

describe('findExpenseDuplicates', () => {
  it('flags same date and amount', () => {
    const matches = findExpenseDuplicates([baseExpense()], {
      date: '2026-04-10',
      amount: 110,
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.severity).toBe('warning')
  })

  it('flags strong match for same image hash', () => {
    const matches = findExpenseDuplicates(
      [baseExpense({ imageHash: 'abc123', taxIncludedAmount: 999 })],
      {
        date: '2026-04-10',
        amount: 110,
        imageHash: 'abc123',
      },
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.severity).toBe('strong')
    expect(matches[0]?.reasons).toContain('sameImageHash')
  })

  it('ignores deleted and unconfirmed expenses', () => {
    const matches = findExpenseDuplicates(
      [
        baseExpense({ id: 'deleted', isDeleted: true }),
        baseExpense({ id: 'draft', confirmationStatus: '未確認' }),
      ],
      { date: '2026-04-10', amount: 110 },
    )
    expect(matches).toHaveLength(0)
  })

  it('excludes self when editing', () => {
    const matches = findExpenseDuplicates([baseExpense({ id: 'exp-1' })], {
      expenseId: 'exp-1',
      date: '2026-04-10',
      amount: 110,
    })
    expect(matches).toHaveLength(0)
  })
})
