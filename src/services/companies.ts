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
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { Company } from '../types/work'
import { defaultFranchiseeId } from './tenancy'

const companiesCollectionName = 'companies'

export const defaultCompany: Company = {
  id: defaultFranchiseeId,
  name: '株式会社千葉福祉サポート',
  corporateName: '株式会社千葉福祉サポート',
  representativeName: '山本信勝',
  area: '千葉県',
  status: 'active',
  plan: 'FC本部',
  monthlyFee: 0,
  initialFee: 0,
  contractStartDate: '',
  contractEndDate: '',
  contractStatus: '契約中',
  billingStatus: '対象外',
  lastBillingMonth: '',
  paymentStatus: '対象外',
  lastLoginAt: '',
  enabled: true,
  sortOrder: 1,
  ownerName: '山本信勝',
  phoneNumber: '',
  postalCode: '',
  invoiceNumber: '',
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

const companyStatuses: Company['status'][] = ['screening', 'preparing', 'active', 'suspended', 'ending', 'terminated', 'archived']

function toCompany(id: string, data: Record<string, unknown>): Company {
  const status = toString(data.status)

  return {
    id,
    name: toString(data.name),
    corporateName: toString(data.corporateName),
    representativeName: toString(data.representativeName) || toString(data.ownerName),
    representativeLoginId: toString(data.representativeLoginId) || toString(data.ownerLoginId),
    representativeInitialPassword: toString(data.representativeInitialPassword) || toString(data.ownerPassword) || toString(data.initialPassword),
    area: toString(data.area),
    status: companyStatuses.includes(status as Company['status']) ? status as Company['status'] : (toBoolean(data.enabled, true) ? 'active' : 'suspended'),
    plan: toString(data.plan) || toString(data.planName),
    monthlyFee: toNumber(data.monthlyFee) || toNumber(data.monthlyPrice),
    initialFee: toNumber(data.initialFee),
    contractStartDate: toString(data.contractStartDate),
    contractEndDate: toString(data.contractEndDate),
    contractStatus: toString(data.contractStatus),
    billingStatus: toString(data.billingStatus),
    lastBillingMonth: toString(data.lastBillingMonth),
    paymentStatus: toString(data.paymentStatus),
    lastLoginAt: toString(data.lastLoginAt),
    enabled: toBoolean(data.enabled, true),
    sortOrder: toNumber(data.sortOrder),
    ownerName: toString(data.ownerName),
    phoneNumber: toString(data.phoneNumber),
    postalCode: toString(data.postalCode) || toString(data.zipCode),
    invoiceNumber: toString(data.invoiceNumber),
    email: toString(data.email),
    address: toString(data.address),
    memo: toString(data.memo),
  }
}

export async function fetchCompanies() {
  const snapshots = await getDocs(query(getCompaniesCollection(), orderBy('sortOrder', 'asc')))

  return snapshots.docs.map((snapshot) => toCompany(snapshot.id, snapshot.data()))
}

export async function fetchCompany(companyId: string) {
  if (!companyId) return null
  const snapshot = await getDoc(getCompanyRef(companyId))
  return snapshot.exists() ? toCompany(snapshot.id, snapshot.data()) : null
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

export async function updateCompanyStatus(company: Company, status: Company['status']) {
  await updateDoc(getCompanyRef(company.id), {
    enabled: status === 'active' || status === 'preparing' || status === 'screening' || status === 'ending',
    status,
    updatedAt: serverTimestamp(),
  })
}

export async function disableCompany(company: Company) {
  await updateCompanyStatus(company, 'suspended')
}

export async function resumeCompany(company: Company) {
  await updateCompanyStatus(company, 'active')
}

export async function archiveCompany(company: Company) {
  await updateCompanyStatus(company, 'terminated')
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
