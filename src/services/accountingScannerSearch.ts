import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StoredAccountingReceipt } from '../types/accounting'
import {
  DEFAULT_SCANNER_RECEIPT_LIST_FILTERS,
  queryScannerReceiptList,
  type ScannerReceiptListFilters,
} from '../utils/accountingScannerSearchQuery'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { toStoredReceipt } from './accountingReceipts'
import { createAccountingTenantConstraints } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'

const collectionName = 'accountingReceipts'
const DEFAULT_LIMIT = 400

/**
 * 税務検索: Firestore でテナント + captureMode + 取引日範囲を絞り、
 * 残条件は縮小結果に対して確定値フィルタする（全件ブラウザ読込は避ける）。
 */
export async function searchAccountingScannerReceipts(input: {
  scope?: TenantAccessScope
  filters?: Partial<ScannerReceiptListFilters>
  maxResults?: number
}): Promise<{
  items: StoredAccountingReceipt[]
  totalCount: number
  activeConditionLabels: string[]
  isFiltered: boolean
  truncated: boolean
  source: 'firestore' | 'receiptId' | 'demo'
}> {
  const filters: ScannerReceiptListFilters = {
    ...DEFAULT_SCANNER_RECEIPT_LIST_FILTERS,
    ...input.filters,
  }
  const maxResults = input.maxResults ?? DEFAULT_LIMIT

  if (isReviewDemoRuntimeEnabled()) {
    return {
      items: [],
      totalCount: 0,
      activeConditionLabels: [],
      isFiltered: false,
      truncated: false,
      source: 'demo',
    }
  }

  const db = getFirestore(getFirebaseApp())

  if (filters.receiptId.trim()) {
    const snap = await getDoc(doc(db, collectionName, filters.receiptId.trim()))
    if (!snap.exists()) {
      return {
        items: [],
        totalCount: 0,
        activeConditionLabels: [`receiptId: ${filters.receiptId.trim()}`],
        isFiltered: true,
        truncated: false,
        source: 'receiptId',
      }
    }
    const receipt = toStoredReceipt(snap)
    const filtered = queryScannerReceiptList({ receipts: [receipt], filters })
    return { ...filtered, truncated: false, source: 'receiptId' }
  }

  const constraints: QueryConstraint[] = [
    ...createAccountingTenantConstraints(input.scope),
    where('captureMode', '==', 'scanner_v1'),
  ]

  if (filters.legalStatus !== 'all') {
    constraints.push(where('legalStatus', '==', filters.legalStatus))
  }

  if (filters.transactionDateFrom) {
    constraints.push(where('transactionDate', '>=', filters.transactionDateFrom))
  }
  if (filters.transactionDateTo) {
    constraints.push(where('transactionDate', '<=', filters.transactionDateTo))
  }

  constraints.push(orderBy('transactionDate', 'desc'))
  constraints.push(limit(maxResults + 1))

  const snap = await getDocs(query(collection(db, collectionName), ...constraints))
  const truncated = snap.docs.length > maxResults
  const docs = truncated ? snap.docs.slice(0, maxResults) : snap.docs
  const receipts = docs.map((item) => toStoredReceipt(item))

  const filtered = queryScannerReceiptList({ receipts, filters })

  return {
    ...filtered,
    truncated,
    source: 'firestore',
  }
}
