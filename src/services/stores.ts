import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { Store } from '../types/work'

const storesCollectionName = 'stores'
export const defaultCompanyId = 'chiba-care-taxi'

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const toStore = (snapshot: QueryDocumentSnapshot<DocumentData>): Store => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    companyId: toStringValue(data.companyId) || defaultCompanyId,
    name: toStringValue(data.name) || '名称未設定の店舗',
    enabled: toBooleanValue(data.enabled),
    sortOrder: toNumberValue(data.sortOrder, 1),
  }
}

function getStoresCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, storesCollectionName)
}

export const headquartersStore: Store = {
  id: 'store_fc_headquarters',
  companyId: defaultCompanyId,
  name: 'FC本部',
  enabled: true,
  sortOrder: 0,
}

export const defaultStore: Store = {
  id: 'store_chiba_chuo',
  companyId: defaultCompanyId,
  name: '千葉中央店',
  enabled: true,
  sortOrder: 1,
}

export async function fetchStores(companyId?: string) {
  const snapshots = await getDocs(query(getStoresCollection(), orderBy('sortOrder', 'asc')))
  return snapshots.docs
    .map(toStore)
    .filter((store) => !companyId || store.companyId === companyId)
}

export async function saveStore(store: Store) {
  const db = getFirestore(getFirebaseApp())
  const storeRef = doc(db, storesCollectionName, store.id)
  const snapshot = await getDoc(storeRef)
  const document = {
    ...store,
    ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  await setDoc(storeRef, document, { merge: true })
  return store
}

export async function ensureDefaultStore(companyId = defaultCompanyId) {
  const store = { ...defaultStore, companyId }
  await saveStore(store)
  return store
}

export async function ensureHeadquartersStore(companyId = defaultCompanyId) {
  const store = { ...headquartersStore, companyId }
  await saveStore(store)
  return store
}
