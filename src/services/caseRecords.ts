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
import type { PaymentMethod, SelectedCareOption } from '../types/case'

export type CaseRecordInput = {
  caseNumber: string
  closedAt: string
  distanceKm: number
  fareBreakdown: FareBreakdown
  paymentMethod: PaymentMethod
  selectedCareOptions: SelectedCareOption[]
}

export type CaseRecordDocument = {
  caseNumber: string
  closedAt: string
  distanceKm: number
  basicFareYen: number
  waitingFareYen: number
  escortFareYen: number
  careOptionFareYen: number
  expenseFareYen: number
  totalFareYen: number
  paymentMethod: PaymentMethod
  assistCharges: AssistCharge[]
  savedAt: FieldValue
}

export type AssistCharge = {
  id: string
  name: string
  amount: number
}

export type StoredCaseRecord = Omit<CaseRecordDocument, 'savedAt'> & {
  id: string
}

const caseRecordsCollectionName = 'caseRecords'

const toNumber = (value: unknown) => (typeof value === 'number' ? value : 0)

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

const toPaymentMethod = (value: unknown): PaymentMethod => {
  if (
    value === '現金' ||
    value === 'クレジット' ||
    value === 'QR決済' ||
    value === 'その他'
  ) {
    return value
  }

  return 'その他'
}

const toStoredCaseRecord = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
): StoredCaseRecord => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    caseNumber:
      typeof data.caseNumber === 'string' ? data.caseNumber : snapshot.id,
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : '',
    distanceKm: toNumber(data.distanceKm),
    basicFareYen: toNumber(data.basicFareYen),
    waitingFareYen: toNumber(data.waitingFareYen),
    escortFareYen: toNumber(data.escortFareYen),
    careOptionFareYen: toNumber(data.careOptionFareYen),
    expenseFareYen: toNumber(data.expenseFareYen),
    totalFareYen: toNumber(data.totalFareYen),
    paymentMethod: toPaymentMethod(data.paymentMethod),
    assistCharges: toAssistCharges(data.assistCharges),
  }
}

function getCaseRecordsCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, caseRecordsCollectionName)
}

export async function saveCaseRecord({
  caseNumber,
  closedAt,
  distanceKm,
  fareBreakdown,
  paymentMethod,
  selectedCareOptions,
}: CaseRecordInput) {
  const record: CaseRecordDocument = {
    caseNumber,
    closedAt,
    distanceKm: Number(distanceKm.toFixed(3)),
    basicFareYen: fareBreakdown.basicFareYen,
    waitingFareYen: fareBreakdown.waitingFareYen,
    escortFareYen: fareBreakdown.escortFareYen,
    careOptionFareYen: fareBreakdown.careOptionFareYen,
    expenseFareYen: fareBreakdown.expenseFareYen,
    totalFareYen: fareBreakdown.totalFareYen,
    paymentMethod,
    assistCharges: selectedCareOptions.map((careOption) => ({
      id: careOption.masterId,
      name: careOption.name,
      amount: careOption.amountYen,
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
