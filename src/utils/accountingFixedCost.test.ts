import { describe, expect, it } from 'vitest'
import type { StoredAccountingFixedCost } from '../types/accounting'
import {
  calculateFixedCostFiscalYearAmount,
  countYearMonthsInclusive,
  getFiscalYearEndYearMonth,
  getFiscalYearStartYearMonth,
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

  it('counts FY2026 months from July start without daily proration (9 months)', () => {
    const amount = calculateFixedCostFiscalYearAmount(
      baseCost({ startYearMonth: '2026-07' }),
      referenceYearMonth,
    )
    expect(amount).toBe(90_000)
  })

  it('clips early April start to incorporation July (still 9 months)', () => {
    const amount = calculateFixedCostFiscalYearAmount(
      baseCost({ startYearMonth: '2026-04' }),
      referenceYearMonth,
    )
    expect(amount).toBe(90_000)
  })

  it('counts months from October start without cancellation', () => {
    const amount = calculateFixedCostFiscalYearAmount(baseCost({}), referenceYearMonth)
    expect(amount).toBe(60_000)
  })

  it('counts Jul–Dec when cancelled in December (6 months, no daily proration)', () => {
    const amount = calculateFixedCostFiscalYearAmount(
      baseCost({ startYearMonth: '2026-07', cancelYearMonth: '2026-12' }),
      referenceYearMonth,
    )
    expect(amount).toBe(60_000)
  })

  it('counts Oct–Dec when cancelled in December (3 months inclusive)', () => {
    const amount = calculateFixedCostFiscalYearAmount(
      baseCost({ startYearMonth: '2026-10', cancelYearMonth: '2026-12' }),
      referenceYearMonth,
    )
    expect(amount).toBe(30_000)
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

describe('getFiscalYearStartYearMonth / getFiscalYearEndYearMonth', () => {
  it('resolves FY2026 bounds from mid-year reference', () => {
    expect(getFiscalYearStartYearMonth('2027-01')).toBe('2026-07')
    expect(getFiscalYearEndYearMonth('2026-07')).toBe('2027-03')
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
  it('counts inclusive months for FY2026 windows', () => {
    expect(countYearMonthsInclusive('2026-07', '2027-03')).toBe(9)
    expect(countYearMonthsInclusive('2026-10', '2027-03')).toBe(6)
    expect(countYearMonthsInclusive('2026-07', '2026-12')).toBe(6)
    expect(countYearMonthsInclusive('2026-10', '2026-12')).toBe(3)
  })
})
