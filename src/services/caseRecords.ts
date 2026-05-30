import {
  addDoc,
  collection,
  getFirestore,
  serverTimestamp,
} from 'firebase/firestore'
import type { FieldValue } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { FareBreakdown } from './fare'
import type { PaymentMethod } from '../types/case'

export type CaseRecordInput = {
  caseNumber: string
  closedAt: string
  distanceKm: number
  fareBreakdown: FareBreakdown
  paymentMethod: PaymentMethod
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
  savedAt: FieldValue
}

const caseRecordsCollectionName = 'caseRecords'

export async function saveCaseRecord({
  caseNumber,
  closedAt,
  distanceKm,
  fareBreakdown,
  paymentMethod,
}: CaseRecordInput) {
  const db = getFirestore(getFirebaseApp())
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
    savedAt: serverTimestamp(),
  }

  return addDoc(collection(db, caseRecordsCollectionName), record)
}
