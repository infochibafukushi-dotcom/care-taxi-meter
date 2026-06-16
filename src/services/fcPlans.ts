import { collection, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import type { FieldValue } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'

export type FcPlan = {
  id: string
  name: string
  monthlyPrice: number
  description: string
  includedServices: string[]
  adBudgetAmount?: number
  lpEditLimitPerMonth?: number | null
  storeLimit?: number | null
  isActive: boolean
  createdAt?: FieldValue
  updatedAt?: FieldValue
}

const fcPlansCollectionName = 'fcPlans'

const defaultFcPlans: FcPlan[] = [
  {
    id: 'plan-lp-app',
    name: 'プラン1',
    monthlyPrice: 9800,
    description: 'LP＋アプリ',
    includedServices: ['LP', 'アプリ'],
    storeLimit: null,
    isActive: true,
  },
  {
    id: 'plan-reservation-line',
    name: 'プラン2',
    monthlyPrice: 16800,
    description: '予約システム・LINE通知・LP盤面変更 月5回まで',
    includedServices: ['LP', 'アプリ', '予約システム', 'LINE通知'],
    lpEditLimitPerMonth: 5,
    storeLimit: null,
    isActive: true,
  },
  {
    id: 'plan-growth',
    name: 'プラン3',
    monthlyPrice: 39800,
    description: '広告15,000円分・流入分析・CV分析・LP改善アドバイス',
    includedServices: ['LP', 'アプリ', '予約システム', 'LINE通知', 'リスティング広告', 'LP流入分析', 'CV分析'],
    adBudgetAmount: 15000,
    lpEditLimitPerMonth: 5,
    storeLimit: null,
    isActive: true,
  },
]

const toString = (value: unknown) => (typeof value === 'string' ? value : '')
const toNumber = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const toNullableNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const toBoolean = (value: unknown, fallback = true) => (typeof value === 'boolean' ? value : fallback)

function getPlanRef(planId: string) {
  const db = getFirestore(getFirebaseApp())
  return doc(db, fcPlansCollectionName, planId)
}

function toFcPlan(snapshot: { id: string; data: () => Record<string, unknown> }): FcPlan {
  const data = snapshot.data()
  return {
    id: toString(data.id) || snapshot.id,
    name: toString(data.name),
    monthlyPrice: toNumber(data.monthlyPrice),
    description: toString(data.description),
    includedServices: Array.isArray(data.includedServices) ? data.includedServices.filter((item): item is string => typeof item === 'string') : [],
    adBudgetAmount: toNullableNumber(data.adBudgetAmount) ?? undefined,
    lpEditLimitPerMonth: toNullableNumber(data.lpEditLimitPerMonth),
    storeLimit: toNullableNumber(data.storeLimit),
    isActive: toBoolean(data.isActive),
  }
}

export async function fetchFcPlans() {
  const db = getFirestore(getFirebaseApp())
  const snapshots = await getDocs(query(collection(db, fcPlansCollectionName), orderBy('monthlyPrice', 'asc')))
  return snapshots.docs.map(toFcPlan)
}

export async function saveFcPlan(plan: FcPlan) {
  await setDoc(getPlanRef(plan.id), { ...plan, updatedAt: serverTimestamp() }, { merge: true })
  return plan
}

export async function ensureDefaultFcPlans() {
  const plans = await fetchFcPlans()
  if (plans.length > 0) return plans
  await Promise.all(defaultFcPlans.map((plan) => setDoc(getPlanRef(plan.id), { ...plan, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true })))
  return defaultFcPlans
}
