import type { AccountingTenantFields } from './accounting'

export const EXPENSE_REGISTRATION_TYPES = ['normal', 'small', 'fixed'] as const

export type ExpenseRegistrationType = (typeof EXPENSE_REGISTRATION_TYPES)[number]

export const EXPENSE_REGISTRATION_TYPE_LABELS: Record<ExpenseRegistrationType, string> = {
  normal: '通常経費',
  small: '少額資産',
  fixed: '固定資産',
}

export const SMALL_ASSET_ITEM_TYPES = [
  'PC',
  'タブレット',
  'プリンター',
  'スマートフォン',
  '車いす',
  'ストレッチャー',
  'ソフトウェア',
  'その他',
] as const

export type SmallAssetItemType = (typeof SMALL_ASSET_ITEM_TYPES)[number]

export const FIXED_ASSET_ITEM_TYPES = [
  '車両',
  'PC',
  'タブレット',
  'プリンター',
  'ストレッチャー',
  '車いす',
  'ソフトウェア',
  '看板',
  '事務所リフォーム',
  'その他',
] as const

export type FixedAssetItemType = (typeof FIXED_ASSET_ITEM_TYPES)[number]

export const VEHICLE_TYPES = ['普通車', '軽自動車', '福祉車両'] as const

export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const ASSET_CONDITIONS = ['新品', '中古'] as const

export type AssetCondition = (typeof ASSET_CONDITIONS)[number]

export const FIXED_ASSET_STATUSES = ['active', 'fully_depreciated', 'disposed'] as const

export type FixedAssetStatus = (typeof FIXED_ASSET_STATUSES)[number]

export const FIXED_ASSET_STATUS_LABELS: Record<FixedAssetStatus, string> = {
  active: '償却中',
  fully_depreciated: '償却完了',
  disposed: '除却',
}

export type AccountingFixedAssetInput = AccountingTenantFields & {
  expenseId?: string
  assetKind: 'small' | 'fixed'
  purchaseDate: string
  useStartDate: string
  assetCategory: string
  assetName: string
  condition: AssetCondition
  vehicleType?: VehicleType
  firstRegistrationYearMonth?: string
  acquisitionCost: number
  standardUsefulLifeYears: number
  appliedUsefulLifeYears: number
  usefulLifeChangeReason?: string
  monthlyDepreciationYen: number
  depreciationStartYearMonth: string
  depreciationEndYearMonth: string
  remainingBookValue: number
  status: FixedAssetStatus
  notes?: string
  createdBy?: string
  createdByName?: string
  updatedBy?: string
  updatedByName?: string
}

export type StoredAccountingFixedAsset = AccountingFixedAssetInput & {
  id: string
  isDeleted?: boolean
  deletedAt?: string
  deletedBy?: string
  createdAt?: string
  updatedAt?: string
}

export type ExpenseAssetRegistrationDraft = {
  registrationType: ExpenseRegistrationType
  assetCategory: string
  assetName: string
  condition: AssetCondition
  vehicleType: VehicleType | ''
  firstRegistrationYearMonth: string
  acquisitionCost: number
  purchaseDate: string
  useStartDate: string
  standardUsefulLifeYears: number
  appliedUsefulLifeYears: number
  usefulLifeChangeReason: string
  monthlyDepreciationYen: number
  depreciationStartYearMonth: string
  depreciationEndYearMonth: string
  notes: string
}

export const buildEmptyExpenseAssetDraft = (): ExpenseAssetRegistrationDraft => ({
  registrationType: 'normal',
  assetCategory: '',
  assetName: '',
  condition: '新品',
  vehicleType: '',
  firstRegistrationYearMonth: '',
  acquisitionCost: 0,
  purchaseDate: '',
  useStartDate: '',
  standardUsefulLifeYears: 0,
  appliedUsefulLifeYears: 0,
  usefulLifeChangeReason: '',
  monthlyDepreciationYen: 0,
  depreciationStartYearMonth: '',
  depreciationEndYearMonth: '',
  notes: '',
})
