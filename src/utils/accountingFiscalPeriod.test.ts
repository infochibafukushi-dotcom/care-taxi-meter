import { describe, expect, it } from 'vitest'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import {
  buildFiscalPeriod,
  getCompanyFiscalPeriod,
  getFiscalPeriodMonths,
  getFiscalYearEndYearMonth,
  getFiscalYearLabel,
  isDateInFiscalPeriod,
  isValidIsoDate,
  resolveFiscalYearForDate,
} from './accountingFiscalPeriod'
import { getFiscalYearMonths } from './accountingETaxData'

describe('accountingFiscalPeriod', () => {
  it('builds FY2026 short first period for the company', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    expect(period).toEqual({
      fiscalYear: 2026,
      startDate: '2026-07-07',
      endDate: '2027-03-31',
      startYearMonth: '2026-07',
      endYearMonth: '2027-03',
      isShortFiscalYear: true,
      monthCount: 9,
      label: '2026年度（2026/7/7〜2027/3/31）',
    })
    expect(getFiscalPeriodMonths(period!)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ])
  })

  it('builds FY2027 as a full 12-month period', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2027)
    expect(period).not.toBeNull()
    expect(period!.isShortFiscalYear).toBe(false)
    expect(period!.monthCount).toBe(12)
    expect(period!.startDate).toBe('2027-04-01')
    expect(period!.endDate).toBe('2028-03-31')
    expect(getFiscalPeriodMonths(period!)).toHaveLength(12)
  })

  it('returns null for FY2025 before incorporation', () => {
    expect(getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2025)).toBeNull()
  })

  it('resolves fiscal year for boundary dates', () => {
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2026-07-06')).toBeNull()
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2026-04-01')).toBeNull()
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2026-07-07')).toBe(2026)
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2027-03-31')).toBe(2026)
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2027-04-01')).toBe(2027)
  })

  it('rejects invalid dates and invalid fiscalYearEndMonth on build', () => {
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2026/07/07')).toBeNull()
    expect(resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, '2026-02-30')).toBeNull()

    expect(() =>
      buildFiscalPeriod({ ...COMPANY_FISCAL_POLICY, fiscalYearEndMonth: 0 }, 2026),
    ).toThrow()
    expect(() =>
      buildFiscalPeriod({ ...COMPANY_FISCAL_POLICY, fiscalYearEndMonth: 13 }, 2026),
    ).toThrow()
  })

  it('handles NaN fiscalYear: build throws, getCompany returns null', () => {
    expect(() => buildFiscalPeriod(COMPANY_FISCAL_POLICY, Number.NaN)).toThrow()
    expect(getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, Number.NaN)).toBeNull()
  })

  it('returns null for extreme years outside supported range', () => {
    expect(getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 1800)).toBeNull()
    expect(getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2200)).toBeNull()
  })


  it('exposes FY2026 label and end year-month helpers', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    expect(getFiscalYearLabel(period)).toBe('2026年度（2026/7/7〜2027/3/31）')
    expect(getFiscalYearEndYearMonth(period)).toBe('2027-03')
  })

  it('checks whether a date falls in a fiscal period', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    expect(isDateInFiscalPeriod('2026-07-07', period)).toBe(true)
    expect(isDateInFiscalPeriod('2027-03-31', period)).toBe(true)
    expect(isDateInFiscalPeriod('2027-04-01', period)).toBe(false)
    expect(() => isDateInFiscalPeriod('not-a-date', period)).toThrow()
  })

  it('validates leap-day ISO dates', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true)
    expect(isValidIsoDate('2027-02-29')).toBe(false)
  })

  it('lists FY2027 months from 2027-04 through 2028-03', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2027)!
    const months = getFiscalPeriodMonths(period)
    expect(months[0]).toBe('2027-04')
    expect(months[months.length - 1]).toBe('2028-03')
    expect(months).toHaveLength(12)
  })

  it('buildFiscalPeriod for 2027 is not short-clipped after incorporation', () => {
    const period = buildFiscalPeriod(COMPANY_FISCAL_POLICY, 2027)
    expect(period.isShortFiscalYear).toBe(false)
    expect(period.startDate).toBe('2027-04-01')
    expect(period.endDate).toBe('2028-03-31')
  })
})

describe('accountingETaxData getFiscalYearMonths wrapper', () => {
  it('delegates to company fiscal periods with short first year', () => {
    expect(getFiscalYearMonths(2026)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ])
    expect(getFiscalYearMonths(2025)).toEqual([])
    expect(getFiscalYearMonths(2027)).toHaveLength(12)
  })
})
