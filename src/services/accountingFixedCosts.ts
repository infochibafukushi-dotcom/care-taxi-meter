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
  AccountingFixedCostInput,
  FixedCostStatus,
  StoredAccountingFixedCost,
} from '../types/accounting'
import { isExpenseCategorySelected } from '../types/accounting'
import { deriveFixedCostStatus, getFixedCostCancelYearMonth } from '../utils/accountingFixedCost'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAccountingTenantConstraints, logAccountingQueryFailure } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingFixedCosts'

const normalizeStoredFixedCost = (snapshot: {
  id: string
  data: () => Record<string, unknown>
}): StoredAccountingFixedCost => {
  const data = snapshot.data()
  const cancelYearMonth =
    typeof data.cancelYearMonth === 'string'
      ? data.cancelYearMonth
      : typeof data.endYearMonth === 'string'
        ? data.endYearMonth
        : undefined
  const monthlyAmountYen = Number(data.monthlyAmountYen ?? 0)
  const annualAmountYen = Number(
    data.annualAmountYen ?? (data.monthlyAmountYen ? Number(data.monthlyAmountYen) * 12 : 0),
  )
  const amountMode =
    data.amountMode === 'annual' || data.amountMode === 'monthly'
      ? data.amountMode
      : ('monthly' as const)

  const partial: StoredAccountingFixedCost = {
    id: snapshot.id,
    franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
    companyId: String(data.companyId ?? data.franchiseeId ?? ''),
    storeId: String(data.storeId ?? ''),
    name: String(data.name ?? ''),
    expenseCategory: data.expenseCategory as StoredAccountingFixedCost['expenseCategory'],
    amountMode,
    monthlyAmountYen,
    annualAmountYen,
    startYearMonth: String(data.startYearMonth ?? ''),
    endYearMonth: cancelYearMonth,
    cancelYearMonth,
    status:
      data.status === 'active' || data.status === 'cancelled'
        ? data.status
        : cancelYearMonth
          ? 'cancelled'
          : 'active',
    memo: typeof data.memo === 'string' ? data.memo : '',
    confirmationStatus:
      (data.confirmationStatus as StoredAccountingFixedCost['confirmationStatus']) ?? '確認済み',
    sourceType: 'fixedCost',
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    cancelledAt: typeof data.cancelledAt === 'string' ? data.cancelledAt : undefined,
  }

  return {
    ...partial,
    status: deriveFixedCostStatus(partial),
  }
}

const validateFixedCostInput = (input: AccountingFixedCostInput) => {
  if (!input.name.trim()) {
    throw new Error('名称を入力してください。')
  }

  if (!isExpenseCategorySelected(input.expenseCategory)) {
    throw new Error('科目を選択してください。')
  }

  if (!input.startYearMonth) {
    throw new Error('発生開始月を入力してください。')
  }

  if (input.amountMode === 'monthly' && input.monthlyAmountYen <= 0) {
    throw new Error('月額を入力してください。')
  }

  if (input.amountMode === 'annual' && input.annualAmountYen <= 0) {
    throw new Error('年額を入力してください。')
  }

  const cancelYearMonth = getFixedCostCancelYearMonth(input)
  if (cancelYearMonth && cancelYearMonth < input.startYearMonth) {
    throw new Error('解約月は発生開始月以降を指定してください。')
  }
}

const toFirestorePayload = (input: Partial<AccountingFixedCostInput>) => {
  const cancelYearMonth = input.cancelYearMonth ?? input.endYearMonth
  const status: FixedCostStatus | undefined =
    input.status ?? (cancelYearMonth ? 'cancelled' : input.confirmationStatus === '無効' ? 'cancelled' : 'active')

  return {
    ...input,
    cancelYearMonth,
    endYearMonth: cancelYearMonth,
    status,
    sourceType: 'fixedCost' as const,
  }
}

export async function fetchAccountingFixedCosts(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as StoredAccountingFixedCost[]
  }

  const db = getFirestore(getFirebaseApp())

  try {
    const snapshots = await getDocs(
      query(
        collection(db, collectionName),
        ...createAccountingTenantConstraints(scope),
        orderBy('startYearMonth', 'desc'),
      ),
    )

    return snapshots.docs
      .map(normalizeStoredFixedCost)
      .filter((entry) => matchesTenantScope(entry, scope))
  } catch (error) {
    logAccountingQueryFailure(collectionName, scope, error)
    throw error
  }
}

export async function createAccountingFixedCost(input: AccountingFixedCostInput) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-fixed-cost'
  }

  validateFixedCostInput(input)

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(collection(db, collectionName), {
    ...toFirestorePayload(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return document.id
}

export async function updateAccountingFixedCost(
  fixedCostId: string,
  input: Partial<AccountingFixedCostInput> & { cancelledAt?: ReturnType<typeof serverTimestamp> },
) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  if (
    input.name !== undefined &&
    input.expenseCategory !== undefined &&
    input.startYearMonth !== undefined &&
    input.amountMode !== undefined
  ) {
    validateFixedCostInput(input as AccountingFixedCostInput)
  }

  const db = getFirestore(getFirebaseApp())
  await updateDoc(doc(db, collectionName, fixedCostId), {
    ...toFirestorePayload(input),
    ...(input.cancelledAt !== undefined ? { cancelledAt: input.cancelledAt } : {}),
    updatedAt: serverTimestamp(),
  })
}

export async function cancelAccountingFixedCost({
  fixedCostId,
  cancelYearMonth,
  updatedBy,
}: {
  fixedCostId: string
  cancelYearMonth: string
  updatedBy: string
}) {
  if (!cancelYearMonth) {
    throw new Error('解約月を入力してください。')
  }

  await updateAccountingFixedCost(fixedCostId, {
    cancelYearMonth,
    endYearMonth: cancelYearMonth,
    status: 'cancelled',
    updatedBy,
    cancelledAt: serverTimestamp(),
  })
}

export async function invalidateAccountingFixedCost({
  fixedCostId,
  updatedBy,
}: {
  fixedCostId: string
  updatedBy: string
}) {
  await updateAccountingFixedCost(fixedCostId, {
    confirmationStatus: '無効',
    status: 'cancelled',
    updatedBy,
  })
}

export { buildEmptyFixedCostInput } from '../utils/accountingFixedCost'
