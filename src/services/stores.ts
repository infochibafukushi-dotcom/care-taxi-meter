import {
  collection,
  doc,
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

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const toStore = (snapshot: QueryDocumentSnapshot<DocumentData>): Store => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    name: toStringValue(data.name) || '名称未設定の店舗',
    enabled: toBooleanValue(data.enabled),
    sortOrder: toNumberValue(data.sortOrder),
    tenantId: toStringValue(data.tenantId),
    organizationId: toStringValue(data.organizationId),
  }
}

function getStoresCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, storesCollectionName)
}

export const defaultStore: Store = {
  id: 'store_chiba_chuo',
  name: '千葉中央店',
  enabled: true,
  sortOrder: 1,
  tenantId: '',
  organizationId: '',
}

export async function fetchStores() {
  const snapshots = await getDocs(query(getStoresCollection(), orderBy('sortOrder', 'asc')))
  return snapshots.docs.map(toStore)
}

export async function saveStore(store: Store) {
  const db = getFirestore(getFirebaseApp())
  const document = {
    ...store,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  await setDoc(doc(db, storesCollectionName, store.id), document, { merge: true })
  return store
}

export async function ensureDefaultStore() {
  await saveStore(defaultStore)
  return defaultStore
}
