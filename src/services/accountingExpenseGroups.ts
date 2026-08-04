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
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { AccountingExpenseInput, StoredAccountingExpense } from '../types/accounting'
import {
  canConfirmExpense,
  isExpenseCategorySelected,
  normalizeExpenseInputForSave,
} from '../types/accounting'
import type {
  AccountingExpenseGroupInput,
  StoredAccountingExpenseGroup,
} from '../types/accountingExpenseGroup'
import { normalizeExpenseGroupType } from '../types/accountingExpenseGroup'
import {
  computeExpenseGroupDateRange,
  sumExpenseGroupLineAmounts,
  validateExpenseGroupForSave,
} from '../utils/accountingExpenseGroup'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import {
  createAccountingTenantConstraints,
  logAccountingQueryFailure,
  resolveAccountingTenantFields,
} from './accountingTenant'
import { linkAccountingReceiptToExpense } from './accountingReceipts'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const groupCollectionName = 'accountingExpenseGroups'
const expenseCollectionName = 'accountingExpenses'

const readTimestampAsIso = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString()
  }
  return undefined
}

const toStoredGroup = (snapshot: {
  id: string
  data: () => Record<string, unknown>
}): StoredAccountingExpenseGroup => {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    groupType: normalizeExpenseGroupType(data.groupType),
    title: String(data.title ?? ''),
    startDate: typeof data.startDate === 'string' ? data.startDate : null,
    endDate: typeof data.endDate === 'string' ? data.endDate : null,
    totalAmount: Number(data.totalAmount ?? 0),
    expenseIds: Array.isArray(data.expenseIds)
      ? data.expenseIds.filter((id): id is string => typeof id === 'string')
      : [],
    reportId:
      typeof data.reportId === 'string' && data.reportId.trim() ? data.reportId.trim() : null,
    confirmationStatus:
      data.confirmationStatus === '確認済み' || data.confirmationStatus === '無効'
        ? data.confirmationStatus
        : '未確認',
    memo: typeof data.memo === 'string' ? data.memo : '',
    createdBy: String(data.createdBy ?? ''),
    createdByName: String(data.createdByName ?? ''),
    updatedBy: String(data.updatedBy ?? ''),
    updatedByName: String(data.updatedByName ?? ''),
    isDeleted: data.isDeleted === true,
    deletedAt: readTimestampAsIso(data.deletedAt),
    deletedBy: typeof data.deletedBy === 'string' ? data.deletedBy : '',
    deleteReason: typeof data.deleteReason === 'string' ? data.deleteReason : '',
    createdAt: readTimestampAsIso(data.createdAt),
    updatedAt: readTimestampAsIso(data.updatedAt),
  }
}

export async function fetchAccountingExpenseGroups(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())
  try {
    const snapshots = await getDocs(
      query(
        collection(db, groupCollectionName),
        ...createAccountingTenantConstraints(scope),
        orderBy('updatedAt', 'desc'),
      ),
    )
    return snapshots.docs.map(toStoredGroup).filter((group) => matchesTenantScope(group, scope))
  } catch (error) {
    logAccountingQueryFailure(groupCollectionName, scope, error)
    throw error
  }
}

export const buildEmptyExpenseGroupInput = ({
  franchiseeId,
  storeId,
  staffId,
  staffName,
}: {
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
}): AccountingExpenseGroupInput => {
  const tenant = resolveAccountingTenantFields({ franchiseeId, storeId })
  return {
    ...tenant,
    groupType: 'training',
    title: '',
    startDate: null,
    endDate: null,
    totalAmount: 0,
    expenseIds: [],
    reportId: null,
    confirmationStatus: '未確認',
    memo: '',
    createdBy: staffId,
    createdByName: staffName,
    updatedBy: staffId,
    updatedByName: staffName,
  }
}

export type SaveExpenseGroupLineInput = AccountingExpenseInput & {
  /** 既存明細の更新時 */
  existingExpenseId?: string
}

export type SaveAccountingExpenseGroupParams = {
  mode: 'create' | 'update'
  groupId?: string
  group: Omit<
    AccountingExpenseGroupInput,
    'startDate' | 'endDate' | 'totalAmount' | 'expenseIds'
  > & {
    startDate?: string | null
    endDate?: string | null
    totalAmount?: number
    expenseIds?: string[]
  }
  lines: SaveExpenseGroupLineInput[]
  /** 編集時に削除する既存明細 ID */
  removedExpenseIds?: string[]
  clientTotalAmount?: number
}

/**
 * まとめ経費を親 + 明細として一連保存する。
 * totalAmount / 期間はサーバー側（この関数内）で明細から再計算する。
 */
export async function saveAccountingExpenseGroup({
  mode,
  groupId,
  group,
  lines,
  removedExpenseIds = [],
  clientTotalAmount,
}: SaveAccountingExpenseGroupParams): Promise<{ groupId: string; expenseIds: string[] }> {
  if (isReviewDemoRuntimeEnabled()) {
    return { groupId: groupId || 'review-demo-group', expenseIds: lines.map((_, i) => `review-line-${i}`) }
  }

  const validationErrors = validateExpenseGroupForSave({
    title: group.title,
    lines: lines.map((line) => ({
      taxIncludedAmount: line.taxIncludedAmount,
      receiptDate: line.receiptDate || line.postingDate || line.transactionDate || '',
      expenseCategory: String(line.expenseCategory ?? ''),
    })),
    clientTotalAmount,
  })
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.map((error) => error.message).join('\n'))
  }

  for (const line of lines) {
    if (line.confirmationStatus === '確認済み' && !canConfirmExpense(line)) {
      throw new Error('経費科目を選択しないと確認済みにできません。')
    }
  }

  const dateRange = computeExpenseGroupDateRange(
    lines.map((line) => line.receiptDate || line.postingDate || line.transactionDate),
  )
  const totalAmount = sumExpenseGroupLineAmounts(lines.map((line) => line.taxIncludedAmount))

  const db = getFirestore(getFirebaseApp())
  const batch = writeBatch(db)
  const resolvedGroupId = mode === 'update' && groupId ? groupId : doc(collection(db, groupCollectionName)).id
  const groupRef = doc(db, groupCollectionName, resolvedGroupId)

  const expenseIds: string[] = []
  const receiptLinks: Array<{ receiptId: string; expenseId: string }> = []

  for (const line of lines) {
    const normalized = normalizeExpenseInputForSave({
      ...line,
      expenseGroupId: resolvedGroupId,
      // PL は明細の取引日・利用日（receiptDate）を原則とする
      postingDate: line.receiptDate || line.postingDate || line.transactionDate,
      transactionDate: line.receiptDate || line.postingDate || line.transactionDate,
    })

    const expenseId =
      line.existingExpenseId?.trim() || doc(collection(db, expenseCollectionName)).id
    expenseIds.push(expenseId)
    const expenseRef = doc(db, expenseCollectionName, expenseId)

    const payload = removeUndefinedFields({
      ...normalized,
      expenseCategory: isExpenseCategorySelected(normalized.expenseCategory)
        ? normalized.expenseCategory
        : '',
      expenseGroupId: resolvedGroupId,
      updatedAt: serverTimestamp(),
      ...(line.existingExpenseId
        ? {}
        : {
            createdAt: serverTimestamp(),
          }),
    })

    if (line.existingExpenseId) {
      batch.update(expenseRef, payload)
    } else {
      batch.set(expenseRef, payload)
    }

    if (normalized.receiptId) {
      receiptLinks.push({ receiptId: normalized.receiptId, expenseId })
    }
  }

  for (const removedId of removedExpenseIds) {
    if (!removedId.trim()) {
      continue
    }
    batch.update(doc(db, expenseCollectionName, removedId), {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: group.updatedBy,
      deleteReason: 'まとめ経費明細の削除',
      updatedBy: group.updatedBy,
      updatedByName: group.updatedByName,
      updatedAt: serverTimestamp(),
    })
  }

  const groupPayload = removeUndefinedFields({
    franchiseeId: group.franchiseeId,
    companyId: group.companyId,
    storeId: group.storeId,
    groupType: normalizeExpenseGroupType(group.groupType),
    title: group.title.trim(),
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    totalAmount,
    expenseIds,
    reportId: group.reportId ?? null,
    confirmationStatus: group.confirmationStatus,
    memo: group.memo ?? '',
    createdBy: group.createdBy,
    createdByName: group.createdByName,
    updatedBy: group.updatedBy,
    updatedByName: group.updatedByName,
    isDeleted: false,
    updatedAt: serverTimestamp(),
    ...(mode === 'create' ? { createdAt: serverTimestamp() } : {}),
  })

  if (mode === 'create') {
    batch.set(groupRef, groupPayload)
  } else {
    batch.set(groupRef, groupPayload, { merge: true })
  }

  await batch.commit()

  for (const link of receiptLinks) {
    try {
      await linkAccountingReceiptToExpense({
        receiptId: link.receiptId,
        expenseId: link.expenseId,
      })
    } catch (error) {
      console.error('[accounting] failed to link receipt to grouped expense', {
        ...link,
        error,
      })
    }
  }

  return { groupId: resolvedGroupId, expenseIds }
}

export async function softDeleteAccountingExpenseGroup({
  groupId,
  expenses,
  deletedBy,
  deletedByName,
  deleteReason,
}: {
  groupId: string
  expenses: StoredAccountingExpense[]
  deletedBy: string
  deletedByName: string
  deleteReason?: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  const batch = writeBatch(db)
  const now = new Date().toISOString()

  batch.update(doc(db, groupCollectionName, groupId), {
    isDeleted: true,
    deletedAt: now,
    deletedBy,
    deleteReason: deleteReason || 'まとめ経費の削除',
    confirmationStatus: '無効',
    updatedBy: deletedBy,
    updatedByName: deletedByName,
    updatedAt: serverTimestamp(),
  })

  for (const expense of expenses) {
    if (expense.expenseGroupId !== groupId || expense.isDeleted) {
      continue
    }
    batch.update(doc(db, expenseCollectionName, expense.id), {
      isDeleted: true,
      deletedAt: now,
      deletedBy,
      deleteReason: deleteReason || 'まとめ経費削除に伴う明細削除',
      updatedBy: deletedBy,
      updatedByName: deletedByName,
      updatedAt: serverTimestamp(),
    })
  }

  await batch.commit()
}

export async function updateAccountingExpenseGroupReportId({
  groupId,
  reportId,
  updatedBy,
  updatedByName,
}: {
  groupId: string
  reportId: string | null
  updatedBy: string
  updatedByName: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, groupCollectionName, groupId), {
    reportId,
    updatedBy,
    updatedByName,
    updatedAt: serverTimestamp(),
  })
}

/** テスト・デモ用に親ドキュメントだけ作成（通常は saveAccountingExpenseGroup を使う） */
export async function createAccountingExpenseGroupDocument(
  input: AccountingExpenseGroupInput,
) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-group'
  }

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(
    collection(db, groupCollectionName),
    removeUndefinedFields({
      ...input,
      groupType: normalizeExpenseGroupType(input.groupType),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  )
  return document.id
}
