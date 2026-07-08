import { describe, expect, it } from 'vitest'
import type { StoredAccountingFixedCost } from '../types/accounting'
import {
  calculateFixedCostFiscalYearAmount,
  countYearMonthsInclusive,
  isFixedCostActiveForMonth,
  syncFixedCostAmounts,
} from './accountingFixedCost'

const baseCost = (overrides: Partial<StoredAccountingFixedCost>): StoredAccountingFixedCost => ({
  id: 'test',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  name: 'test',
  expenseCategory: '通信費',
  amountMode: 'monthly',
  monthlyAmountYen: 10_000,
  annualAmountYen: 120_000,
  startYearMonth: '2026-10',
  status: 'active',
  confirmationStatus: '確認済み',
  sourceType: 'fixedCost',
  ...overrides,
})

describe('syncFixedCostAmounts', () => {
  it('derives annual from monthly', () => {
    expect(syncFixedCostAmounts('monthly', 10_000, 0)).toEqual({
      monthlyAmountYen: 10_000,
      annualAmountYen: 120_000,
    })
  })

  it('derives monthly from annual with rounding', () => {
    expect(syncFixedCostAmounts('annual', 0, 120_000)).toEqual({
      monthlyAmountYen: 10_000,
      annualAmountYen: 120_000,
    })
  })
})

describe('calculateFixedCostFiscalYearAmount', () => {
  const referenceYearMonth = '2027-01'

  it('counts months from October start without cancellation', () => {
    const amount = calculateFixedCostFiscalYearAmount(baseCost({}), referenceYearMonth)
    expect(amount).toBe(60_000)
  })

  it('stops at cancellation month', () => {
    const amount = calculateFixedCostFiscalYearAmount(
      baseCost({ cancelYearMonth: '2027-01' }),
      referenceYearMonth,
    )
    expect(amount).toBe(40_000)
  })

  it('uses monthly amount derived from annual input', () => {
    const amount = calculateFixedCostFiscalYearAmount(
      baseCost({
        amountMode: 'annual',
        annualAmountYen: 120_000,
        monthlyAmountYen: 10_000,
        startYearMonth: '2026-12',
      }),
      referenceYearMonth,
    )
    expect(amount).toBe(40_000)
  })
})

describe('isFixedCostActiveForMonth', () => {
  it('includes cancellation month and excludes the next month', () => {
    const cost = baseCost({ cancelYearMonth: '2027-01' })

    expect(isFixedCostActiveForMonth(cost, '2027-01')).toBe(true)
    expect(isFixedCostActiveForMonth(cost, '2027-02')).toBe(false)
  })
})

describe('countYearMonthsInclusive', () => {
  it('counts inclusive months across year boundary', () => {
    expect(countYearMonthsInclusive('2026-10', '2027-03')).toBe(6)
  })
})
