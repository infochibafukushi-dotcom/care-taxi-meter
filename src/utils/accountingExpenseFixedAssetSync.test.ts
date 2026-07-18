import { describe, expect, it } from 'vitest'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import {
  MULTIPLE_LINKED_FIXED_ASSETS_ERROR,
  buildAssetCategoryChangeConfirmMessage,
  derivePlTreatmentForRegistrationType,
  planExpenseFixedAssetSyncAction,
  resolveLinkedFixedAssetsForExpense,
} from './accountingExpenseFixedAssetSync'

const baseAsset = (
  overrides: Partial<StoredAccountingFixedAsset> = {},
): StoredAccountingFixedAsset => ({
  id: 'asset-1',
  franchiseeId: 'fc-1',
  companyId: 'fc-1',
  storeId: 'store-1',
  expenseId: 'exp-1',
  assetKind: 'fixed',
  purchaseDate: '2026-07-01',
  useStartDate: '2026-07-01',
  assetCategory: 'PC',
  assetName: 'ノートPC',
  condition: '新品',
  acquisitionCost: 150_000,
  standardUsefulLifeYears: 4,
  appliedUsefulLifeYears: 4,
  monthlyDepreciationYen: 3125,
  depreciationStartYearMonth: '2026-07',
  depreciationEndYearMonth: '2030-06',
  remainingBookValue: 150_000,
  status: 'active',
  isDeleted: false,
  ...overrides,
})

describe('resolveLinkedFixedAssetsForExpense', () => {
  it('prefers linkedAssetId then expenseId', () => {
    const assets = [
      baseAsset({ id: 'a1', expenseId: 'exp-1' }),
      baseAsset({ id: 'a2', expenseId: 'other' }),
    ]
    const byLinked = resolveLinkedFixedAssetsForExpense({
      expenseId: 'exp-1',
      linkedAssetId: 'a1',
      assets,
    })
    expect(byLinked.status).toBe('one')
    if (byLinked.status === 'one') {
      expect(byLinked.asset.id).toBe('a1')
    }
  })

  it('finds by expenseId when linkedAssetId is missing', () => {
    const resolution = resolveLinkedFixedAssetsForExpense({
      expenseId: 'exp-1',
      assets: [baseAsset({ id: 'a9', expenseId: 'exp-1' })],
    })
    expect(resolution.status).toBe('one')
  })

  it('returns multiple when several active assets match', () => {
    const resolution = resolveLinkedFixedAssetsForExpense({
      expenseId: 'exp-1',
      assets: [
        baseAsset({ id: 'a1', expenseId: 'exp-1' }),
        baseAsset({ id: 'a2', expenseId: 'exp-1' }),
      ],
    })
    expect(resolution.status).toBe('multiple')
  })

  it('ignores deleted assets', () => {
    const resolution = resolveLinkedFixedAssetsForExpense({
      expenseId: 'exp-1',
      assets: [baseAsset({ id: 'a1', expenseId: 'exp-1', isDeleted: true })],
    })
    expect(resolution.status).toBe('none')
  })
})

describe('planExpenseFixedAssetSyncAction', () => {
  it('creates asset for new fixed expense', () => {
    expect(
      planExpenseFixedAssetSyncAction({
        registrationType: 'fixed',
        linkedResolution: { status: 'none', assets: [] },
      }),
    ).toBe('create')
  })

  it('updates existing asset on edit instead of creating', () => {
    const asset = baseAsset()
    expect(
      planExpenseFixedAssetSyncAction({
        registrationType: 'fixed',
        linkedResolution: { status: 'one', asset, assets: [asset] },
      }),
    ).toBe('update')
  })

  it('deactivates asset when changing to normal', () => {
    const asset = baseAsset()
    expect(
      planExpenseFixedAssetSyncAction({
        registrationType: 'normal',
        linkedResolution: { status: 'one', asset, assets: [asset] },
      }),
    ).toBe('deactivate')
  })

  it('throws when multiple assets are linked', () => {
    expect(() =>
      planExpenseFixedAssetSyncAction({
        registrationType: 'fixed',
        linkedResolution: {
          status: 'multiple',
          assets: [baseAsset({ id: 'a1' }), baseAsset({ id: 'a2' })],
        },
      }),
    ).toThrow(MULTIPLE_LINKED_FIXED_ASSETS_ERROR)
  })
})

describe('derivePlTreatmentForRegistrationType', () => {
  it('excludes fixed assets from expense PL', () => {
    expect(derivePlTreatmentForRegistrationType('fixed')).toBe('excluded')
    expect(derivePlTreatmentForRegistrationType('small')).toBe('expense')
    expect(derivePlTreatmentForRegistrationType('normal')).toBe('expense')
  })
})

describe('buildAssetCategoryChangeConfirmMessage', () => {
  it('includes before/after PL and depreciation impact', () => {
    const message = buildAssetCategoryChangeConfirmMessage({
      fromType: 'small',
      toType: 'fixed',
    })
    expect(message).toContain('少額資産')
    expect(message).toContain('固定資産')
    expect(message).toContain('PL')
    expect(message).toContain('減価償却')
  })
})
