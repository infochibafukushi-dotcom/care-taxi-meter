import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import {
  buildExpensesById,
  isOrphanLinkedReceipt,
  isPlainUnorganizedReceipt,
  selectAccountingReceiptInbox,
} from './accountingReceiptLink'

const makeExpense = (
  overrides: Partial<StoredAccountingExpense> & { id: string },
): StoredAccountingExpense =>
  ({
    franchiseeId: 'f1',
    storeId: 's1',
    vendorName: '店',
    description: '内容',
    expenseCategory: '消耗品費',
    taxIncludedAmount: 1100,
    confirmationStatus: '確認済み',
    postingDate: '2026-08-15',
    createdBy: 'u1',
    updatedBy: 'u1',
    ...overrides,
  }) as StoredAccountingExpense

const makeReceipt = (
  overrides: Partial<StoredAccountingReceipt> & { id: string },
): StoredAccountingReceipt =>
  ({
    id: overrides.id,
    franchiseeId: 'f1',
    storeId: 's1',
    status: 'unorganized',
    receiptStatus: 'draft',
    uploadedBy: 'u1',
    uploadedByName: 'u1',
    ...overrides,
  }) as StoredAccountingReceipt

describe('isOrphanLinkedReceipt', () => {
  it('detects missing linked expense', () => {
    const expensesById = buildExpensesById([])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({ id: 'r1', status: 'linked', linkedExpenseId: 'missing' }),
        expensesById,
      ),
    ).toBe(true)
  })

  it('detects deleted linked expense', () => {
    const expensesById = buildExpensesById([
      makeExpense({ id: 'e1', isDeleted: true, receiptId: 'r1' }),
    ])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({ id: 'r1', status: 'linked', linkedExpenseId: 'e1' }),
        expensesById,
      ),
    ).toBe(true)
  })

  it('detects invalidated linked expense', () => {
    const expensesById = buildExpensesById([
      makeExpense({ id: 'e1', confirmationStatus: '無効', receiptId: 'r1' }),
    ])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({ id: 'r1', status: 'linked', linkedExpenseId: 'e1' }),
        expensesById,
      ),
    ).toBe(true)
  })

  it('detects expense.receiptId pointing to another receipt', () => {
    const expensesById = buildExpensesById([makeExpense({ id: 'e1', receiptId: 'r-other' })])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({ id: 'r1', status: 'linked', linkedExpenseId: 'e1' }),
        expensesById,
      ),
    ).toBe(true)
  })

  it('allows valid one-way link (expense has no receiptId)', () => {
    const expensesById = buildExpensesById([makeExpense({ id: 'e1', receiptId: undefined })])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({ id: 'r1', status: 'linked', linkedExpenseId: 'e1' }),
        expensesById,
      ),
    ).toBe(false)
  })

  it('allows valid two-way link', () => {
    const expensesById = buildExpensesById([makeExpense({ id: 'e1', receiptId: 'r1' })])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({ id: 'r1', status: 'linked', linkedExpenseId: 'e1' }),
        expensesById,
      ),
    ).toBe(false)
  })

  it('ignores invalidated receipts', () => {
    const expensesById = buildExpensesById([])
    expect(
      isOrphanLinkedReceipt(
        makeReceipt({
          id: 'r1',
          status: 'invalid',
          receiptStatus: 'rejected',
          linkedExpenseId: 'missing',
        }),
        expensesById,
      ),
    ).toBe(false)
  })
})

describe('selectAccountingReceiptInbox', () => {
  it('includes plain unorganized and orphan linked receipts', () => {
    const expenses = [
      makeExpense({ id: 'e1', receiptId: 'r-other' }),
      makeExpense({ id: 'e2', receiptId: 'linked-ok' }),
    ]
    const receipts = [
      makeReceipt({ id: 'plain', status: 'unorganized', receiptStatus: 'draft' }),
      makeReceipt({ id: 'orphan', status: 'linked', linkedExpenseId: 'missing' }),
      makeReceipt({ id: 'mismatch', status: 'linked', linkedExpenseId: 'e1' }),
      makeReceipt({ id: 'linked-ok', status: 'linked', linkedExpenseId: 'e2' }),
    ]
    const inbox = selectAccountingReceiptInbox(receipts, expenses)
    expect(inbox.map((row) => `${row.kind}:${row.receipt.id}`)).toEqual([
      'unorganized:plain',
      'orphan:orphan',
      'orphan:mismatch',
    ])
  })

  it('moves unlink-style receipt to unorganized when status is unorganized', () => {
    expect(
      isPlainUnorganizedReceipt(
        makeReceipt({
          id: 'r1',
          status: 'unorganized',
          receiptStatus: 'ocr_ready',
          linkedExpenseId: undefined,
        }),
      ),
    ).toBe(true)
  })
})
