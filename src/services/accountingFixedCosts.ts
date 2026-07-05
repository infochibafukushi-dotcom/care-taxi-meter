import { collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StoredAccountingFixedCost } from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAccountingTenantConstraints } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingFixedCosts'

export async function fetchAccountingFixedCosts(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as StoredAccountingFixedCost[]
  }

  const db = getFirestore(getFirebaseApp())
  const snapshots = await getDocs(
    query(
      collection(db, collectionName),
      ...createAccountingTenantConstraints(scope),
      orderBy('startYearMonth', 'desc'),
    ),
  )

  return snapshots.docs.map((snapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
      companyId: String(data.companyId ?? data.franchiseeId ?? ''),
      storeId: String(data.storeId ?? ''),
      name: String(data.name ?? ''),
      expenseCategory: data.expenseCategory as StoredAccountingFixedCost['expenseCategory'],
      monthlyAmountYen: Number(data.monthlyAmountYen ?? 0),
      startYearMonth: String(data.startYearMonth ?? ''),
      endYearMonth: typeof data.endYearMonth === 'string' ? data.endYearMonth : undefined,
      memo: typeof data.memo === 'string' ? data.memo : '',
      confirmationStatus: data.confirmationStatus as StoredAccountingFixedCost['confirmationStatus'],
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    } satisfies StoredAccountingFixedCost
  }).filter((entry) => matchesTenantScope(entry, scope))
}
