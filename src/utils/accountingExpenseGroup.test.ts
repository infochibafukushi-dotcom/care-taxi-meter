import { describe, expect, it } from 'vitest'
import {
  buildExpenseListDisplayItems,
  computeExpenseGroupDateRange,
  formatExpenseGroupPeriodLabel,
  resolveExpenseGroupReceiptCount,
  sumExpenseGroupLineAmounts,
  validateExpenseGroupForSave,
} from './accountingExpenseGroup'
import {
  aggregateGroupedExpenseAmountsByPostingMonth,
  recomputeExpenseGroupTotalsFromLines,
  resolveFiscalYearLabelForExpenseDate,
} from './accountingExpenseGroupPl'
import type { StoredAccountingExpense } from '../types/accounting'
import type { StoredAccountingExpenseGroup } from '../types/accountingExpenseGroup'

const baseExpense = (
  overrides: Partial<StoredAccountingExpense> & Pick<StoredAccountingExpense, 'id'>,
): StoredAccountingExpense =>
  ({
    franchiseeId: 'f1',
    companyId: 'f1',
    storeId: 's1',
    transactionDate: '2026-08-31',
    receiptDate: '2026-08-31',
    postingDate: '2026-08-31',
    vendorName: 'テスト',
    description: '',
    expenseCategory: '旅費交通費',
    taxIncludedAmount: 1000,
    taxRate: 10,
    consumptionTaxAmount: 91,
    paymentMethod: '現金',
    confirmationStatus: '確認済み',
    createdBy: 'u1',
    createdByName: 'tester',
    updatedBy: 'u1',
    updatedByName: 'tester',
    expenseGroupId: null,
    ...overrides,
  }) as StoredAccountingExpense

describe('accountingExpenseGroup', () => {
  it('computes date range and Japanese period label', () => {
    expect(computeExpenseGroupDateRange(['2026-09-01', '2026-08-31'])).toEqual({
      startDate: '2026-08-31',
      endDate: '2026-09-01',
    })
    expect(formatExpenseGroupPeriodLabel('2026-08-31', '2026-08-31')).toBe('2026年8月31日')
    expect(formatExpenseGroupPeriodLabel('2026-08-31', '2026-09-01')).toBe(
      '2026年8月31日～2026年9月1日',
    )
  })

  it('sums line amounts and rejects client total mismatch', () => {
    expect(sumExpenseGroupLineAmounts([20000, 3200, 1500])).toBe(24700)
    const errors = validateExpenseGroupForSave({
      title: '視察',
      lines: [
        { taxIncludedAmount: 3000, receiptDate: '2026-08-31', expenseCategory: '旅費交通費' },
        { taxIncludedAmount: 20000, receiptDate: '2026-09-01', expenseCategory: '旅費交通費' },
      ],
      clientTotalAmount: 999,
    })
    expect(errors.some((error) => error.field === 'totalAmount')).toBe(true)
  })

  it('lists grouped expenses as one card and hides child rows', () => {
    const group: StoredAccountingExpenseGroup = {
      id: 'g1',
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      groupType: 'training',
      title: '福祉機器展示会・介護車両視察',
      startDate: '2026-08-31',
      endDate: '2026-09-01',
      totalAmount: 23000,
      expenseIds: ['e1', 'e2'],
      confirmationStatus: '確認済み',
      createdBy: 'u1',
      createdByName: 'tester',
      updatedBy: 'u1',
      updatedByName: 'tester',
    }
    const expenses = [
      baseExpense({
        id: 'e1',
        expenseGroupId: 'g1',
        taxIncludedAmount: 3000,
        receiptDate: '2026-08-31',
        postingDate: '2026-08-31',
        transactionDate: '2026-08-31',
      }),
      baseExpense({
        id: 'e2',
        expenseGroupId: 'g1',
        taxIncludedAmount: 20000,
        receiptDate: '2026-09-01',
        postingDate: '2026-09-01',
        transactionDate: '2026-09-01',
      }),
      baseExpense({
        id: 'e3',
        vendorName: '単独',
        taxIncludedAmount: 500,
        receiptDate: '2026-08-15',
        postingDate: '2026-08-15',
        transactionDate: '2026-08-15',
      }),
    ]

    const august = buildExpenseListDisplayItems({
      expenses,
      groups: [group],
      targetYearMonth: '2026-08',
    })
    expect(august.filter((item) => item.kind === 'group')).toHaveLength(1)
    expect(august.filter((item) => item.kind === 'expense')).toHaveLength(1)
    expect(august.find((item) => item.kind === 'expense')?.expense.id).toBe('e3')

    // 表示月に絞った明細でも expenseIds を優先（本番の一覧と同じ条件）
    const augustMonthOnly = expenses.filter((expense) =>
      (expense.postingDate || expense.transactionDate || '').startsWith('2026-08'),
    )
    const augustFiltered = buildExpenseListDisplayItems({
      expenses: augustMonthOnly,
      groups: [group],
      targetYearMonth: '2026-08',
    })
    const augustGroup = augustFiltered.find((item) => item.kind === 'group')
    expect(augustGroup?.kind).toBe('group')
    if (augustGroup?.kind === 'group') {
      expect(augustGroup.expenses).toHaveLength(1)
      expect(resolveExpenseGroupReceiptCount(augustGroup.group, augustGroup.expenses)).toBe(2)
    }

    const septemberMonthOnly = expenses.filter((expense) =>
      (expense.postingDate || expense.transactionDate || '').startsWith('2026-09'),
    )
    const septemberFiltered = buildExpenseListDisplayItems({
      expenses: septemberMonthOnly,
      groups: [group],
      targetYearMonth: '2026-09',
    })
    const septemberGroup = septemberFiltered.find((item) => item.kind === 'group')
    expect(septemberGroup?.kind).toBe('group')
    if (septemberGroup?.kind === 'group') {
      expect(septemberGroup.expenses).toHaveLength(1)
      expect(resolveExpenseGroupReceiptCount(septemberGroup.group, septemberGroup.expenses)).toBe(2)
    }
  })

  it('prefers expenseIds length over month-filtered related expenses', () => {
    expect(
      resolveExpenseGroupReceiptCount(
        { expenseIds: ['e1', 'e2', 'e3'] },
        [{ id: 'e1' }],
      ),
    ).toBe(3)

    expect(resolveExpenseGroupReceiptCount({ expenseIds: [] }, [{ id: 'a' }, { id: 'b' }])).toBe(2)
  })
})

describe('accountingExpenseGroupPl', () => {
  it('splits month-crossing amounts by posting month without parent double count', () => {
    const lines = [
      {
        postingDate: '2026-08-31',
        transactionDate: '2026-08-31',
        taxIncludedAmount: 3000,
      },
      {
        postingDate: '2026-09-01',
        transactionDate: '2026-09-01',
        taxIncludedAmount: 20000,
      },
    ]
    const byMonth = aggregateGroupedExpenseAmountsByPostingMonth(lines)
    expect(byMonth['2026-08']).toBe(3000)
    expect(byMonth['2026-09']).toBe(20000)
    expect(recomputeExpenseGroupTotalsFromLines(lines).totalAmount).toBe(23000)
  })

  it('resolves fiscal year across March/April boundary', () => {
    expect(resolveFiscalYearLabelForExpenseDate('2027-03-31')).toBeTruthy()
    expect(resolveFiscalYearLabelForExpenseDate('2027-04-01')).toBeTruthy()
    expect(resolveFiscalYearLabelForExpenseDate('2027-03-31')).not.toBe(
      resolveFiscalYearLabelForExpenseDate('2027-04-01'),
    )
  })
})
