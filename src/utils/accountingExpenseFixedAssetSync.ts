import type { AccountingExpenseInput } from '../types/accounting'
import {
  EXPENSE_REGISTRATION_TYPE_LABELS,
  type ExpenseAssetRegistrationDraft,
  type ExpenseRegistrationType,
  type StoredAccountingFixedAsset,
  buildEmptyExpenseAssetDraft,
} from '../types/accountingFixedAssets'

export const MULTIPLE_LINKED_FIXED_ASSETS_ERROR =
  'この経費には複数の固定資産が紐付いています。データ確認が必要です。'

export const EXPENSE_DELETE_WITH_ASSET_CONFIRM =
  'この経費には固定資産が紐付いています。経費を削除すると固定資産もPL集計対象外になります。'

export type LinkedFixedAssetResolution =
  | { status: 'none'; assets: [] }
  | { status: 'one'; asset: StoredAccountingFixedAsset; assets: [StoredAccountingFixedAsset] }
  | { status: 'multiple'; assets: StoredAccountingFixedAsset[] }

const isActiveAsset = (asset: StoredAccountingFixedAsset) => asset.isDeleted !== true

/**
 * 経費に紐付く固定資産を検索順で解決する。
 * 1. linkedAssetId
 * 2. expenseId / linkedExpenseId 相当（asset.expenseId）
 * 3. 同一テナント内のアクティブ資産のうち expenseId 一致（呼び出し側が渡す候補全体）
 */
export const resolveLinkedFixedAssetsForExpense = ({
  expenseId,
  linkedAssetId,
  assets,
}: {
  expenseId?: string
  linkedAssetId?: string
  assets: StoredAccountingFixedAsset[]
}): LinkedFixedAssetResolution => {
  const active = assets.filter(isActiveAsset)
  const byId = new Map(active.map((asset) => [asset.id, asset]))
  const matched = new Map<string, StoredAccountingFixedAsset>()

  const linkedId = linkedAssetId?.trim()
  if (linkedId) {
    const byLinked = byId.get(linkedId)
    if (byLinked) {
      matched.set(byLinked.id, byLinked)
    }
  }

  const expenseKey = expenseId?.trim()
  if (expenseKey) {
    for (const asset of active) {
      if (asset.expenseId === expenseKey) {
        matched.set(asset.id, asset)
      }
    }
  }

  const list = Array.from(matched.values())
  if (list.length === 0) {
    return { status: 'none', assets: [] }
  }
  if (list.length === 1) {
    return { status: 'one', asset: list[0]!, assets: [list[0]!] }
  }
  return { status: 'multiple', assets: list }
}

export const derivePlTreatmentForRegistrationType = (
  registrationType: ExpenseRegistrationType,
): AccountingExpenseInput['plTreatment'] =>
  registrationType === 'fixed' ? 'excluded' : 'expense'

export const inferRegistrationTypeFromAsset = (
  asset: Pick<StoredAccountingFixedAsset, 'assetKind'>,
): Extract<ExpenseRegistrationType, 'small' | 'fixed'> =>
  asset.assetKind === 'small' ? 'small' : 'fixed'

export const describePlTreatmentForRegistrationType = (
  registrationType: ExpenseRegistrationType,
): string => {
  if (registrationType === 'fixed') {
    return 'PL非反映（減価償却費のみ月次PLへ反映）'
  }
  if (registrationType === 'small') {
    return '取得月に経費としてPL反映（月次減価償却なし）'
  }
  return '通常どおり経費としてPL反映'
}

export const describeDepreciationImpactForRegistrationType = (
  registrationType: ExpenseRegistrationType,
): string => {
  if (registrationType === 'fixed') {
    return '月次減価償却を開始（または継続）します'
  }
  if (registrationType === 'small') {
    return '月次減価償却は行いません（取得月に一括経費）'
  }
  return '固定資産の償却対象から除外します'
}

export const buildAssetCategoryChangeConfirmMessage = ({
  fromType,
  toType,
}: {
  fromType: ExpenseRegistrationType
  toType: ExpenseRegistrationType
}): string => {
  if (fromType === toType) {
    return ''
  }

  return [
    '資産区分を変更します。内容を確認してください。',
    '',
    `変更前の資産区分: ${EXPENSE_REGISTRATION_TYPE_LABELS[fromType]}`,
    `変更後の資産区分: ${EXPENSE_REGISTRATION_TYPE_LABELS[toType]}`,
    `変更前のPL反映方法: ${describePlTreatmentForRegistrationType(fromType)}`,
    `変更後のPL反映方法: ${describePlTreatmentForRegistrationType(toType)}`,
    `減価償却費への影響: ${describeDepreciationImpactForRegistrationType(toType)}`,
    '',
    'この内容で保存しますか？',
  ].join('\n')
}

export const buildExpenseDeleteWithLinkedAssetConfirmMessage = () =>
  [
    EXPENSE_DELETE_WITH_ASSET_CONFIRM,
    '',
    '経費と紐付固定資産の両方を集計対象外にします。よろしいですか？',
  ].join('\n')

export const buildFixedAssetDeleteLinkedExpenseWarning = (expenseSummary: string) =>
  [
    'この固定資産には経費が紐付いています。',
    `紐付経費: ${expenseSummary}`,
    '',
    '固定資産のみを削除します（経費は削除しません）。よろしいですか？',
  ].join('\n')

/** 紐付資産から経費編集用ドラフトを構築 */
export const buildAssetDraftFromLinkedFixedAsset = (
  asset: StoredAccountingFixedAsset,
  fallbacks?: Partial<ExpenseAssetRegistrationDraft>,
): ExpenseAssetRegistrationDraft => ({
  ...buildEmptyExpenseAssetDraft(),
  registrationType: inferRegistrationTypeFromAsset(asset),
  assetCategory: asset.assetCategory || fallbacks?.assetCategory || '',
  assetName: asset.assetName || fallbacks?.assetName || '',
  condition: asset.condition === '中古' ? '中古' : '新品',
  vehicleType: asset.vehicleType ?? '',
  firstRegistrationYearMonth: asset.firstRegistrationYearMonth ?? '',
  chassisNumber: asset.chassisNumber ?? '',
  modelYear: asset.modelYear ?? '',
  acquisitionCost: asset.acquisitionCost || fallbacks?.acquisitionCost || 0,
  purchaseDate: asset.purchaseDate || fallbacks?.purchaseDate || '',
  useStartDate: asset.useStartDate || fallbacks?.useStartDate || '',
  standardUsefulLifeYears: asset.standardUsefulLifeYears || 0,
  appliedUsefulLifeYears: asset.appliedUsefulLifeYears || 0,
  usefulLifeChangeReason: asset.usefulLifeChangeReason ?? '',
  monthlyDepreciationYen: asset.monthlyDepreciationYen || 0,
  depreciationStartYearMonth: asset.depreciationStartYearMonth || '',
  depreciationEndYearMonth: asset.depreciationEndYearMonth || '',
  notes: asset.notes ?? '',
})

export type ExpenseFixedAssetSyncAction = 'none' | 'create' | 'update' | 'deactivate'

export const planExpenseFixedAssetSyncAction = ({
  registrationType,
  linkedResolution,
}: {
  registrationType: ExpenseRegistrationType
  linkedResolution: LinkedFixedAssetResolution
}): ExpenseFixedAssetSyncAction => {
  if (linkedResolution.status === 'multiple') {
    throw new Error(MULTIPLE_LINKED_FIXED_ASSETS_ERROR)
  }

  const needsAsset = registrationType === 'small' || registrationType === 'fixed'
  if (needsAsset) {
    return linkedResolution.status === 'one' ? 'update' : 'create'
  }
  return linkedResolution.status === 'one' ? 'deactivate' : 'none'
}
