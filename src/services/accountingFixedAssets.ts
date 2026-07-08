import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingFixedAssetInput,
  StoredAccountingFixedAsset,
} from '../types/accountingFixedAssets'
import {
  calculateDepreciationSchedule,
  calculateRemainingBookValue,
  calculateUsefulLifeYears,
  deriveFixedAssetStatus,
  toYearMonth,
} from '../utils/accountingDepreciation'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import { createAccountingTenantConstraints, logAccountingQueryFailure } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingFixedAssets'

const normalizeStoredFixedAsset = (snapshot: {
  id: string
  data: () => Record<string, unknown>
}): StoredAccountingFixedAsset => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    expenseId: typeof data.expenseId === 'string' ? data.expenseId : undefined,
    assetKind: data.assetKind === 'small' ? 'small' : 'fixed',
    purchaseDate: String(data.purchaseDate ?? ''),
    useStartDate: String(data.useStartDate ?? ''),
    assetCategory: String(data.assetCategory ?? ''),
    assetName: String(data.assetName ?? ''),
    condition: data.condition === '中古' ? '中古' : '新品',
    vehicleType:
      data.vehicleType === '普通車' || data.vehicleType === '軽自動車' || data.vehicleType === '福祉車両'
        ? data.vehicleType
        : undefined,
    firstRegistrationYearMonth:
      typeof data.firstRegistrationYearMonth === 'string' ? data.firstRegistrationYearMonth : undefined,
    acquisitionCost: Number(data.acquisitionCost ?? 0),
    standardUsefulLifeYears: Number(data.standardUsefulLifeYears ?? 0),
    appliedUsefulLifeYears: Number(data.appliedUsefulLifeYears ?? 0),
    usefulLifeChangeReason:
      typeof data.usefulLifeChangeReason === 'string' ? data.usefulLifeChangeReason : undefined,
    monthlyDepreciationYen: Number(data.monthlyDepreciationYen ?? 0),
    depreciationStartYearMonth: String(data.depreciationStartYearMonth ?? ''),
    depreciationEndYearMonth: String(data.depreciationEndYearMonth ?? ''),
    remainingBookValue: Number(data.remainingBookValue ?? 0),
    status:
      data.status === 'fully_depreciated' || data.status === 'disposed' || data.status === 'active'
        ? data.status
        : 'active',
    notes: typeof data.notes === 'string' ? data.notes : '',
    isDeleted: Boolean(data.isDeleted),
    deletedAt: typeof data.deletedAt === 'string' ? data.deletedAt : undefined,
    deletedBy: typeof data.deletedBy === 'string' ? data.deletedBy : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    createdByName: typeof data.createdByName === 'string' ? data.createdByName : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  }
}

const validateFixedAssetInput = (input: AccountingFixedAssetInput) => {
  if (!input.assetName.trim()) {
    throw new Error('資産名を入力してください。')
  }

  if (!input.assetCategory.trim()) {
    throw new Error('資産区分を選択してください。')
  }

  if (!input.purchaseDate) {
    throw new Error('購入日を入力してください。')
  }

  if (!input.useStartDate) {
    throw new Error('使用開始日を入力してください。')
  }

  if (input.acquisitionCost <= 0) {
    throw new Error('取得価額を入力してください。')
  }

  if (input.assetKind === 'fixed' && input.appliedUsefulLifeYears <= 0) {
    throw new Error('耐用年数を入力してください。')
  }

  if (
    input.assetKind === 'fixed' &&
    input.standardUsefulLifeYears !== input.appliedUsefulLifeYears &&
    !input.usefulLifeChangeReason?.trim()
  ) {
    throw new Error('耐用年数を変更した場合は変更理由を入力してください。')
  }

  if (input.assetCategory === '車両' && input.condition === '中古' && !input.firstRegistrationYearMonth) {
    throw new Error('中古車の初度登録年月を入力してください。')
  }
}

export const buildFixedAssetInputFromDraft = ({
  draft,
  expenseId,
  franchiseeId,
  storeId,
  staffId,
  staffName,
}: {
  draft: {
    registrationType: 'small' | 'fixed'
    assetCategory: string
    assetName: string
    condition: '新品' | '中古'
    vehicleType?: string
    firstRegistrationYearMonth?: string
    acquisitionCost: number
    purchaseDate: string
    useStartDate: string
    appliedUsefulLifeYears: number
    usefulLifeChangeReason?: string
    notes?: string
  }
  expenseId?: string
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
}): AccountingFixedAssetInput => {
  const assetKind = draft.registrationType
  const standardUsefulLifeYears =
    assetKind === 'fixed'
      ? calculateUsefulLifeYears({
          assetCategory: draft.assetCategory,
          condition: draft.condition,
          vehicleType:
            draft.vehicleType === '普通車' || draft.vehicleType === '軽自動車' || draft.vehicleType === '福祉車両'
              ? draft.vehicleType
              : undefined,
          firstRegistrationYearMonth: draft.firstRegistrationYearMonth,
          useStartDate: draft.useStartDate,
        })
      : 1

  const appliedUsefulLifeYears = assetKind === 'small' ? 1 : draft.appliedUsefulLifeYears || standardUsefulLifeYears
  const schedule =
    assetKind === 'fixed'
      ? calculateDepreciationSchedule({
          acquisitionCost: draft.acquisitionCost,
          usefulLifeYears: appliedUsefulLifeYears,
          useStartDate: draft.useStartDate,
        })
      : {
          depreciationStartYearMonth: toYearMonth(draft.useStartDate),
          depreciationEndYearMonth: toYearMonth(draft.useStartDate),
          monthlyDepreciationYen: draft.acquisitionCost,
        }

  const base: AccountingFixedAssetInput = {
    franchiseeId,
    companyId: franchiseeId,
    storeId,
    expenseId,
    assetKind,
    purchaseDate: draft.purchaseDate,
    useStartDate: draft.useStartDate,
    assetCategory: draft.assetCategory,
    assetName: draft.assetName,
    condition: draft.condition,
    vehicleType:
      draft.vehicleType === '普通車' || draft.vehicleType === '軽自動車' || draft.vehicleType === '福祉車両'
        ? draft.vehicleType
        : undefined,
    firstRegistrationYearMonth: draft.firstRegistrationYearMonth,
    acquisitionCost: draft.acquisitionCost,
    standardUsefulLifeYears,
    appliedUsefulLifeYears,
    usefulLifeChangeReason: draft.usefulLifeChangeReason,
    monthlyDepreciationYen: schedule.monthlyDepreciationYen,
    depreciationStartYearMonth: schedule.depreciationStartYearMonth,
    depreciationEndYearMonth: schedule.depreciationEndYearMonth,
    remainingBookValue: assetKind === 'small' ? 0 : draft.acquisitionCost,
    status: assetKind === 'small' ? 'fully_depreciated' : 'active',
    notes: draft.notes ?? '',
    createdBy: staffId,
    createdByName: staffName,
    updatedBy: staffId,
    updatedByName: staffName,
  }

  return {
    ...base,
    remainingBookValue: calculateRemainingBookValue(
      { ...base, id: 'draft' },
      schedule.depreciationStartYearMonth,
    ),
    status: deriveFixedAssetStatus(
      {
        assetKind: base.assetKind,
        depreciationEndYearMonth: schedule.depreciationEndYearMonth,
        remainingBookValue:
          assetKind === 'small'
            ? 0
            : calculateRemainingBookValue(
                { ...base, id: 'draft' } as StoredAccountingFixedAsset,
                schedule.depreciationStartYearMonth,
              ),
      },
      schedule.depreciationStartYearMonth,
    ),
  }
}

export async function fetchAccountingFixedAssets(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as StoredAccountingFixedAsset[]
  }

  const db = getFirestore(getFirebaseApp())

  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        orderBy('purchaseDate', 'desc'),
      ),
    )

    return snapshots.docs
      .map(normalizeStoredFixedAsset)
      .filter((entry) => matchesTenantScope(entry, scope))
      .map((asset) => {
        const asOfYearMonth = toYearMonth(new Date().toISOString())
        return {
          ...asset,
          remainingBookValue: calculateRemainingBookValue(asset, asOfYearMonth),
          status: deriveFixedAssetStatus(
            {
              ...asset,
              remainingBookValue: calculateRemainingBookValue(asset, asOfYearMonth),
            },
            asOfYearMonth,
          ),
        }
      })
  } catch (error) {
    logAccountingQueryFailure(collectionName, scope, error)
    throw error
  }
}

export async function createAccountingFixedAsset(input: AccountingFixedAssetInput) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-fixed-asset'
  }

  validateFixedAssetInput(input)

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(
    collection(db, collectionName),
    removeUndefinedFields({
      ...input,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  )

  return document.id
}

export async function updateAccountingFixedAsset(
  assetId: string,
  input: Partial<AccountingFixedAssetInput>,
) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(
    doc(db, collectionName, assetId),
    removeUndefinedFields({
      ...input,
      updatedAt: serverTimestamp(),
    }),
  )
}

export async function softDeleteAccountingFixedAsset({
  assetId,
  deletedBy,
}: {
  assetId: string
  deletedBy: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, assetId), {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy,
    updatedAt: serverTimestamp(),
  })
}
