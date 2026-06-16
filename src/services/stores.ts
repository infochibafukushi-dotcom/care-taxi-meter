import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { Store } from '../types/work'
import { defaultFranchiseeId, defaultStoreId, defaultStoreName, getFranchiseeId } from './tenancy'

const storesCollectionName = 'stores'
export const defaultCompanyId = defaultFranchiseeId

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const toStore = (snapshot: QueryDocumentSnapshot<DocumentData>): Store => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    companyId: getFranchiseeId(data),
    franchiseeId: getFranchiseeId(data),
    name: toStringValue(data.name) || toStringValue(data.storeName) || '名称未設定の店舗',
    storeName: toStringValue(data.storeName) || toStringValue(data.name),
    companyName: toStringValue(data.companyName),
    ownerName: toStringValue(data.ownerName),
    address: toStringValue(data.address),
    phoneNumber: toStringValue(data.phoneNumber),
    email: toStringValue(data.email),
    invoiceNumber: toStringValue(data.invoiceNumber),
    planId: toStringValue(data.planId),
    planName: toStringValue(data.planName),
    monthlyPrice: toNumberValue(data.monthlyPrice),
    status: data.status === 'suspended' || data.status === 'archived' ? data.status : 'active',
    enabled: toBooleanValue(data.enabled, data.status !== 'suspended' && data.status !== 'archived'),
    isActive: toBooleanValue(data.isActive, data.status !== 'suspended' && data.status !== 'archived'),
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
  franchiseeId: defaultCompanyId,
  name: '株式会社千葉福祉サポート',
  status: 'active',
  enabled: true,
  isActive: true,
  sortOrder: 0,
}

export const defaultStore: Store = {
  id: defaultStoreId,
  companyId: defaultCompanyId,
  franchiseeId: defaultCompanyId,
  name: defaultStoreName,
  status: 'active',
  enabled: true,
  isActive: true,
  sortOrder: 1,
}

export async function fetchStores(companyId?: string) {
  const constraints: QueryConstraint[] = []

  if (companyId) {
    constraints.push(where('franchiseeId', '==', companyId))
  }

  constraints.push(orderBy('sortOrder', 'asc'))

  const snapshots = await getDocs(query(getStoresCollection(), ...constraints))
  return snapshots.docs
    .map(toStore)
    .filter((store) => !companyId || store.franchiseeId === companyId || store.companyId === companyId)
}

export async function saveStore(store: Store) {
  const db = getFirestore(getFirebaseApp())
  const storeRef = doc(db, storesCollectionName, store.id)
  const snapshot = await getDoc(storeRef)
  const document = {
    ...store,
    companyId: store.franchiseeId || store.companyId,
    franchiseeId: store.franchiseeId || store.companyId,
    ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  await setDoc(storeRef, document, { merge: true })
  return store
}

export async function ensureDefaultStore(companyId = defaultCompanyId) {
  const store = { ...defaultStore, companyId, franchiseeId: companyId }
  await saveStore(store)
  return store
}

export async function ensureHeadquartersStore(companyId = defaultCompanyId) {
  const store = { ...headquartersStore, companyId, franchiseeId: companyId }
  await saveStore(store)
  return store
}
