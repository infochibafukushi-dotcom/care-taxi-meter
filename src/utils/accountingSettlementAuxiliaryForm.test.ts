import { describe, expect, it } from 'vitest'
import {
  formatSettlementAmountDisplay,
  getSettlementAmountStatus,
  hasPositiveSettlementAmount,
  isSettlementAmountEntered,
  SETTLEMENT_NOT_APPLICABLE,
  SETTLEMENT_UNSET,
  sumReceivableBreakdownByKind,
  sumSettlementBreakdownBalances,
} from './accountingSettlementAuxiliaryForm'
import { buildETaxCheckItems } from './accountingETaxData'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'

describe('settlement amount status', () => {
  it('distinguishes unset, zero, and positive amounts', () => {
    expect(getSettlementAmountStatus(null)).toBe('unset')
    expect(getSettlementAmountStatus(undefined)).toBe('unset')
    expect(getSettlementAmountStatus(0)).toBe('na')
    expect(getSettlementAmountStatus(1)).toBe('set')
    expect(getSettlementAmountStatus(50000)).toBe('set')
  })

  it('formats display values for e-Tax output', () => {
    expect(formatSettlementAmountDisplay(null)).toBe(SETTLEMENT_UNSET)
    expect(formatSettlementAmountDisplay(0)).toBe(SETTLEMENT_NOT_APPLICABLE)
    expect(formatSettlementAmountDisplay(2500000)).toBe('2500000')
  })

  it('treats only positive amounts as requiring breakdown detail', () => {
    expect(isSettlementAmountEntered(0)).toBe(true)
    expect(hasPositiveSettlementAmount(0)).toBe(false)
    expect(hasPositiveSettlementAmount(1)).toBe(true)
  })

  it('sums breakdown balances and receivable kinds', () => {
    expect(sumSettlementBreakdownBalances([{ yearEndBalance: 100 }, { yearEndBalance: 200 }])).toBe(300)
    expect(
      sumReceivableBreakdownByKind(
        [
          { receivableKind: 'accountsReceivable', yearEndBalance: 100 },
          { receivableKind: 'accruedIncome', yearEndBalance: 50 },
        ] as AccountingSettlementAuxiliaryInput['receivables'],
        'accountsReceivable',
      ),
    ).toBe(100)
  })
})

describe('buildETaxCheckItems zero-balance handling', () => {
  const baseAuxiliary = {
    companyBasic: {
      companyName: 'テスト',
      corporateNumber: '',
      address: '',
      representativeName: '',
      businessDescription: '介護タクシー',
      officerCount: 2,
      employeeCount: 5,
      fiscalMonthEnd: 3,
      fiscalYearStartDate: '2026-04-01',
      fiscalYearEndDate: '2027-03-31',
    },
    yearEndBalance: {
      cash: 50000,
      deposits: 2500000,
      accountsReceivable: 0,
      accruedIncome: 0,
      prepayments: 0,
      accountsPayable: 0,
      borrowings: 5000000,
      officerLoans: 0,
      capital: 1000000,
      retainedEarnings: 300000,
      customAccounts: [],
    },
    bankAccounts: [{ id: '1', institutionName: '千葉銀行', branchName: '中央', accountType: '普通', accountLastFour: '1234', yearEndBalance: 2500000, notes: '' }],
    loans: [{ id: '1', lenderName: '千葉銀行', loanDate: '2024-04-01', originalAmount: 6000000, yearEndBalance: 5000000, repaymentDueDate: '', interestRate: '', hasCollateral: '無', notes: '' }],
    officerLoans: [],
    receivables: [],
    payables: [],
  } as AccountingSettlementAuxiliaryInput

  it('does not flag zero-balance optional fields as required', () => {
    const items = buildETaxCheckItems(baseAuxiliary)
    const requiredLabels = items.filter((item) => item.status === 'required').map((item) => item.label)

    expect(requiredLabels).not.toContain('売掛金残高')
    expect(requiredLabels).not.toContain('未収金残高')
    expect(requiredLabels).not.toContain('仮払金残高')
    expect(requiredLabels).not.toContain('未払金残高')
    expect(requiredLabels).not.toContain('役員借入金残高')
    expect(requiredLabels).not.toContain('普通預金内訳')
    expect(requiredLabels).not.toContain('借入金内訳')
  })

  it('still flags null optional fields as required', () => {
    const items = buildETaxCheckItems({
      ...baseAuxiliary,
      yearEndBalance: {
        ...baseAuxiliary.yearEndBalance,
        accountsReceivable: null,
      },
    })

    expect(items.some((item) => item.label === '売掛金残高' && item.status === 'required')).toBe(true)
  })
})
