import { describe, expect, it } from 'vitest'
import {
  buildFixedAssetEditDraft,
  buildKindChangeImpact,
  recalculateFixedAssetPreview,
  validateFixedAssetEditDraft,
} from './accountingFixedAssetEdit'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'

const sampleFixed = (): StoredAccountingFixedAsset => ({
  id: 'asset-1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  expenseId: 'exp-1',
  assetKind: 'fixed',
  purchaseDate: '2026-07-09',
  useStartDate: '2026-07-09',
  assetCategory: '車両',
  assetName: '車両',
  condition: '新品',
  vehicleType: '普通車',
  acquisitionCost: 3_500_000,
  standardUsefulLifeYears: 6,
  appliedUsefulLifeYears: 6,
  monthlyDepreciationYen: 48_611,
  depreciationStartYearMonth: '2026-07',
  depreciationEndYearMonth: '2032-06',
  remainingBookValue: 3_451_389,
  status: 'active',
  notes: '',
})

describe('accountingFixedAssetEdit', () => {
  it('recalculates monthly depreciation from acquisition cost and useful life', () => {
    const draft = buildFixedAssetEditDraft(sampleFixed())
    draft.acquisitionCost = 1_200_000
    draft.appliedUsefulLifeYears = 4
    const preview = recalculateFixedAssetPreview(draft, '2026-07')
    expect(preview.monthlyDepreciationYen).toBe(Math.floor(1_200_000 / (4 * 12)))
    expect(preview.depreciationStartYearMonth).toBe('2026-07')
    expect(preview.remainingBookValue).toBeGreaterThanOrEqual(0)
  })

  it('rejects useStartDate before purchaseDate', () => {
    const draft = buildFixedAssetEditDraft(sampleFixed())
    draft.useStartDate = '2026-07-01'
    const preview = recalculateFixedAssetPreview(draft, '2026-07')
    expect(validateFixedAssetEditDraft(draft, preview)).toContain('使用開始日')
  })

  it('rejects acquisition cost below 1', () => {
    const draft = buildFixedAssetEditDraft(sampleFixed())
    draft.acquisitionCost = 0
    const preview = recalculateFixedAssetPreview(draft, '2026-07')
    expect(validateFixedAssetEditDraft(draft, preview)).toContain('取得価額')
  })

  it('builds kind-change impact for fixed to small', () => {
    const draft = buildFixedAssetEditDraft(sampleFixed())
    const before = recalculateFixedAssetPreview(draft, '2026-07')
    const afterDraft = { ...draft, registrationType: 'small' as const }
    const after = recalculateFixedAssetPreview(afterDraft, '2026-07')
    const impact = buildKindChangeImpact({
      before: 'fixed',
      after: 'small',
      beforePreview: before,
      afterPreview: after,
    })
    expect(impact.afterMonthlyDepreciationYen).toBe(0)
    expect(impact.afterPlAmountYen).toBe(3_500_000)
    expect(impact.summary).toContain('将来月の減価償却費には残しません')
  })

  it('small assets show zero monthly depreciation', () => {
    const draft = buildFixedAssetEditDraft({
      ...sampleFixed(),
      assetKind: 'small',
      assetCategory: 'PC',
      assetName: 'PC',
      acquisitionCost: 150_000,
      appliedUsefulLifeYears: 1,
      monthlyDepreciationYen: 150_000,
    })
    draft.registrationType = 'small'
    const preview = recalculateFixedAssetPreview(draft, '2026-07')
    expect(preview.monthlyDepreciationYen).toBe(0)
    expect(preview.remainingBookValue).toBe(0)
  })
})
