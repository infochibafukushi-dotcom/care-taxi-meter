import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import type { DocumentData, FieldValue, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { FareBreakdown } from './fare'
import type { ExpenseItem, PaymentMethod, SelectedCareOption } from '../types/case'
import type { CapturedAddressLocation } from '../utils/reverseGeocode'

export type CaseRecordInput = {
  caseNumber: string
  closedAt: string
  startedAt: string
  endedAt: string
  distanceKm: number
  drivingSeconds: number
  fareBreakdown: FareBreakdown
  paymentMethod: PaymentMethod
  pickupLocation: CapturedAddressLocation
  selectedCareOptions: SelectedCareOption[]
  selectedExpenses: ExpenseItem[]
  dropoffLocation: CapturedAddressLocation
}

export type CaseRecordDocument = {
  caseNumber: string
  closedAt: string
  startedAt: string
  endedAt: string
  distanceKm: number
  drivingSeconds: number
  basicFareYen: number
  waitingFareYen: number
  escortFareYen: number
  careOptionFareYen: number
  expenseFareYen: number
  totalFareYen: number
  paymentMethod: string
  pickupLatitude: number | null
  pickupLongitude: number | null
  pickupAddress: string
  pickupCapturedAt: string | null
  dropoffLatitude: number | null
  dropoffLongitude: number | null
  dropoffAddress: string
  dropoffCapturedAt: string | null
  assistCharges: AssistCharge[]
  expenseCharges: ExpenseCharge[]
  savedAt: FieldValue
}

export type AssistCharge = {
  id: string
  name: string
  amount: number
}

export type ExpenseCharge = {
  id: string
  name: string
  amount: number
}

export type StoredCaseRecord = Omit<CaseRecordDocument, 'savedAt'> & {
  id: string
}

const caseRecordsCollectionName = 'caseRecords'

const toNumber = (value: unknown) => (typeof value === 'number' ? value : 0)

const toNullableNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const toString = (value: unknown) => (typeof value === 'string' ? value : '')

const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const toAssistCharges = (value: unknown): AssistCharge[] =>
  Array.isArray(value)
    ? value
        .map((item) => {
          const source = toObject(item)
          const id = typeof source.id === 'string' ? source.id : ''
          const name = typeof source.name === 'string' ? source.name : ''
          const amount = toNumber(source.amount)

          return id && name ? { id, name, amount } : null
        })
        .filter((item): item is AssistCharge => Boolean(item))
    : []


const toExpenseCharges = (value: unknown): ExpenseCharge[] =>
  Array.isArray(value)
    ? value
        .map((item) => {
          const source = toObject(item)
          const id = typeof source.id === 'string' ? source.id : ''
          const name = typeof source.name === 'string' ? source.name : ''
          const amount = toNumber(source.amount)

          return id && name ? { id, name, amount } : null
        })
        .filter((item): item is ExpenseCharge => Boolean(item))
    : []

const toPaymentMethod = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : '未設定'

const toStoredCaseRecord = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
): StoredCaseRecord => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    caseNumber:
      typeof data.caseNumber === 'string' ? data.caseNumber : snapshot.id,
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : '',
    startedAt: toString(data.startedAt),
    endedAt: toString(data.endedAt),
    distanceKm: toNumber(data.distanceKm),
    drivingSeconds: toNumber(data.drivingSeconds),
    basicFareYen: toNumber(data.basicFareYen),
    waitingFareYen: toNumber(data.waitingFareYen),
    escortFareYen: toNumber(data.escortFareYen),
    careOptionFareYen: toNumber(data.careOptionFareYen),
    expenseFareYen: toNumber(data.expenseFareYen),
    totalFareYen: toNumber(data.totalFareYen),
    paymentMethod: toPaymentMethod(data.paymentMethod),
    pickupLatitude: toNullableNumber(data.pickupLatitude),
    pickupLongitude: toNullableNumber(data.pickupLongitude),
    pickupAddress: toString(data.pickupAddress),
    pickupCapturedAt: toString(data.pickupCapturedAt) || null,
    dropoffLatitude: toNullableNumber(data.dropoffLatitude),
    dropoffLongitude: toNullableNumber(data.dropoffLongitude),
    dropoffAddress: toString(data.dropoffAddress),
    dropoffCapturedAt: toString(data.dropoffCapturedAt) || null,
    assistCharges: toAssistCharges(data.assistCharges),
    expenseCharges: toExpenseCharges(data.expenseCharges),
  }
}

function getCaseRecordsCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, caseRecordsCollectionName)
}

export async function saveCaseRecord({
  caseNumber,
  closedAt,
  startedAt,
  endedAt,
  distanceKm,
  drivingSeconds,
  fareBreakdown,
  paymentMethod,
  pickupLocation,
  selectedCareOptions,
  selectedExpenses,
  dropoffLocation,
}: CaseRecordInput) {
  const record: CaseRecordDocument = {
    caseNumber,
    closedAt,
    startedAt,
    endedAt,
    distanceKm: Number(distanceKm.toFixed(3)),
    drivingSeconds: Math.max(Math.floor(drivingSeconds), 0),
    basicFareYen: fareBreakdown.basicFareYen,
    waitingFareYen: fareBreakdown.waitingFareYen,
    escortFareYen: fareBreakdown.escortFareYen,
    careOptionFareYen: fareBreakdown.careOptionFareYen,
    expenseFareYen: fareBreakdown.expenseFareYen,
    totalFareYen: fareBreakdown.totalFareYen,
    paymentMethod,
    pickupLatitude: pickupLocation.latitude,
    pickupLongitude: pickupLocation.longitude,
    pickupAddress: pickupLocation.address,
    pickupCapturedAt: pickupLocation.capturedAt,
    dropoffLatitude: dropoffLocation.latitude,
    dropoffLongitude: dropoffLocation.longitude,
    dropoffAddress: dropoffLocation.address,
    dropoffCapturedAt: dropoffLocation.capturedAt,
    assistCharges: selectedCareOptions.map((careOption) => ({
      id: careOption.masterId,
      name: careOption.name,
      amount: careOption.amountYen,
    })),
    expenseCharges: selectedExpenses.map((expense) => ({
      id: expense.id,
      name: expense.name,
      amount: expense.amountYen,
    })),
    savedAt: serverTimestamp(),
  }

  return addDoc(getCaseRecordsCollection(), record)
}

export async function fetchCaseRecords() {
  const snapshots = await getDocs(
    query(getCaseRecordsCollection(), orderBy('closedAt', 'desc')),
  )

  return snapshots.docs.map(toStoredCaseRecord)
}

export async function fetchCaseRecordsInClosedAtRange({
  endIso,
  startIso,
}: {
  endIso: string
  startIso: string
}) {
  const snapshots = await getDocs(
    query(
      getCaseRecordsCollection(),
      where('closedAt', '>=', startIso),
      where('closedAt', '<', endIso),
      orderBy('closedAt', 'desc'),
    ),
  )

  return snapshots.docs.map(toStoredCaseRecord)
}

export async function fetchCaseRecord(caseRecordId: string) {
  const db = getFirestore(getFirebaseApp())
  const snapshot = await getDoc(
    doc(db, caseRecordsCollectionName, caseRecordId),
  )

  if (!snapshot.exists()) {
    return null
  }

  return toStoredCaseRecord(snapshot)
}
