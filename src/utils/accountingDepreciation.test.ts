import { describe, expect, it } from 'vitest'
import {
  addMonthsToYearMonth,
  aggregateMonthlyDepreciationYen,
  calculateDepreciationSchedule,
  calculateSmallAssetUsageForYear,
  calculateUsedVehicleUsefulLifeYears,
  calculateUsefulLifeYears,
  getSmallAssetAmountRecommendation,
} from './accountingDepreciation'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'

const fixedAsset = (overrides: Partial<StoredAccountingFixedAsset>): StoredAccountingFixedAsset => ({
  id: 'a1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  assetKind: 'fixed',
  purchaseDate: '2026-01-15',
  useStartDate: '2026-02-01',
  assetCategory: 'PC',
  assetName: 'ノートPC',
  condition: '新品',
  acquisitionCost: 240_000,
  standardUsefulLifeYears: 4,
  appliedUsefulLifeYears: 4,
  monthlyDepreciationYen: 5_000,
  depreciationStartYearMonth: '2026-02',
  depreciationEndYearMonth: '2030-01',
  remainingBookValue: 240_000,
  status: 'active',
  notes: '',
  ...overrides,
})

describe('accountingDepreciation', () => {
  it('recommends expense treatment by amount', () => {
    expect(getSmallAssetAmountRecommendation(50_000)).toBe('normal_expense')
    expect(getSmallAssetAmountRecommendation(150_000)).toBe('small_asset')
    expect(getSmallAssetAmountRecommendation(500_000)).toBe('above_small_asset_limit')
  })

  it('calculates standard useful life by asset category', () => {
    expect(
      calculateUsefulLifeYears({
        assetCategory: 'PC',
        condition: '新品',
        useStartDate: '2026-03-01',
      }),
    ).toBe(4)

    expect(
      calculateUsefulLifeYears({
        assetCategory: 'プリンター',
        condition: '新品',
        useStartDate: '2026-03-01',
      }),
    ).toBe(5)
  })

  it('calculates used vehicle useful life from first registration', () => {
    const years = calculateUsedVehicleUsefulLifeYears({
      vehicleType: '普通車',
      firstRegistrationYearMonth: '2020-04',
      useStartDate: '2026-03-01',
    })

    expect(years).toBeGreaterThanOrEqual(2)
    expect(years).toBeLessThan(6)
  })

  it('builds straight-line depreciation schedule', () => {
    const schedule = calculateDepreciationSchedule({
      acquisitionCost: 240_000,
      usefulLifeYears: 4,
      useStartDate: '2026-02-01',
    })

    expect(schedule.depreciationStartYearMonth).toBe('2026-02')
    expect(schedule.depreciationEndYearMonth).toBe(addMonthsToYearMonth('2026-02', 47))
    expect(schedule.monthlyDepreciationYen).toBe(5_000)
  })

  it('aggregates monthly depreciation into 減価償却費 bucket', () => {
    const assets = [
      fixedAsset({}),
      fixedAsset({
        id: 'a2',
        depreciationStartYearMonth: '2026-05',
        depreciationEndYearMonth: '2030-04',
      }),
    ]

    expect(aggregateMonthlyDepreciationYen(assets, '2026-02')).toBe(5_000)
    expect(aggregateMonthlyDepreciationYen(assets, '2026-05')).toBe(10_000)
    expect(aggregateMonthlyDepreciationYen(assets, '2025-12')).toBe(0)
  })

  it('tracks small asset annual usage', () => {
    const usage = calculateSmallAssetUsageForYear(
      [
        fixedAsset({
          assetKind: 'small',
          purchaseDate: '2026-03-10',
          acquisitionCost: 120_000,
        }),
        fixedAsset({
          id: 'a2',
          assetKind: 'small',
          purchaseDate: '2025-12-01',
          acquisitionCost: 200_000,
        }),
      ],
      2026,
    )

    expect(usage.usedYen).toBe(120_000)
    expect(usage.remainingYen).toBe(2_880_000)
  })
})
