import { addDoc, collection, getFirestore } from 'firebase/firestore'
import { firebaseApp } from '../lib/firebase'
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
}

const db = getFirestore(firebaseApp)
const caseRecordsCollectionName = 'caseRecords'

export async function saveCaseRecord({
  caseNumber,
  closedAt,
  distanceKm,
  fareBreakdown,
  paymentMethod,
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
  }

  return addDoc(collection(db, caseRecordsCollectionName), record)
}
