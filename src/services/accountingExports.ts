import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { AccountingExportInput, StoredAccountingExport } from '../types/accounting'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { createAccountingTenantConstraints } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { getDocs, orderBy, query } from 'firebase/firestore'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingExports'

export async function recordAccountingExport(input: AccountingExportInput) {
  if (isReviewDemoRuntimeEnabled()) {
    return 'review-demo-export'
  }

  const db = getFirestore(getFirebaseApp())
  const document = await addDoc(collection(db, collectionName), {
    ...input,
    createdAt: serverTimestamp(),
  })

  return document.id
}

export async function fetchAccountingExports(scope?: TenantAccessScope) {
  if (isReviewDemoRuntimeEnabled()) {
    return [] as StoredAccountingExport[]
  }

  const db = getFirestore(getFirebaseApp())
  const snapshots = await getDocs(
    query(
      collection(db, collectionName),
      ...createAccountingTenantConstraints(scope),
      orderBy('createdAt', 'desc'),
    ),
  )

  return snapshots.docs.map((snapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      franchiseeId: String(data.franchiseeId ?? data.companyId ?? ''),
      companyId: String(data.companyId ?? data.franchiseeId ?? ''),
      storeId: String(data.storeId ?? ''),
      exportType: data.exportType as StoredAccountingExport['exportType'],
      targetYearMonth: String(data.targetYearMonth ?? ''),
      fileName: String(data.fileName ?? ''),
      rowCount: Number(data.rowCount ?? 0),
      createdBy: String(data.createdBy ?? ''),
      createdByName: String(data.createdByName ?? ''),
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    } satisfies StoredAccountingExport
  }).filter((entry) => matchesTenantScope(entry, scope))
}
