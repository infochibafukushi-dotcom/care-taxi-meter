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
import type { Company, MeterPermissions, NotificationSettings } from '../types/work'
import { defaultFranchiseeId } from './tenancy'
import {
  isSubscriptionPlan,
  migrateCompanySubscriptionFields,
  resolveMeterPermissions,
  resolveNotificationSettings,
} from './subscriptionPlans'

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

function toMeterPermissions(value: unknown): MeterPermissions | undefined {
  if (!value || typeof value !== 'object') return undefined
  const permissions = value as Record<string, unknown>
  return {
    gps: toBoolean(permissions.gps, true),
    time: toBoolean(permissions.time, true),
    obd: toBoolean(permissions.obd, false),
  }
}

function toNotificationSettings(value: unknown): NotificationSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const settings = value as Record<string, unknown>
  return {
    email: toBoolean(settings.email, true),
    line: toBoolean(settings.line, false),
  }
}

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
    subscriptionPlan: isSubscriptionPlan(data.subscriptionPlan) ? data.subscriptionPlan : undefined,
    plan: toString(data.plan) || toString(data.planName),
    monthlyFee: toNumber(data.monthlyFee) || toNumber(data.monthlyPrice),
    meterPermissions: toMeterPermissions(data.meterPermissions),
    notificationSettings: toNotificationSettings(data.notificationSettings),
    obdAdapterLoanEnabled: typeof data.obdAdapterLoanEnabled === 'boolean' ? data.obdAdapterLoanEnabled : undefined,
    defaultObdModel: toString(data.defaultObdModel),
    defaultPrinterModel: toString(data.defaultPrinterModel),
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
    email: toString(data.email),
    address: toString(data.address),
    memo: toString(data.memo),
  }
}

export async function fetchCompanies() {
  const snapshots = await getDocs(query(getCompaniesCollection(), orderBy('sortOrder', 'asc')))

  return snapshots.docs.map((snapshot) => toCompany(snapshot.id, snapshot.data()))
}

export async function fetchCompanyById(companyId: string) {
  if (!companyId) return null
  const snapshot = await getDoc(getCompanyRef(companyId))
  if (!snapshot.exists()) return null
  return toCompany(snapshot.id, snapshot.data())
}

export async function migrateCompaniesSubscriptionPlans() {
  const companies = await fetchCompanies()
  const migratedCompanies = companies
    .map((company) => migrateCompanySubscriptionFields(company))
    .filter((company): company is Company => company !== null)

  await Promise.all(migratedCompanies.map((company) => saveCompany(company)))
  return migratedCompanies.length
}

export function getCompanyMeterPermissions(company: Company | null | undefined) {
  if (company?.plan === 'FC本部' || company?.id === defaultFranchiseeId) {
    return { gps: true, time: true, obd: true }
  }
  return resolveMeterPermissions(company)
}

export function getCompanyNotificationSettings(company: Company | null | undefined) {
  return resolveNotificationSettings(company)
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
