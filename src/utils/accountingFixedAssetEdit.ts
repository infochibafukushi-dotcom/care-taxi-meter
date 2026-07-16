import {
  calculateDepreciationSchedule,
  calculateRemainingBookValue,
  calculateUsefulLifeYears,
  deriveFixedAssetStatus,
  getStandardUsefulLifeYears,
  toYearMonth,
} from './accountingDepreciation'
import {
  ASSET_CONDITIONS,
  EXPENSE_REGISTRATION_TYPE_LABELS,
  FIXED_ASSET_ITEM_TYPES,
  SMALL_ASSET_ITEM_TYPES,
  VEHICLE_TYPES,
  type AssetCondition,
  type ExpenseRegistrationType,
  type StoredAccountingFixedAsset,
  type VehicleType,
} from '../types/accountingFixedAssets'
import {
  isValidChassisNumberFormat,
  normalizeChassisNumber,
  parseModelYearInput,
  validateModelYearValue,
} from './accountingVehicleAssetFields'

export type FixedAssetEditDraft = {
  purchaseDate: string
  assetName: string
  assetCategory: string
  acquisitionCost: number
  useStartDate: string
  appliedUsefulLifeYears: number
  usefulLifeChangeReason: string
  notes: string
  assetKind: 'small' | 'fixed'
  /** UI-only: allow converting out of ledger into normal expense treatment */
  registrationType: ExpenseRegistrationType
  condition: AssetCondition
  vehicleType: VehicleType | ''
  firstRegistrationYearMonth: string
  chassisNumber: string
  modelYear: number | ''
}

export type FixedAssetRecalcPreview = {
  monthlyDepreciationYen: number
  depreciationStartYearMonth: string
  depreciationEndYearMonth: string
  remainingBookValue: number
  status: StoredAccountingFixedAsset['status']
  standardUsefulLifeYears: number
  cumulativeDepreciationYen: number
}

export type FixedAssetPlImpact = {
  beforeKindLabel: string
  afterKindLabel: string
  beforePlAmountYen: number
  afterPlAmountYen: number
  beforeMonthlyDepreciationYen: number
  afterMonthlyDepreciationYen: number
  summary: string
}

export const buildFixedAssetEditDraft = (asset: StoredAccountingFixedAsset): FixedAssetEditDraft => ({
  purchaseDate: asset.purchaseDate,
  assetName: asset.assetName,
  assetCategory: asset.assetCategory,
  acquisitionCost: asset.acquisitionCost,
  useStartDate: asset.useStartDate,
  appliedUsefulLifeYears: asset.appliedUsefulLifeYears,
  usefulLifeChangeReason: asset.usefulLifeChangeReason ?? '',
  notes: asset.notes ?? '',
  assetKind: asset.assetKind,
  registrationType: asset.assetKind === 'small' ? 'small' : 'fixed',
  condition: asset.condition,
  vehicleType: asset.vehicleType ?? '',
  firstRegistrationYearMonth: asset.firstRegistrationYearMonth ?? '',
  chassisNumber: asset.chassisNumber ?? '',
  modelYear: asset.modelYear ?? '',
})

export const categoryOptionsForKind = (kind: 'small' | 'fixed') =>
  kind === 'small' ? [...SMALL_ASSET_ITEM_TYPES] : [...FIXED_ASSET_ITEM_TYPES]

export const recalculateFixedAssetPreview = (
  draft: FixedAssetEditDraft,
  asOfYearMonth: string,
): FixedAssetRecalcPreview => {
  const assetKind = draft.registrationType === 'fixed' ? 'fixed' : 'small'
  const standardUsefulLifeYears =
    assetKind === 'fixed'
      ? calculateUsefulLifeYears({
          assetCategory: draft.assetCategory,
          condition: draft.condition,
          vehicleType: draft.vehicleType || undefined,
          firstRegistrationYearMonth: draft.firstRegistrationYearMonth || undefined,
          useStartDate: draft.useStartDate,
        })
      : getStandardUsefulLifeYears(draft.assetCategory)

  const usefulLifeYears =
    assetKind === 'fixed'
      ? Math.max(1, Number(draft.appliedUsefulLifeYears) || standardUsefulLifeYears)
      : 1

  if (draft.registrationType !== 'fixed') {
    const start = draft.useStartDate ? toYearMonth(draft.useStartDate) : ''
    return {
      monthlyDepreciationYen: 0,
      depreciationStartYearMonth: start,
      depreciationEndYearMonth: start,
      remainingBookValue: 0,
      status: 'fully_depreciated',
      standardUsefulLifeYears,
      cumulativeDepreciationYen: Math.max(0, Number(draft.acquisitionCost) || 0),
    }
  }

  const schedule = calculateDepreciationSchedule({
    acquisitionCost: Math.max(0, Number(draft.acquisitionCost) || 0),
    usefulLifeYears,
    useStartDate: draft.useStartDate,
  })

  const provisional: StoredAccountingFixedAsset = {
    id: 'preview',
    franchiseeId: '',
    companyId: '',
    storeId: '',
    assetKind: 'fixed',
    purchaseDate: draft.purchaseDate,
    useStartDate: draft.useStartDate,
    assetCategory: draft.assetCategory,
    assetName: draft.assetName,
    condition: draft.condition,
    vehicleType: draft.vehicleType || undefined,
    firstRegistrationYearMonth: draft.firstRegistrationYearMonth || undefined,
    acquisitionCost: Math.max(0, Number(draft.acquisitionCost) || 0),
    standardUsefulLifeYears,
    appliedUsefulLifeYears: usefulLifeYears,
    monthlyDepreciationYen: schedule.monthlyDepreciationYen,
    depreciationStartYearMonth: schedule.depreciationStartYearMonth,
    depreciationEndYearMonth: schedule.depreciationEndYearMonth,
    remainingBookValue: 0,
    status: 'active',
  }

  const remainingBookValue = calculateRemainingBookValue(provisional, asOfYearMonth)
  const status = deriveFixedAssetStatus(
    { ...provisional, remainingBookValue },
    asOfYearMonth,
  )
  const cumulativeDepreciationYen = Math.max(
    0,
    provisional.acquisitionCost - remainingBookValue,
  )

  return {
    monthlyDepreciationYen: schedule.monthlyDepreciationYen,
    depreciationStartYearMonth: schedule.depreciationStartYearMonth,
    depreciationEndYearMonth: schedule.depreciationEndYearMonth,
    remainingBookValue,
    status,
    standardUsefulLifeYears,
    cumulativeDepreciationYen,
  }
}

/** PL反映額の概算（取得月一括 or 当月償却） */
export const estimatePlImpactAmounts = (
  kind: ExpenseRegistrationType,
  acquisitionCost: number,
  monthlyDepreciationYen: number,
) => {
  if (kind === 'normal' || kind === 'small') {
    return {
      acquisitionMonthPlYen: Math.max(0, acquisitionCost),
      monthlyDepreciationYen: 0,
    }
  }

  return {
    acquisitionMonthPlYen: 0,
    monthlyDepreciationYen: Math.max(0, monthlyDepreciationYen),
  }
}

export const buildKindChangeImpact = ({
  before,
  after,
  beforePreview,
  afterPreview,
}: {
  before: ExpenseRegistrationType
  after: ExpenseRegistrationType
  beforePreview: FixedAssetRecalcPreview
  afterPreview: FixedAssetRecalcPreview
}): FixedAssetPlImpact => {
  const beforeAmounts = estimatePlImpactAmounts(
    before,
    beforePreview.cumulativeDepreciationYen + beforePreview.remainingBookValue,
    beforePreview.monthlyDepreciationYen,
  )
  const afterAmounts = estimatePlImpactAmounts(
    after,
    afterPreview.cumulativeDepreciationYen + afterPreview.remainingBookValue,
    afterPreview.monthlyDepreciationYen,
  )

  const beforePlAmountYen =
    before === 'fixed' ? beforeAmounts.monthlyDepreciationYen : beforeAmounts.acquisitionMonthPlYen
  const afterPlAmountYen =
    after === 'fixed' ? afterAmounts.monthlyDepreciationYen : afterAmounts.acquisitionMonthPlYen

  return {
    beforeKindLabel: EXPENSE_REGISTRATION_TYPE_LABELS[before],
    afterKindLabel: EXPENSE_REGISTRATION_TYPE_LABELS[after],
    beforePlAmountYen,
    afterPlAmountYen,
    beforeMonthlyDepreciationYen: beforePreview.monthlyDepreciationYen,
    afterMonthlyDepreciationYen: afterPreview.monthlyDepreciationYen,
    summary:
      after === 'fixed'
        ? '保存後は取得価額を経費PLへ計上せず、毎月の減価償却費のみPLへ反映します。'
        : after === 'small'
          ? '保存後は取得月に一括で経費PLへ計上し、将来月の減価償却費には残しません。'
          : '保存後は台帳から外し、紐付け経費を通常のPL反映経費として扱います。',
  }
}

export const validateFixedAssetEditDraft = (
  draft: FixedAssetEditDraft,
  preview: FixedAssetRecalcPreview,
): string | null => {
  if (!draft.purchaseDate) {
    return '購入日は必須です。'
  }
  if (!draft.assetName.trim()) {
    return '資産名は必須です。'
  }
  if (!draft.assetCategory.trim()) {
    return '資産区分は必須です。'
  }
  if (!Number.isFinite(draft.acquisitionCost) || draft.acquisitionCost < 1) {
    return '取得価額は1円以上の数値で入力してください。'
  }
  if (!draft.useStartDate) {
    return '使用開始日は必須です。'
  }
  if (draft.useStartDate < draft.purchaseDate) {
    return '使用開始日は購入日より前にできません。'
  }
  if (draft.registrationType === 'fixed') {
    if (!Number.isFinite(draft.appliedUsefulLifeYears) || draft.appliedUsefulLifeYears < 1) {
      return '耐用年数は1年以上で入力してください。'
    }
    if (
      preview.standardUsefulLifeYears !== draft.appliedUsefulLifeYears &&
      !draft.usefulLifeChangeReason.trim()
    ) {
      return '耐用年数を変更した場合は変更理由を入力してください。'
    }
    if (preview.depreciationStartYearMonth !== toYearMonth(draft.useStartDate)) {
      return '償却開始月が使用開始日と整合していません。'
    }
  }
  if (preview.remainingBookValue < 0) {
    return '未償却残高がマイナスになるため保存できません。'
  }
  if (draft.assetCategory === '車両' && draft.condition === '中古' && !draft.firstRegistrationYearMonth) {
    return '中古車の初度登録年月を入力してください。'
  }
  if (draft.vehicleType && !VEHICLE_TYPES.includes(draft.vehicleType as VehicleType)) {
    return '車両種別が不正です。'
  }
  if (draft.condition && !ASSET_CONDITIONS.includes(draft.condition)) {
    return '新品／中古の区分が不正です。'
  }
  if (draft.assetCategory === '車両') {
    const chassis = normalizeChassisNumber(draft.chassisNumber)
    if (!isValidChassisNumberFormat(chassis)) {
      return '車台番号は英数字とハイフンのみ入力できます。'
    }
    const modelYear = parseModelYearInput(draft.modelYear)
    const yearCheck = validateModelYearValue(modelYear, {
      firstRegistrationYearMonth: draft.firstRegistrationYearMonth,
    })
    if (yearCheck.error) {
      return yearCheck.error
    }
  }
  return null
}

/** Soft warnings that do not block save */
export const collectFixedAssetEditWarnings = (draft: FixedAssetEditDraft): string[] => {
  const warnings: string[] = []
  if (draft.assetCategory !== '車両') {
    return warnings
  }
  const modelYear = parseModelYearInput(draft.modelYear)
  const yearCheck = validateModelYearValue(modelYear, {
    firstRegistrationYearMonth: draft.firstRegistrationYearMonth,
  })
  if (yearCheck.warning) {
    warnings.push(yearCheck.warning)
  }
  return warnings
}

export const materialFieldsChanged = (
  original: StoredAccountingFixedAsset,
  draft: FixedAssetEditDraft,
) => {
  const nextKind = draft.registrationType === 'small' ? 'small' : draft.registrationType === 'fixed' ? 'fixed' : 'normal'
  return {
    purchaseDate: original.purchaseDate !== draft.purchaseDate,
    assetName: original.assetName !== draft.assetName.trim(),
    acquisitionCost: original.acquisitionCost !== Number(draft.acquisitionCost),
    assetKind: original.assetKind !== nextKind && nextKind !== 'normal',
    registrationTypeChanged: (original.assetKind === 'small' ? 'small' : 'fixed') !== draft.registrationType,
    useStartDate: original.useStartDate !== draft.useStartDate,
    usefulLife: original.appliedUsefulLifeYears !== Number(draft.appliedUsefulLifeYears),
  }
}

export const affectsDepreciationRecalc = (
  changed: ReturnType<typeof materialFieldsChanged>,
) =>
  changed.acquisitionCost ||
  changed.useStartDate ||
  changed.usefulLife ||
  changed.registrationTypeChanged ||
  changed.assetKind

export const buildVehicleFieldsForSave = (draft: FixedAssetEditDraft) => {
  if (draft.assetCategory !== '車両') {
    return {
      vehicleType: undefined as undefined,
      firstRegistrationYearMonth: '',
      chassisNumber: '',
      modelYear: null as number | null,
    }
  }

  return {
    vehicleType: draft.vehicleType || undefined,
    firstRegistrationYearMonth: draft.firstRegistrationYearMonth.trim() || '',
    chassisNumber: normalizeChassisNumber(draft.chassisNumber),
    modelYear: parseModelYearInput(draft.modelYear),
  }
}
