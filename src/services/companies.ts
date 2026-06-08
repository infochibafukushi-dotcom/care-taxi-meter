import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { Company } from '../types/work'
import { defaultFranchiseeId } from './tenancy'

const companiesCollectionName = 'companies'

export const defaultCompany: Company = {
  id: defaultFranchiseeId,
  name: 'FC本部',
  enabled: true,
  sortOrder: 1,
  ownerName: '山本信勝',
  phoneNumber: '',
  email: '',
  address: '',
  memo: '',
}

const toString = (value: unknown) => (typeof value === 'string' ? value : '')
const toBoolean = (value: unknown, fallback = false) =>
  typeof value === 'boolean' ? value : fallback
const toNumber = (value: unknown) => (typeof value === 'number' ? value : 0)

function getCompaniesCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, companiesCollectionName)
}

function getCompanyRef(companyId: string) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, companiesCollectionName, companyId)
}

export async function fetchCompanies() {
  const snapshots = await getDocs(query(getCompaniesCollection(), orderBy('sortOrder', 'asc')))

  return snapshots.docs.map((snapshot): Company => {
    const data = snapshot.data()

    return {
      id: snapshot.id,
      name: toString(data.name),
      enabled: toBoolean(data.enabled, true),
      sortOrder: toNumber(data.sortOrder),
      ownerName: toString(data.ownerName),
      phoneNumber: toString(data.phoneNumber),
      email: toString(data.email),
      address: toString(data.address),
      memo: toString(data.memo),
    }
  })
}

export async function saveCompany(company: Company) {
  await setDoc(
    getCompanyRef(company.id),
    {
      ...company,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function disableCompany(company: Company) {
  await updateDoc(getCompanyRef(company.id), {
    enabled: false,
    updatedAt: serverTimestamp(),
  })
}

export async function ensureDefaultCompany() {
  const companies = await fetchCompanies()
  const existingDefaultCompany = companies.find((company) => company.id === defaultCompany.id)

  if (!existingDefaultCompany) {
    await saveCompany(defaultCompany)
    return defaultCompany
  }

  return existingDefaultCompany
}
