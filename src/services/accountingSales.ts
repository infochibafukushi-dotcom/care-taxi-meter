import { addDoc, collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StoredAccountingSalesEntry } from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAccountingTenantConstraints } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingSales'

export async function fetchAccountingSalesEntries(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as StoredAccountingSalesEntry[]
  }

  const db = getFirestore(getFirebaseApp())
  const snapshots = await getDocs(
    query(
      collection(db, collectionName),
      ...createAccountingTenantConstraints(scope),
      orderBy('targetYearMonth', 'desc'),
    ),
  )

  return snapshots.docs.map((snapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
      companyId: String(data.companyId ?? data.franchiseeId ?? ''),
      storeId: String(data.storeId ?? ''),
      sourceCaseRecordId: typeof data.sourceCaseRecordId === 'string' ? data.sourceCaseRecordId : undefined,
      targetYearMonth: String(data.targetYearMonth ?? ''),
      salesCategory: data.salesCategory as StoredAccountingSalesEntry['salesCategory'],
      amountYen: Number(data.amountYen ?? 0),
      description: String(data.description ?? ''),
      isManualEntry: Boolean(data.isManualEntry),
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    } satisfies StoredAccountingSalesEntry
  }).filter((entry) => matchesTenantScope(entry, scope))
}

export async function createAccountingSalesEntry(
  input: Omit<StoredAccountingSalesEntry, 'id' | 'createdAt'>,
) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-sales-entry'
  }

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(collection(db, collectionName), input)
  return document.id
}
