import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
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

const toStore = (snapshot: QueryDocumentSnapshot<DocumentData>): Store => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    name: toStringValue(data.name) || '名称未設定の店舗',
    enabled: toBooleanValue(data.enabled),
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
}

export async function fetchStores() {
  const snapshots = await getDocs(getStoresCollection())
  return snapshots.docs
    .map(toStore)
    .sort((firstStore, secondStore) => firstStore.name.localeCompare(secondStore.name, 'ja'))
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

export async function ensureDefaultStore() {
  await saveStore(defaultStore)
  return defaultStore
}
