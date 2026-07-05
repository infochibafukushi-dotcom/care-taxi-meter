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
  AccountingAdjustmentInput,
  ExpenseConfirmationStatus,
  StoredAccountingAdjustment,
} from '../types/accounting'
import { isExpenseCategorySelected } from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAccountingTenantConstraints } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingAdjustments'

const toStoredAdjustment = (snapshot: {
  id: string
  data: () => Record<string, unknown>
}): StoredAccountingAdjustment => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    adjustmentType: (data.adjustmentType as StoredAccountingAdjustment['adjustmentType']) ?? 'sales',
    targetYearMonth: String(data.targetYearMonth ?? ''),
    salesCategory: (data.salesCategory as StoredAccountingAdjustment['salesCategory']) ?? '',
    expenseCategory: (data.expenseCategory as StoredAccountingAdjustment['expenseCategory']) ?? '',
    amountYen: Number(data.amountYen ?? 0),
    description: String(data.description ?? ''),
    confirmationStatus: (data.confirmationStatus as ExpenseConfirmationStatus) ?? '未確認',
    createdBy: String(data.createdBy ?? ''),
    createdByName: String(data.createdByName ?? ''),
    updatedBy: String(data.updatedBy ?? ''),
    updatedByName: String(data.updatedByName ?? ''),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  }
}

export async function fetchAccountingAdjustments(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return []
  }

  const db = getFirestore(getFirebaseApp())
  const snapshots = await getDocs(
    query(
      collection(db, collectionName),
      ...createAccountingTenantConstraints(scope),
      orderBy('targetYearMonth', 'desc'),
    ),
  )

  return snapshots.docs.map(toStoredAdjustment).filter((adjustment) => matchesTenantScope(adjustment, scope))
}

export async function createAccountingAdjustment(input: AccountingAdjustmentInput) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-adjustment'
  }

  if (input.confirmationStatus === '確認済み') {
    if (input.adjustmentType === 'sales' && !input.salesCategory) {
      throw new Error('売上区分を選択してください。')
    }

    if (input.adjustmentType === 'expense' && !isExpenseCategorySelected(input.expenseCategory)) {
      throw new Error('経費科目を選択してください。')
    }
  }

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(collection(db, collectionName), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return document.id
}

export async function updateAccountingAdjustment(
  adjustmentId: string,
  input: Partial<AccountingAdjustmentInput>,
) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, adjustmentId), {
    ...input,
    updatedAt: serverTimestamp(),
  })
}

export async function invalidateAccountingAdjustment({
  adjustmentId,
  updatedBy,
  updatedByName,
}: {
  adjustmentId: string
  updatedBy: string
  updatedByName: string
}) {
  await updateAccountingAdjustment(adjustmentId, {
    confirmationStatus: '無効',
    updatedBy,
    updatedByName,
  })
}
