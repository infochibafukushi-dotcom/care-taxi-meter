import { describe, expect, it } from 'vitest'
import { buildTaxAdvisorPackage } from './accountingTaxAdvisorData'
import { buildETaxCompanyProfile } from './accountingETaxData'

describe('buildTaxAdvisorPackage fiscal period', () => {
  it('uses FY2026 period end month and FiscalPeriod label', () => {
    const pkg = buildTaxAdvisorPackage({
      targetYear: 2026,
      storeName: '本店',
      company: null,
      meterSettings: null,
      caseRecords: [],
      expenses: [],
      adjustments: [],
      fixedCosts: [],
      fixedAssets: [],
      auxiliary: null,
      allReceipts: [],
      unorganizedReceipts: [],
    })

    expect(pkg.fiscalYearEndYearMonth).toBe('2027-03')
    expect(pkg.header.fiscalYearLabel).toBe('2026年度（2026/7/7〜2027/3/31）')
    expect(pkg.etax.company.fiscalYearLabel).toBe(pkg.header.fiscalYearLabel)
    expect(pkg.etax.company.fiscalYearLabel).toBe(
      buildETaxCompanyProfile({ targetYear: 2026, company: null, meterSettings: null })
        .fiscalYearLabel,
    )
  })
})
