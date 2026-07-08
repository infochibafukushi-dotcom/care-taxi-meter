import type {
  AssetCondition,
  FixedAssetItemType,
  StoredAccountingFixedAsset,
  VehicleType,
} from '../types/accountingFixedAssets'

/** 少額減価償却資産の年間上限（円） */
export const SMALL_ASSET_ANNUAL_LIMIT_YEN = 3_000_000

const STANDARD_USEFUL_LIFE_YEARS: Record<FixedAssetItemType, number> = {
  車両: 6,
  PC: 4,
  タブレット: 4,
  プリンター: 5,
  ストレッチャー: 5,
  車いす: 4,
  ソフトウェア: 5,
  看板: 15,
  事務所リフォーム: 15,
  その他: 5,
}

const VEHICLE_STATUTORY_YEARS: Record<VehicleType, number> = {
  普通車: 6,
  軽自動車: 4,
  福祉車両: 6,
}

export type SmallAssetAmountRecommendation = 'normal_expense' | 'small_asset' | 'above_small_asset_limit'

export const getSmallAssetAmountRecommendation = (amountYen: number): SmallAssetAmountRecommendation => {
  if (amountYen < 100_000) {
    return 'normal_expense'
  }

  if (amountYen < 400_000) {
    return 'small_asset'
  }

  return 'above_small_asset_limit'
}

export const getSmallAssetAmountRecommendationLabel = (recommendation: SmallAssetAmountRecommendation) => {
  if (recommendation === 'normal_expense') {
    return '10万円未満 → 通常経費を推奨'
  }

  if (recommendation === 'small_asset') {
    return '10万円以上40万円未満 → 少額減価償却資産を推奨'
  }

  return '40万円以上 → 固定資産登録を検討してください'
}

export const getStandardUsefulLifeYears = (
  assetCategory: string,
  vehicleType?: VehicleType,
): number => {
  if (assetCategory === '車両' && vehicleType) {
    return VEHICLE_STATUTORY_YEARS[vehicleType]
  }

  return STANDARD_USEFUL_LIFE_YEARS[assetCategory as FixedAssetItemType] ?? 5
}

const countElapsedYears = (fromYearMonth: string, toDate: string) => {
  const [fromYear, fromMonth] = fromYearMonth.split('-').map(Number)
  const to = new Date(`${toDate}T00:00:00`)
  const toYear = to.getFullYear()
  const toMonth = to.getMonth() + 1
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth)
  return Math.max(0, Math.floor(months / 12))
}

/** 中古車の残存耐用年数（簡易計算） */
export const calculateUsedVehicleUsefulLifeYears = ({
  vehicleType,
  firstRegistrationYearMonth,
  useStartDate,
}: {
  vehicleType: VehicleType
  firstRegistrationYearMonth: string
  useStartDate: string
}) => {
  const statutoryYears = VEHICLE_STATUTORY_YEARS[vehicleType]
  const elapsedYears = countElapsedYears(firstRegistrationYearMonth, useStartDate)
  const remaining = statutoryYears - elapsedYears * 0.8
  return Math.max(2, Math.ceil(remaining))
}

export const calculateUsefulLifeYears = ({
  assetCategory,
  condition,
  vehicleType,
  firstRegistrationYearMonth,
  useStartDate,
}: {
  assetCategory: string
  condition: AssetCondition
  vehicleType?: VehicleType
  firstRegistrationYearMonth?: string
  useStartDate: string
}) => {
  if (assetCategory === '車両' && vehicleType) {
    if (condition === '中古' && firstRegistrationYearMonth) {
      return calculateUsedVehicleUsefulLifeYears({
        vehicleType,
        firstRegistrationYearMonth,
        useStartDate,
      })
    }

    return VEHICLE_STATUTORY_YEARS[vehicleType]
  }

  return getStandardUsefulLifeYears(assetCategory, vehicleType)
}

export const toYearMonth = (date: string) => date.slice(0, 7)

export const addMonthsToYearMonth = (yearMonth: string, months: number) => {
  const [year, month] = yearMonth.split('-').map(Number)
  const totalMonths = year * 12 + (month - 1) + months
  const nextYear = Math.floor(totalMonths / 12)
  const nextMonth = (totalMonths % 12) + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`
}

export const calculateMonthlyDepreciationYen = (acquisitionCost: number, usefulLifeYears: number) => {
  if (acquisitionCost <= 0 || usefulLifeYears <= 0) {
    return 0
  }

  return Math.floor(acquisitionCost / (usefulLifeYears * 12))
}

export const calculateDepreciationSchedule = ({
  acquisitionCost,
  usefulLifeYears,
  useStartDate,
}: {
  acquisitionCost: number
  usefulLifeYears: number
  useStartDate: string
}) => {
  const depreciationStartYearMonth = toYearMonth(useStartDate)
  const totalMonths = usefulLifeYears * 12
  const depreciationEndYearMonth = addMonthsToYearMonth(depreciationStartYearMonth, totalMonths - 1)
  const monthlyDepreciationYen = calculateMonthlyDepreciationYen(acquisitionCost, usefulLifeYears)

  return {
    depreciationStartYearMonth,
    depreciationEndYearMonth,
    monthlyDepreciationYen,
  }
}

export const isYearMonthInRange = (targetYearMonth: string, startYearMonth: string, endYearMonth: string) =>
  targetYearMonth >= startYearMonth && targetYearMonth <= endYearMonth

export const countDepreciatedMonths = (asset: StoredAccountingFixedAsset, asOfYearMonth: string) => {
  if (!isYearMonthInRange(asOfYearMonth, asset.depreciationStartYearMonth, asset.depreciationEndYearMonth)) {
    if (asOfYearMonth < asset.depreciationStartYearMonth) {
      return 0
    }

    return asset.appliedUsefulLifeYears * 12
  }

  const [startYear, startMonth] = asset.depreciationStartYearMonth.split('-').map(Number)
  const [asOfYear, asOfMonth] = asOfYearMonth.split('-').map(Number)
  return (asOfYear - startYear) * 12 + (asOfMonth - startMonth) + 1
}

export const calculateRemainingBookValue = (asset: StoredAccountingFixedAsset, asOfYearMonth: string) => {
  if (asset.assetKind === 'small') {
    return 0
  }

  const depreciatedMonths = countDepreciatedMonths(asset, asOfYearMonth)
  const totalMonths = asset.appliedUsefulLifeYears * 12
  const depreciatedAmount = Math.min(
    asset.acquisitionCost,
    asset.monthlyDepreciationYen * depreciatedMonths,
  )

  if (depreciatedMonths >= totalMonths) {
    return 0
  }

  return Math.max(0, asset.acquisitionCost - depreciatedAmount)
}

export const deriveFixedAssetStatus = (
  asset: Pick<
    StoredAccountingFixedAsset,
    'assetKind' | 'depreciationEndYearMonth' | 'remainingBookValue'
  >,
  asOfYearMonth: string,
): StoredAccountingFixedAsset['status'] => {
  if (asset.assetKind === 'small') {
    return 'fully_depreciated'
  }

  if (asOfYearMonth > asset.depreciationEndYearMonth || asset.remainingBookValue <= 0) {
    return 'fully_depreciated'
  }

  return 'active'
}

export const calculateSmallAssetUsageForYear = (
  assets: Array<Pick<StoredAccountingFixedAsset, 'assetKind' | 'purchaseDate' | 'acquisitionCost' | 'isDeleted'>>,
  calendarYear: number,
) => {
  const usedYen = assets
    .filter(
      (asset) =>
        asset.assetKind === 'small' &&
        !asset.isDeleted &&
        asset.purchaseDate.startsWith(String(calendarYear)),
    )
    .reduce((total, asset) => total + asset.acquisitionCost, 0)

  return {
    annualLimitYen: SMALL_ASSET_ANNUAL_LIMIT_YEN,
    usedYen,
    remainingYen: Math.max(0, SMALL_ASSET_ANNUAL_LIMIT_YEN - usedYen),
  }
}

export const getDepreciationAmountForMonth = (
  asset: StoredAccountingFixedAsset,
  targetYearMonth: string,
) => {
  if (asset.assetKind !== 'fixed' || asset.isDeleted || asset.status === 'disposed') {
    return 0
  }

  if (!isYearMonthInRange(targetYearMonth, asset.depreciationStartYearMonth, asset.depreciationEndYearMonth)) {
    return 0
  }

  const totalMonths = asset.appliedUsefulLifeYears * 12
  const isLastMonth = targetYearMonth === asset.depreciationEndYearMonth
  const regularTotal = asset.monthlyDepreciationYen * totalMonths
  const remainder = asset.acquisitionCost - regularTotal

  if (isLastMonth && remainder > 0) {
    return asset.monthlyDepreciationYen + remainder
  }

  return asset.monthlyDepreciationYen
}

export const aggregateMonthlyDepreciationYen = (
  assets: StoredAccountingFixedAsset[],
  targetYearMonth: string,
) =>
  assets.reduce((total, asset) => total + getDepreciationAmountForMonth(asset, targetYearMonth), 0)
