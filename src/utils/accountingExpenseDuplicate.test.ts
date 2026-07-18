import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import {
  findBillingInvoiceDuplicates,
  findExpenseDuplicates,
  findExpenseDuplicatesIncludingBilling,
  hasBlockingExpenseDuplicate,
} from './accountingExpenseDuplicate'

const baseExpense = (overrides: Partial<StoredAccountingExpense> = {}): StoredAccountingExpense => ({
  id: 'exp-1',
  franchiseeId: 'fc-1',
  companyId: 'fc-1',
  storeId: 'store-1',
  transactionDate: '2026-04-15',
  receiptDate: '2026-04-10',
  postingDate: '2026-04-15',
  vendorName: 'セリア',
  description: '消耗品',
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

describe('findBillingInvoiceDuplicates', () => {
  it('blocks when vendor and billing invoice number match', () => {
    const matches = findBillingInvoiceDuplicates(
      [
        baseExpense({
          billingInvoiceNumber: '04890-15126953-1',
          vendorName: 'Canva Pty Ltd',
          receiptDate: '2026-05-23',
          taxIncludedAmount: 1500,
        }),
      ],
      {
        date: '2026-07-01',
        amount: 999,
        vendorName: 'Canva Pty Ltd',
        billingInvoiceNumber: '04890-15126953-1',
      },
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.severity).toBe('blocking')
    expect(hasBlockingExpenseDuplicate(matches)).toBe(true)
  })

  it('allows same billing number for a different vendor', () => {
    const matches = findBillingInvoiceDuplicates(
      [
        baseExpense({
          billingInvoiceNumber: 'SHARED-001',
          vendorName: 'Vendor A',
        }),
      ],
      {
        date: '2026-07-01',
        amount: 1000,
        vendorName: 'Vendor B',
        billingInvoiceNumber: 'SHARED-001',
      },
    )
    expect(matches).toHaveLength(0)
  })

  it('skips legacy expenses without billing invoice number', () => {
    const matches = findBillingInvoiceDuplicates(
      [baseExpense({ vendorName: 'Canva Pty Ltd', billingInvoiceNumber: undefined })],
      {
        date: '2026-05-23',
        amount: 1500,
        vendorName: 'Canva Pty Ltd',
        billingInvoiceNumber: '04890-15126953-1',
      },
    )
    expect(matches).toHaveLength(0)
  })

  it('does not error when candidate has no billing invoice number', () => {
    const matches = findBillingInvoiceDuplicates(
      [baseExpense({ billingInvoiceNumber: 'X-1', vendorName: 'A' })],
      { date: '2026-05-23', amount: 1500, vendorName: 'A' },
    )
    expect(matches).toHaveLength(0)
  })

  it('excludes self when editing', () => {
    const matches = findBillingInvoiceDuplicates(
      [
        baseExpense({
          id: 'exp-1',
          billingInvoiceNumber: 'INV-1',
          vendorName: 'Same',
        }),
      ],
      {
        expenseId: 'exp-1',
        date: '2026-05-23',
        amount: 1500,
        vendorName: 'Same',
        billingInvoiceNumber: 'INV-1',
      },
    )
    expect(matches).toHaveLength(0)
  })
})

describe('findExpenseDuplicatesIncludingBilling', () => {
  it('merges legacy and billing matches for the same expense', () => {
    const matches = findExpenseDuplicatesIncludingBilling(
      [
        baseExpense({
          billingInvoiceNumber: '04890-15126953-1',
          vendorName: 'Canva Pty Ltd',
          receiptDate: '2026-05-23',
          taxIncludedAmount: 1500,
        }),
      ],
      {
        date: '2026-05-23',
        amount: 1500,
        vendorName: 'Canva Pty Ltd',
        billingInvoiceNumber: '04890-15126953-1',
      },
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.severity).toBe('blocking')
    expect(matches[0]?.reasons).toEqual(
      expect.arrayContaining(['sameDate', 'sameAmount', 'sameVendor', 'sameBillingInvoiceNumber']),
    )
  })
})
