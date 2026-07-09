import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import {
  filterReportingExpensesByPostingYearMonth,
  normalizeExpenseInputForSave,
} from '../types/accounting'
import { isPostingDateInPastMonth } from './accountingExpenseForm'

const baseExpense = (): StoredAccountingExpense => ({
  id: 'e1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  transactionDate: '2026-08-01',
  postingDate: '2026-08-01',
  receiptDate: '2026-08-01',
  vendorName: 'vendor',
  description: 'desc',
  expenseCategory: '燃料費',
  taxIncludedAmount: 1_000,
  taxRate: 10,
  consumptionTaxAmount: 91,
  paymentMethod: '現金',
  confirmationStatus: '確認済み',
  plTreatment: 'expense',
  createdBy: 'u1',
  createdByName: 'user',
  updatedBy: 'u1',
  updatedByName: 'user',
})

describe('isPostingDateInPastMonth', () => {
  it('returns true when posting month is before current month', () => {
    expect(isPostingDateInPastMonth('2026-07-20', '2026-08')).toBe(true)
  })

  it('returns false for current month', () => {
    expect(isPostingDateInPastMonth('2026-08-15', '2026-08')).toBe(false)
  })

  it('returns false for future month', () => {
    expect(isPostingDateInPastMonth('2026-09-01', '2026-08')).toBe(false)
  })
})

describe('filterReportingExpensesByPostingYearMonth', () => {
  it('filters by postingDate month and confirmation status', () => {
    const expenses = [
      {
        ...baseExpense(),
        id: 'july',
        postingDate: '2026-07-20',
        transactionDate: '2026-07-20',
        createdAt: '2026-08-05T00:00:00.000Z',
      },
      {
        ...baseExpense(),
        id: 'august',
        postingDate: '2026-08-01',
        transactionDate: '2026-08-01',
      },
      {
        ...baseExpense(),
        id: 'unconfirmed',
        postingDate: '2026-07-10',
        transactionDate: '2026-07-10',
        confirmationStatus: '未確認',
      },
      {
        ...baseExpense(),
        id: 'deleted',
        postingDate: '2026-07-11',
        transactionDate: '2026-07-11',
        isDeleted: true,
      },
    ]

    const julyRows = filterReportingExpensesByPostingYearMonth(expenses, '2026-07')
    expect(julyRows.map((row) => row.id)).toEqual(['july'])
  })
})

describe('normalizeExpenseInputForSave', () => {
  it('keeps receiptDate and postingDate separate and syncs transactionDate', () => {
    const normalized = normalizeExpenseInputForSave({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      transactionDate: '2026-08-01',
      receiptDate: '2026-07-20',
      postingDate: '2026-08-01',
      vendorName: 'v',
      description: 'd',
      expenseCategory: '燃料費',
      taxIncludedAmount: 1_000,
      taxRate: 10,
      consumptionTaxAmount: 91,
      paymentMethod: '現金',
      confirmationStatus: '確認済み',
      createdBy: 'u1',
      createdByName: 'u',
      updatedBy: 'u1',
      updatedByName: 'u',
    })

    expect(normalized.receiptDate).toBe('2026-07-20')
    expect(normalized.postingDate).toBe('2026-08-01')
    expect(normalized.transactionDate).toBe('2026-08-01')
  })

  it('defaults receiptDate to postingDate when receiptDate is empty', () => {
    const normalized = normalizeExpenseInputForSave({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      transactionDate: '2026-07-20',
      postingDate: '2026-07-20',
      vendorName: 'v',
      description: 'd',
      expenseCategory: '燃料費',
      taxIncludedAmount: 1_000,
      taxRate: 10,
      consumptionTaxAmount: 91,
      paymentMethod: '現金',
      confirmationStatus: '確認済み',
      createdBy: 'u1',
      createdByName: 'u',
      updatedBy: 'u1',
      updatedByName: 'u',
    })

    expect(normalized.receiptDate).toBe('2026-07-20')
    expect(normalized.postingDate).toBe('2026-07-20')
    expect(normalized.transactionDate).toBe('2026-07-20')
  })
})
