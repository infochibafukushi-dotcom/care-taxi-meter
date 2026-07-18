import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { AccountingExpenseInput } from '../types/accounting'
import {
  canConfirmExpense,
  isExpenseCategorySelected,
  normalizeExpenseInputForSave,
  normalizeExpensePatchForSave,
} from '../types/accounting'
import type {
  AccountingFixedAssetInput,
  ExpenseAssetRegistrationDraft,
  ExpenseRegistrationType,
  StoredAccountingFixedAsset,
} from '../types/accountingFixedAssets'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import {
  MULTIPLE_LINKED_FIXED_ASSETS_ERROR,
  derivePlTreatmentForRegistrationType,
  planExpenseFixedAssetSyncAction,
  resolveLinkedFixedAssetsForExpense,
  type ExpenseFixedAssetSyncAction,
} from '../utils/accountingExpenseFixedAssetSync'
import { createAuditLog, type AuditActor } from './auditLogs'
import {
  buildFixedAssetInputFromDraft,
  normalizeStoredFixedAssetForSync,
} from './accountingFixedAssets'
import { linkAccountingReceiptToExpense } from './accountingReceipts'

const expensesCollection = 'accountingExpenses'
const assetsCollection = 'accountingFixedAssets'
const receiptsCollection = 'accountingReceipts'

export type SaveExpenseWithFixedAssetInput = {
  mode: 'create' | 'update'
  /** 更新時必須。作成時は clientExpenseId があればそれを文書IDに使う */
  expenseId?: string
  /** 新規作成の冪等性用。同一IDでの再送は同一レコードになる */
  clientExpenseId?: string
  expensePayload: AccountingExpenseInput
  registrationType: ExpenseRegistrationType
  assetDraft: ExpenseAssetRegistrationDraft
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  /** メモリ上の資産一覧（検索高速化）。未指定時は Firestore を問い合わせる */
  knownAssets?: StoredAccountingFixedAsset[]
  actor?: AuditActor | null
}

export type SaveExpenseWithFixedAssetResult = {
  expenseId: string
  assetId?: string
  assetAction: ExpenseFixedAssetSyncAction
}

const sanitizeAuditFields = (input: Record<string, unknown>) => {
  const {
    receiptImageUrl: _r1,
    receiptFileUrl: _r2,
    receiptPreviewImageUrl: _r3,
    receiptStoragePath: _r4,
    receiptFileStoragePath: _r5,
    receiptPreviewStoragePath: _r6,
    ocrRawText: _ocr,
    ocrParsedFields: _parsed,
    ocrCandidates: _cand,
    phoneNumber: _phone,
    invoiceAddress: _addr,
    ...rest
  } = input
  return rest
}

const safeAudit = async (params: Parameters<typeof createAuditLog>[0]) => {
  try {
    await createAuditLog(params)
  } catch {
    // 監査ログ失敗で本体保存を落とさない
  }
}

const queryActiveAssetsByExpenseId = async (expenseId: string): Promise<StoredAccountingFixedAsset[]> => {
  const db = getFirestore(getFirebaseApp())
  try {
    const snapshots = await getDocs(
      query(
        collection(db, assetsCollection),
        where('expenseId', '==', expenseId),
        where('isDeleted', '==', false),
      ),
    )
    return snapshots.docs.map((snap) =>
      normalizeStoredFixedAssetForSync({ id: snap.id, data: () => snap.data() as Record<string, unknown> }),
    )
  } catch {
    // 複合 index 未整備時は単一 where にフォールバック
    const snapshots = await getDocs(
      query(collection(db, assetsCollection), where('expenseId', '==', expenseId)),
    )
    return snapshots.docs
      .map((snap) =>
        normalizeStoredFixedAssetForSync({
          id: snap.id,
          data: () => snap.data() as Record<string, unknown>,
        }),
      )
      .filter((asset) => asset.isDeleted !== true)
  }
}

export const loadLinkedAssetsForExpenseSave = async ({
  expenseId,
  linkedAssetId,
  knownAssets,
}: {
  expenseId?: string
  linkedAssetId?: string
  knownAssets?: StoredAccountingFixedAsset[]
}): Promise<StoredAccountingFixedAsset[]> => {
  const merged = new Map<string, StoredAccountingFixedAsset>()

  for (const asset of knownAssets ?? []) {
    if (asset.isDeleted === true) continue
    const matchesExpense = expenseId && asset.expenseId === expenseId
    const matchesLinked = linkedAssetId && asset.id === linkedAssetId
    if (matchesExpense || matchesLinked) {
      merged.set(asset.id, asset)
    }
  }

  if (expenseId?.trim()) {
    for (const asset of await queryActiveAssetsByExpenseId(expenseId.trim())) {
      merged.set(asset.id, asset)
    }
  }

  if (linkedAssetId?.trim() && !merged.has(linkedAssetId.trim())) {
    const fromKnown = (knownAssets ?? []).find((asset) => asset.id === linkedAssetId.trim())
    if (fromKnown && fromKnown.isDeleted !== true) {
      merged.set(fromKnown.id, fromKnown)
    }
  }

  return Array.from(merged.values())
}

/**
 * 経費と固定資産を writeBatch で原子的に保存する。
 * 証憑 Storage アップロードは含めない（呼び出し前に完了済みであること）。
 */
export async function saveExpenseWithFixedAssetSync(
  input: SaveExpenseWithFixedAssetInput,
): Promise<SaveExpenseWithFixedAssetResult> {
  if (isReviewDemoRuntimeEnabled()) {
    return {
      expenseId: input.expenseId || input.clientExpenseId || 'review-demo-expense',
      assetId: 'review-demo-fixed-asset',
      assetAction: input.registrationType === 'normal' ? 'none' : 'create',
    }
  }

  const {
    mode,
    expensePayload,
    registrationType,
    assetDraft,
    franchiseeId,
    storeId,
    staffId,
    staffName,
    actor,
  } = input

  if (expensePayload.confirmationStatus === '確認済み' && !canConfirmExpense(expensePayload)) {
    throw new Error('経費科目を選択しないと確認済みにできません。')
  }

  const plTreatment = derivePlTreatmentForRegistrationType(registrationType)
  const normalizedExpense = normalizeExpenseInputForSave({
    ...expensePayload,
    plTreatment:
      registrationType === 'fixed'
        ? 'excluded'
        : registrationType === 'normal'
          ? expensePayload.plTreatment ?? 'expense'
          : plTreatment,
  })

  const db = getFirestore(getFirebaseApp())
  const expenseRef =
    mode === 'update'
      ? doc(db, expensesCollection, input.expenseId!.trim())
      : doc(db, expensesCollection, input.clientExpenseId?.trim() || doc(collection(db, expensesCollection)).id)

  const expenseId = expenseRef.id
  const linkedAssets = await loadLinkedAssetsForExpenseSave({
    expenseId: mode === 'update' ? expenseId : undefined,
    linkedAssetId: expensePayload.linkedAssetId,
    knownAssets: input.knownAssets,
  })

  // 新規でも clientExpenseId 再送時に既存資産を拾う
  if (mode === 'create') {
    for (const asset of await queryActiveAssetsByExpenseId(expenseId)) {
      linkedAssets.push(asset)
    }
  }

  const resolution = resolveLinkedFixedAssetsForExpense({
    expenseId,
    linkedAssetId: expensePayload.linkedAssetId,
    assets: linkedAssets,
  })

  if (resolution.status === 'multiple') {
    throw new Error(MULTIPLE_LINKED_FIXED_ASSETS_ERROR)
  }

  const assetAction = planExpenseFixedAssetSyncAction({
    registrationType,
    linkedResolution: resolution,
  })

  const batch = writeBatch(db)
  let assetId: string | undefined = resolution.status === 'one' ? resolution.asset.id : undefined

  let assetInput: AccountingFixedAssetInput | undefined
  if (assetAction === 'create' || assetAction === 'update') {
    if (registrationType !== 'small' && registrationType !== 'fixed') {
      throw new Error('資産区分が不正です。')
    }
    assetInput = buildFixedAssetInputFromDraft({
      draft: {
        registrationType,
        assetCategory: assetDraft.assetCategory,
        assetName: assetDraft.assetName,
        condition: assetDraft.condition,
        vehicleType: assetDraft.vehicleType || undefined,
        firstRegistrationYearMonth: assetDraft.firstRegistrationYearMonth,
        chassisNumber: assetDraft.chassisNumber,
        modelYear: assetDraft.modelYear,
        acquisitionCost: assetDraft.acquisitionCost,
        purchaseDate: assetDraft.purchaseDate,
        useStartDate: assetDraft.useStartDate,
        appliedUsefulLifeYears: assetDraft.appliedUsefulLifeYears,
        usefulLifeChangeReason: assetDraft.usefulLifeChangeReason,
        notes: assetDraft.notes,
      },
      expenseId,
      franchiseeId,
      storeId,
      staffId,
      staffName,
    })
  }

  if (assetAction === 'create' && assetInput) {
    const assetRef = doc(collection(db, assetsCollection))
    assetId = assetRef.id
    batch.set(
      assetRef,
      removeUndefinedFields({
        ...assetInput,
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  } else if (assetAction === 'update' && assetInput && assetId) {
    const assetRef = doc(db, assetsCollection, assetId)
    batch.update(
      assetRef,
      removeUndefinedFields({
        ...assetInput,
        expenseId,
        updatedBy: staffId,
        updatedByName: staffName,
        updatedAt: serverTimestamp(),
      }),
    )
  } else if (assetAction === 'deactivate' && assetId) {
    const assetRef = doc(db, assetsCollection, assetId)
    batch.update(assetRef, {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: staffId,
      updatedBy: staffId,
      updatedAt: serverTimestamp(),
    })
    assetId = undefined
  }

  const expenseStored = removeUndefinedFields({
    ...normalizedExpense,
    expenseCategory: isExpenseCategorySelected(normalizedExpense.expenseCategory)
      ? normalizedExpense.expenseCategory
      : '',
    linkedAssetId: assetId ?? null,
    updatedAt: serverTimestamp(),
    ...(mode === 'create'
      ? {
          createdAt: serverTimestamp(),
          isDeleted: false,
        }
      : {}),
  })

  if (mode === 'create') {
    batch.set(expenseRef, expenseStored)
  } else {
    const patch = normalizeExpensePatchForSave({
      ...normalizedExpense,
      linkedAssetId: assetId,
    })
    batch.update(
      expenseRef,
      removeUndefinedFields({
        ...patch,
        linkedAssetId: assetId ?? null,
        updatedAt: serverTimestamp(),
      }),
    )
  }

  await batch.commit()

  if (normalizedExpense.receiptId) {
    await linkAccountingReceiptToExpense({
      receiptId: normalizedExpense.receiptId,
      expenseId,
    })
  }

  const auditTargetType = 'accountingExpense'
  await safeAudit({
    action: mode === 'create' ? 'accounting_expense_create' : 'accounting_expense_update',
    targetType: auditTargetType,
    targetId: expenseId,
    franchiseeId,
    storeId,
    actor: actor ?? null,
    after: sanitizeAuditFields({
      id: expenseId,
      registrationType,
      plTreatment: normalizedExpense.plTreatment,
      taxIncludedAmount: normalizedExpense.taxIncludedAmount,
      vendorName: normalizedExpense.vendorName,
      description: normalizedExpense.description,
      confirmationStatus: normalizedExpense.confirmationStatus,
      billingInvoiceNumber: normalizedExpense.billingInvoiceNumber ? '[set]' : '',
      linkedAssetId: assetId ?? '',
      assetAction,
    }),
  })

  if (assetAction === 'create' || assetAction === 'update' || assetAction === 'deactivate') {
    await safeAudit({
      action:
        assetAction === 'create'
          ? 'accounting_fixed_asset_create'
          : assetAction === 'update'
            ? 'accounting_fixed_asset_update'
            : 'accounting_fixed_asset_soft_delete',
      targetType: 'accountingFixedAsset',
      targetId: assetId ?? (resolution.status === 'one' ? resolution.asset.id : ''),
      franchiseeId,
      storeId,
      actor: actor ?? null,
      after: sanitizeAuditFields({
        assetAction,
        expenseId,
        registrationType,
        acquisitionCost: assetDraft.acquisitionCost,
      }),
    })
  }

  return { expenseId, assetId, assetAction }
}

/**
 * 経費論理削除と紐付固定資産の無効化を同一 batch で行う。
 */
export async function softDeleteExpenseWithLinkedAssets({
  expenseId,
  deletedBy,
  deletedByName,
  deleteReason,
  knownAssets,
  actor,
  franchiseeId,
  storeId,
}: {
  expenseId: string
  deletedBy: string
  deletedByName: string
  deleteReason?: string
  knownAssets?: StoredAccountingFixedAsset[]
  actor?: AuditActor | null
  franchiseeId?: string
  storeId?: string
}): Promise<{ deactivatedAssetIds: string[] }> {
  if (isReviewDemoRuntimeEnabled()) {
    return { deactivatedAssetIds: [] }
  }

  const db = getFirestore(getFirebaseApp())
  const expenseRef = doc(db, expensesCollection, expenseId)
  const expenseSnap = await getDoc(expenseRef)
  if (!expenseSnap.exists()) {
    return { deactivatedAssetIds: [] }
  }

  const expenseData = expenseSnap.data() as Record<string, unknown>
  const linkedReceiptIds = new Set<string>()
  const receiptId = typeof expenseData.receiptId === 'string' ? expenseData.receiptId.trim() : ''
  if (receiptId) {
    linkedReceiptIds.add(receiptId)
  }

  try {
    const linkedReceipts = await getDocs(
      query(collection(db, receiptsCollection), where('linkedExpenseId', '==', expenseId)),
    )
    for (const receiptDoc of linkedReceipts.docs) {
      linkedReceiptIds.add(receiptDoc.id)
    }
  } catch {
    // expense.receiptId 側は解除する
  }

  const linkedAssetId =
    typeof expenseData.linkedAssetId === 'string' ? expenseData.linkedAssetId : undefined
  const linkedAssets = await loadLinkedAssetsForExpenseSave({
    expenseId,
    linkedAssetId,
    knownAssets,
  })
  const resolution = resolveLinkedFixedAssetsForExpense({
    expenseId,
    linkedAssetId,
    assets: linkedAssets,
  })

  const batch = writeBatch(db)
  batch.update(
    expenseRef,
    removeUndefinedFields({
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy,
      deleteReason: deleteReason ?? '',
      receiptId: deleteField(),
      linkedAssetId: null,
      updatedBy: deletedBy,
      updatedByName: deletedByName,
      updatedAt: serverTimestamp(),
    }),
  )

  for (const linkedId of linkedReceiptIds) {
    const receiptRef = doc(db, receiptsCollection, linkedId)
    const receiptSnap = await getDoc(receiptRef)
    if (!receiptSnap.exists()) continue
    const receiptData = receiptSnap.data() as Record<string, unknown>
    const hasOcr = Boolean(receiptData.ocrCandidates || receiptData.ocrRawText)
    batch.update(receiptRef, {
      status: 'unorganized',
      receiptStatus: hasOcr ? 'ocr_ready' : 'draft',
      linkedExpenseId: deleteField(),
      updatedAt: serverTimestamp(),
    })
  }

  const deactivatedAssetIds: string[] = []
  for (const asset of resolution.assets) {
    batch.update(doc(db, assetsCollection, asset.id), {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy,
      updatedBy: deletedBy,
      updatedAt: serverTimestamp(),
    })
    deactivatedAssetIds.push(asset.id)
  }

  await batch.commit()

  await safeAudit({
    action: 'accounting_expense_soft_delete',
    targetType: 'accountingExpense',
    targetId: expenseId,
    franchiseeId: franchiseeId ?? String(expenseData.franchiseeId ?? ''),
    storeId: storeId ?? String(expenseData.storeId ?? ''),
    actor: actor ?? null,
    after: {
      deactivatedAssetIds,
      deleteReason: deleteReason ?? '',
    },
  })

  for (const assetId of deactivatedAssetIds) {
    await safeAudit({
      action: 'accounting_fixed_asset_soft_delete',
      targetType: 'accountingFixedAsset',
      targetId: assetId,
      franchiseeId: franchiseeId ?? String(expenseData.franchiseeId ?? ''),
      storeId: storeId ?? String(expenseData.storeId ?? ''),
      actor: actor ?? null,
      after: { reason: 'linked_expense_deleted', expenseId },
    })
  }

  return { deactivatedAssetIds }
}
