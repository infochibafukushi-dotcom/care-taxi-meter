import { describe, expect, it } from 'vitest'
import {
  findDuplicateChassisAssets,
  formatChassisNumberDisplay,
  formatModelYearDisplay,
  hasIncompleteVehicleInfo,
  isValidChassisNumberFormat,
  normalizeChassisNumber,
  parseModelYearInput,
  shouldShowVehicleManagementFields,
  validateModelYearValue,
} from './accountingVehicleAssetFields'
import {
  affectsDepreciationRecalc,
  buildFixedAssetEditDraft,
  buildVehicleFieldsForSave,
  materialFieldsChanged,
  recalculateFixedAssetPreview,
} from './accountingFixedAssetEdit'
import { buildFixedAssetInputFromDraft } from '../services/accountingFixedAssets'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import { buildEmptyExpenseAssetDraft } from '../types/accountingFixedAssets'

const sampleVehicle = (): StoredAccountingFixedAsset => ({
  id: 'asset-v1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  assetKind: 'fixed',
  purchaseDate: '2026-07-01',
  useStartDate: '2026-07-01',
  assetCategory: '車両',
  assetName: '車両',
  condition: '新品',
  vehicleType: '普通車',
  acquisitionCost: 2_000_000,
  standardUsefulLifeYears: 6,
  appliedUsefulLifeYears: 6,
  monthlyDepreciationYen: Math.floor(2_000_000 / 72),
  depreciationStartYearMonth: '2026-07',
  depreciationEndYearMonth: '2032-06',
  remainingBookValue: 2_000_000,
  status: 'active',
})

describe('accountingVehicleAssetFields', () => {
  it('normalizes chassis number (trim, half-width, uppercase)', () => {
    expect(normalizeChassisNumber('  ａｂｃ-１２３  ')).toBe('ABC-123')
    expect(isValidChassisNumberFormat('ABC-123')).toBe(true)
    expect(isValidChassisNumberFormat('ABC_123')).toBe(false)
  })

  it('treats empty chassis as missing', () => {
    expect(normalizeChassisNumber('   ')).toBe('')
    expect(formatChassisNumberDisplay('')).toBe('未入力')
    expect(formatModelYearDisplay(undefined)).toBe('未入力')
  })

  it('rejects far-future model years', () => {
    const now = new Date('2026-07-16T00:00:00Z')
    expect(validateModelYearValue(2028, { now }).error).toContain('まで')
    expect(validateModelYearValue(2027, { now }).error).toBeNull()
  })

  it('warns when model year conflicts with first registration', () => {
    const result = validateModelYearValue(2010, {
      now: new Date('2026-01-01'),
      firstRegistrationYearMonth: '2024-04',
    })
    expect(result.error).toBeNull()
    expect(result.warning).toContain('大きく離れ')
  })

  it('detects duplicate chassis numbers among active assets', () => {
    const assets = [
      { id: 'a', chassisNumber: 'ABC-1', isDeleted: false, assetName: '車A' },
      { id: 'b', chassisNumber: 'abc-1', isDeleted: true, assetName: '削除済' },
      { id: 'c', chassisNumber: 'ZZZ', isDeleted: false, assetName: '車C' },
    ]
    expect(findDuplicateChassisAssets(assets, ' abc-1 ').map((a) => a.id)).toEqual(['a'])
  })

  it('shows vehicle management fields only for fixed + 車両', () => {
    expect(shouldShowVehicleManagementFields('fixed', '車両')).toBe(true)
    expect(shouldShowVehicleManagementFields('small', '車両')).toBe(false)
    expect(shouldShowVehicleManagementFields('fixed', 'PC')).toBe(false)
  })
})

describe('vehicle fields on fixed asset create/edit', () => {
  it('passes chassis and model year from expense draft into fixed asset input', () => {
    const draft = {
      ...buildEmptyExpenseAssetDraft(),
      registrationType: 'fixed' as const,
      assetCategory: '車両',
      assetName: '社用車',
      vehicleType: '普通車' as const,
      chassisNumber: ' jp-123 ',
      modelYear: 2024 as number | '',
      acquisitionCost: 1_000_000,
      purchaseDate: '2026-07-01',
      useStartDate: '2026-07-01',
      appliedUsefulLifeYears: 6,
    }
    const input = buildFixedAssetInputFromDraft({
      draft,
      expenseId: 'exp-1',
      franchiseeId: 'f1',
      storeId: 's1',
      staffId: 'staff',
      staffName: 'Staff',
    })
    expect(input.chassisNumber).toBe('JP-123')
    expect(input.modelYear).toBe(2024)
  })

  it('allows saving vehicle without chassis or model year', () => {
    const draft = {
      ...buildEmptyExpenseAssetDraft(),
      registrationType: 'fixed' as const,
      assetCategory: '車両',
      assetName: '社用車',
      vehicleType: '普通車' as const,
      acquisitionCost: 1_000_000,
      purchaseDate: '2026-07-01',
      useStartDate: '2026-07-01',
      appliedUsefulLifeYears: 6,
    }
    const input = buildFixedAssetInputFromDraft({
      draft,
      franchiseeId: 'f1',
      storeId: 's1',
      staffId: 'staff',
      staffName: 'Staff',
    })
    expect(input.chassisNumber).toBeUndefined()
    expect(input.modelYear).toBeUndefined()
  })

  it('shows existing chassis/model year in edit draft', () => {
    const edit = buildFixedAssetEditDraft({
      ...sampleVehicle(),
      chassisNumber: 'VIN-9',
      modelYear: 2022,
    })
    expect(edit.chassisNumber).toBe('VIN-9')
    expect(edit.modelYear).toBe(2022)
  })

  it('does not change depreciation when only chassis/model year change', () => {
    const original = {
      ...sampleVehicle(),
      chassisNumber: '',
      modelYear: undefined,
    }
    const draft = buildFixedAssetEditDraft(original)
    draft.chassisNumber = 'NEW-1'
    draft.modelYear = 2025
    const changed = materialFieldsChanged(original, draft)
    expect(affectsDepreciationRecalc(changed)).toBe(false)
    const before = recalculateFixedAssetPreview(buildFixedAssetEditDraft(original), '2026-07')
    const after = recalculateFixedAssetPreview(draft, '2026-07')
    expect(after.monthlyDepreciationYen).toBe(before.monthlyDepreciationYen)
    expect(after.remainingBookValue).toBe(before.remainingBookValue)
  })

  it('omits vehicle fields for non-vehicle assets', () => {
    const draft = buildFixedAssetEditDraft({
      ...sampleVehicle(),
      assetCategory: 'PC',
      chassisNumber: 'SHOULD-CLEAR',
      modelYear: 2020,
    })
    const fields = buildVehicleFieldsForSave(draft)
    expect(fields.chassisNumber).toBe('')
    expect(fields.modelYear).toBeNull()
  })

  it('parses blank model year as null', () => {
    expect(parseModelYearInput('')).toBeNull()
    expect(parseModelYearInput(2024)).toBe(2024)
  })
})
