import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import { INVOICE_STATUS_LABELS, INVOICE_STATUSES } from '../types/accounting'
import { aggregateExpensesByInvoiceStatus } from './accountingPl'
import {
  EXPENSE_INVOICE_NUMBER_PLACEHOLDER_EXAMPLE,
  EXPENSE_LIST_CONFIRMATION_STATUS_HEADER,
  formatExpenseListConfirmationStatus,
  formatExpenseListInvoiceNumber,
  formatExpenseListInvoiceStatus,
} from './accountingExpenseListDisplay'

const expense = (overrides: Partial<StoredAccountingExpense>): StoredAccountingExpense => ({
  id: 'e1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  transactionDate: '2026-07-10',
  postingDate: '2026-07-10',
  vendorName: 'アマゾンジャパン合同会社',
  description: '消耗品',
  expenseCategory: '消耗品費',
  taxIncludedAmount: 1100,
  taxRate: 10,
  consumptionTaxAmount: 100,
  paymentMethod: '現金',
  confirmationStatus: '確認済み',
  plTreatment: 'expense',
  createdBy: 'u1',
  createdByName: 'user',
  updatedBy: 'u1',
  updatedByName: 'user',
  ...overrides,
})

describe('formatExpenseListInvoiceNumber', () => {
  it('T番号が保存されている場合、一覧に表示される', () => {
    expect(formatExpenseListInvoiceNumber('T3040001028447')).toBe('T3040001028447')
    expect(formatExpenseListInvoiceNumber('T6070001038201')).toBe('T6070001038201')
  })

  it('T番号が空の場合、「－」と表示される', () => {
    expect(formatExpenseListInvoiceNumber('')).toBe('－')
    expect(formatExpenseListInvoiceNumber('   ')).toBe('－')
    expect(formatExpenseListInvoiceNumber(null)).toBe('－')
    expect(formatExpenseListInvoiceNumber(undefined)).toBe('－')
  })

  it('前後の空白は trim してから判定する', () => {
    expect(formatExpenseListInvoiceNumber('  T3040001028447  ')).toBe('T3040001028447')
  })

  it('placeholderのT番号が一覧に表示されない', () => {
    // 未保存（空）のときは placeholder 例を返さない
    expect(formatExpenseListInvoiceNumber('')).not.toBe(EXPENSE_INVOICE_NUMBER_PLACEHOLDER_EXAMPLE)
    expect(formatExpenseListInvoiceNumber(undefined)).toBe('－')
    // 一覧は保存フィールドのみを渡すため、placeholder はデータに現れない
    expect(formatExpenseListInvoiceNumber('')).toBe('－')
  })
})

describe('formatExpenseListInvoiceStatus', () => {
  it('「あり・確認済」が文字で表示される', () => {
    expect(formatExpenseListInvoiceStatus('verified')).toBe('あり・確認済')
  })

  it('「なし」が文字で表示される', () => {
    expect(formatExpenseListInvoiceStatus('none')).toBe('なし')
  })

  it('「対象外」が文字で表示される', () => {
    expect(formatExpenseListInvoiceStatus('not_required')).toBe('対象外')
  })

  it('「未確認」が文字で表示される', () => {
    expect(formatExpenseListInvoiceStatus('unknown')).toBe('未確認')
  })

  it('インボイス状態が未定義の既存データは「未確認」になる', () => {
    expect(formatExpenseListInvoiceStatus(undefined)).toBe('未確認')
    expect(formatExpenseListInvoiceStatus(null)).toBe('未確認')
    expect(formatExpenseListInvoiceStatus('')).toBe('未確認')
    expect(formatExpenseListInvoiceStatus('legacy_value')).toBe('未確認')
  })

  it('内部 enum 名は画面に表示せずフォームと同じ日本語へ変換する', () => {
    for (const status of INVOICE_STATUSES) {
      expect(formatExpenseListInvoiceStatus(status)).toBe(INVOICE_STATUS_LABELS[status])
      expect(formatExpenseListInvoiceStatus(status)).not.toBe(status)
    }
  })
})

describe('経費一覧の確認状態列', () => {
  it('現在の「状態」列が「確認状態」へ変更される', () => {
    expect(EXPENSE_LIST_CONFIRMATION_STATUS_HEADER).toBe('確認状態')
    expect(EXPENSE_LIST_CONFIRMATION_STATUS_HEADER).not.toBe('状態')
  })

  it('確認済み／未確認の表示が壊れていない', () => {
    expect(formatExpenseListConfirmationStatus('確認済み')).toBe('確認済み')
    expect(formatExpenseListConfirmationStatus('未確認')).toBe('未確認')
    expect(formatExpenseListConfirmationStatus('無効')).toBe('無効')
  })
})

describe('上部集計と一覧のインボイス状態の整合', () => {
  it('上部集計と一覧のインボイス状態別金額が一致する', () => {
    const expenses = [
      expense({
        id: 'v1',
        invoiceStatus: 'verified',
        invoiceNumber: 'T3040001028447',
        taxIncludedAmount: 3000,
        confirmationStatus: '確認済み',
      }),
      expense({
        id: 'n1',
        invoiceStatus: 'none',
        invoiceNumber: '',
        taxIncludedAmount: 2000,
        confirmationStatus: '確認済み',
      }),
      expense({
        id: 'nr1',
        invoiceStatus: 'not_required',
        taxIncludedAmount: 1500,
        confirmationStatus: '確認済み',
      }),
      expense({
        id: 'u1',
        invoiceStatus: undefined,
        taxIncludedAmount: 500,
        confirmationStatus: '確認済み',
      }),
      // 集計対象外（確認状態が未確認）— 一覧には出るが上部集計には含めない
      expense({
        id: 'pending',
        invoiceStatus: 'verified',
        taxIncludedAmount: 9999,
        confirmationStatus: '未確認',
      }),
    ]

    const summary = aggregateExpensesByInvoiceStatus(expenses, '2026-07')

    const eligible = expenses.filter((row) => row.confirmationStatus === '確認済み')
    const byLabel: Record<string, number> = {
      'あり・確認済': 0,
      なし: 0,
      対象外: 0,
      未確認: 0,
    }
    for (const row of eligible) {
      const label = formatExpenseListInvoiceStatus(row.invoiceStatus)
      byLabel[label] += row.taxIncludedAmount
    }

    expect(byLabel['あり・確認済']).toBe(summary.verified)
    expect(byLabel['なし']).toBe(summary.none)
    expect(byLabel['対象外']).toBe(summary.not_required)
    expect(byLabel['未確認']).toBe(summary.unknown)
    expect(summary.verified).toBe(3000)
    expect(summary.none).toBe(2000)
    expect(summary.not_required).toBe(1500)
    expect(summary.unknown).toBe(500)
  })
})

describe('経費一覧の操作ボタン前提', () => {
  it('編集・無効化・削除の対象経費 id を一覧行から特定できる', () => {
    const row = expense({ id: 'expense-ops-1', confirmationStatus: '確認済み' })
    expect(row.id).toBe('expense-ops-1')
    expect(row.confirmationStatus).not.toBe('無効')
    expect(formatExpenseListConfirmationStatus(row.confirmationStatus)).toBe('確認済み')
  })
})
