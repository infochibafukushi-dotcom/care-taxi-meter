import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  where,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import type { DocumentData, FieldValue, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { FareBreakdown } from './fare'
import type { ExpenseItem, PaymentMethod, SelectedCareOption } from '../types/case'
import type { CurrentWorkSession, StaffRole, Vehicle } from '../types/work'
import type { CapturedAddressLocation } from '../utils/reverseGeocode'

export type CaseRecordInput = {
  caseNumber: string
  closedAt: string
  startedAt: string
  endedAt: string
  distanceKm: number
  drivingSeconds: number
  waitingSeconds?: number
  accompanyingSeconds?: number
  workSession?: CurrentWorkSession | null
  vehicle?: Vehicle | null
  fareBreakdown: FareBreakdown
  paymentMethod: PaymentMethod
  pickupLocation: CapturedAddressLocation
  selectedCareOptions: SelectedCareOption[]
  selectedDispatchCharges?: SelectedCareOption[]
  selectedSpecialVehicleCharges?: SelectedCareOption[]
  selectedExpenses: ExpenseItem[]
  dropoffLocation: CapturedAddressLocation
}

export type CaseRecordStatus = 'completed' | 'canceled'

export type CaseRecordChangeEntry = {
  changedAt: string
  fieldLabel: string
  previousValue: string
  nextValue: string
}

export type CaseRecordDocument = {
  caseNumber: string
  caseDate?: string
  closedAt: string
  startedAt: string
  endedAt: string
  distanceKm: number
  drivingSeconds: number
  waitingSeconds: number
  accompanyingSeconds: number
  companyId: string
  companyName: string
  staffId: string
  staffName: string
  staffRole: StaffRole | ''
  vehicleId: string
  vehicleName: string
  vehicleNumber: string
  workSessionId: string
  storeId: string
  storeName: string
  dispatchFareYen: number
  specialVehicleFareYen: number
  basicFareYen: number
  waitingFareYen: number
  escortFareYen: number
  careOptionFareYen: number
  expenseFareYen: number
  totalFareYen: number
  paymentMethod: string
  customerName: string
  remarks: string
  status: CaseRecordStatus
  canceledAt: string
  changeHistory: CaseRecordChangeEntry[]
  pickupLatitude: number | null
  pickupLongitude: number | null
  pickupAddress: string
  pickupCapturedAt: string | null
  dropoffLatitude: number | null
  dropoffLongitude: number | null
  dropoffAddress: string
  dropoffCapturedAt: string | null
  assistCharges: AssistCharge[]
  dispatchCharges: AssistCharge[]
  specialVehicleCharges: AssistCharge[]
  expenseCharges: ExpenseCharge[]
  createdAt?: FieldValue
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

export type StoredCaseRecord = Omit<CaseRecordDocument, 'createdAt' | 'savedAt'> & {
  createdAt?: string
  id: string
}

export type CaseRecordEditableValues = {
  careOptionFareYen: number
  dispatchFareYen: number
  expenseFareYen: number
  paymentMethod: string
  remarks: string
}

const caseRecordsCollectionName = 'caseRecords'

const dateInputFormatter = new Intl.DateTimeFormat('sv-SE', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
})

const toNumber = (value: unknown) => (typeof value === 'number' ? value : 0)

const toNullableNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const toString = (value: unknown) => (typeof value === 'string' ? value : '')

const toIsoString = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && 'toDate' in value) {
    const timestampDate = (value as { toDate: () => Date }).toDate()
    return Number.isNaN(timestampDate.getTime()) ? '' : timestampDate.toISOString()
  }

  return ''
}

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


const toChangeHistory = (value: unknown): CaseRecordChangeEntry[] =>
  Array.isArray(value)
    ? value
        .map((item) => {
          const source = toObject(item)
          const changedAt = toString(source.changedAt)
          const fieldLabel = toString(source.fieldLabel)
          const previousValue = toString(source.previousValue)
          const nextValue = toString(source.nextValue)

          return changedAt && fieldLabel
            ? { changedAt, fieldLabel, previousValue, nextValue }
            : null
        })
        .filter((item): item is CaseRecordChangeEntry => Boolean(item))
    : []

const toCaseRecordStatus = (value: unknown): CaseRecordStatus =>
  value === 'canceled' ? 'canceled' : 'completed'

const toPaymentMethod = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : '未設定'

const toJapanDateInputValue = (dateValue: string) => {
  const date = new Date(dateValue)
  return Number.isNaN(date.getTime()) ? '' : dateInputFormatter.format(date)
}

const toStoredCaseRecord = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
): StoredCaseRecord => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    caseNumber:
      typeof data.caseNumber === 'string' ? data.caseNumber : snapshot.id,
    caseDate: toString(data.caseDate),
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : '',
    createdAt: toIsoString(data.createdAt) || toIsoString(data.savedAt),
    startedAt: toString(data.startedAt),
    endedAt: toString(data.endedAt),
    distanceKm: toNumber(data.distanceKm),
    drivingSeconds: toNumber(data.drivingSeconds),
    waitingSeconds: toNumber(data.waitingSeconds),
    accompanyingSeconds: toNumber(data.accompanyingSeconds),
    companyId: toString(data.companyId),
    companyName: toString(data.companyName),
    staffId: toString(data.staffId),
    staffName: toString(data.staffName),
    staffRole: toString(data.staffRole) as StaffRole | '',
    vehicleId: toString(data.vehicleId),
    vehicleName: toString(data.vehicleName),
    vehicleNumber: toString(data.vehicleNumber),
    workSessionId: toString(data.workSessionId),
    storeId: toString(data.storeId),
    storeName: toString(data.storeName),
    dispatchFareYen: toNumber(data.dispatchFareYen),
    specialVehicleFareYen: toNumber(data.specialVehicleFareYen),
    basicFareYen: toNumber(data.basicFareYen),
    waitingFareYen: toNumber(data.waitingFareYen),
    escortFareYen: toNumber(data.escortFareYen),
    careOptionFareYen: toNumber(data.careOptionFareYen),
    expenseFareYen: toNumber(data.expenseFareYen),
    totalFareYen: toNumber(data.totalFareYen),
    paymentMethod: toPaymentMethod(data.paymentMethod),
    customerName: toString(data.customerName),
    remarks: toString(data.remarks),
    status: toCaseRecordStatus(data.status),
    canceledAt: toString(data.canceledAt),
    changeHistory: toChangeHistory(data.changeHistory),
    pickupLatitude: toNullableNumber(data.pickupLatitude),
    pickupLongitude: toNullableNumber(data.pickupLongitude),
    pickupAddress: toString(data.pickupAddress),
    pickupCapturedAt: toString(data.pickupCapturedAt) || null,
    dropoffLatitude: toNullableNumber(data.dropoffLatitude),
    dropoffLongitude: toNullableNumber(data.dropoffLongitude),
    dropoffAddress: toString(data.dropoffAddress),
    dropoffCapturedAt: toString(data.dropoffCapturedAt) || null,
    assistCharges: toAssistCharges(data.assistCharges),
    dispatchCharges: toAssistCharges(data.dispatchCharges),
    specialVehicleCharges: toAssistCharges(data.specialVehicleCharges),
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
  waitingSeconds = 0,
  accompanyingSeconds = 0,
  workSession = null,
  vehicle = null,
  fareBreakdown,
  paymentMethod,
  pickupLocation,
  selectedCareOptions,
  selectedDispatchCharges = [],
  selectedSpecialVehicleCharges = [],
  selectedExpenses,
  dropoffLocation,
}: CaseRecordInput) {
  const record: CaseRecordDocument = {
    caseNumber,
    caseDate: toJapanDateInputValue(closedAt),
    closedAt,
    startedAt,
    endedAt,
    distanceKm: Number(distanceKm.toFixed(3)),
    drivingSeconds: Math.max(Math.floor(drivingSeconds), 0),
    waitingSeconds: Math.max(Math.floor(waitingSeconds), 0),
    accompanyingSeconds: Math.max(Math.floor(accompanyingSeconds), 0),
    companyId: workSession?.companyId ?? '',
    companyName: workSession?.companyName ?? '',
    staffId: workSession?.staffId ?? '',
    staffName: workSession?.staffName ?? '',
    staffRole: workSession?.staffRole ?? '',
    vehicleId: vehicle?.id ?? '',
    vehicleName: vehicle?.name ?? '',
    vehicleNumber: vehicle?.number ?? '',
    workSessionId: workSession?.id ?? '',
    storeId: workSession?.storeId ?? '',
    storeName: workSession?.storeName ?? '',
    dispatchFareYen: fareBreakdown.dispatchFareYen,
    specialVehicleFareYen: fareBreakdown.specialVehicleFareYen,
    basicFareYen: fareBreakdown.basicFareYen,
    waitingFareYen: fareBreakdown.waitingFareYen,
    escortFareYen: fareBreakdown.escortFareYen,
    careOptionFareYen: fareBreakdown.careOptionFareYen,
    expenseFareYen: fareBreakdown.expenseFareYen,
    totalFareYen: fareBreakdown.totalFareYen,
    paymentMethod,
    customerName: '',
    remarks: '',
    status: 'completed',
    canceledAt: '',
    changeHistory: [],
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
    dispatchCharges: selectedDispatchCharges.map((dispatchCharge) => ({
      id: dispatchCharge.masterId,
      name: dispatchCharge.name,
      amount: dispatchCharge.amountYen,
    })),
    specialVehicleCharges: selectedSpecialVehicleCharges.map((specialVehicleCharge) => ({
      id: specialVehicleCharge.masterId,
      name: specialVehicleCharge.name,
      amount: specialVehicleCharge.amountYen,
    })),
    expenseCharges: selectedExpenses.map((expense) => ({
      id: expense.id,
      name: expense.name,
      amount: expense.amountYen,
    })),
    createdAt: serverTimestamp(),
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

const formatYenForHistory = (value: number) => `${Math.round(value).toLocaleString('ja-JP')}円`

const editableFieldDefinitions: Array<{
  key: keyof CaseRecordEditableValues
  label: string
  format: (value: string | number) => string
}> = [
  { key: 'careOptionFareYen', label: '介助料金', format: (value) => formatYenForHistory(Number(value)) },
  { key: 'dispatchFareYen', label: '予約迎車料金', format: (value) => formatYenForHistory(Number(value)) },
  { key: 'expenseFareYen', label: '実費', format: (value) => formatYenForHistory(Number(value)) },
  { key: 'paymentMethod', label: '支払方法', format: (value) => String(value || '未設定') },
  { key: 'remarks', label: '備考', format: (value) => String(value || '未設定') },
]

const toEditableValues = (caseRecord: StoredCaseRecord): CaseRecordEditableValues => ({
  careOptionFareYen: caseRecord.careOptionFareYen,
  dispatchFareYen: caseRecord.dispatchFareYen,
  expenseFareYen: caseRecord.expenseFareYen,
  paymentMethod: caseRecord.paymentMethod,
  remarks: caseRecord.remarks,
})

const normalizeEditableValues = (values: CaseRecordEditableValues): CaseRecordEditableValues => ({
  careOptionFareYen: Math.max(Math.round(values.careOptionFareYen), 0),
  dispatchFareYen: Math.max(Math.round(values.dispatchFareYen), 0),
  expenseFareYen: Math.max(Math.round(values.expenseFareYen), 0),
  paymentMethod: values.paymentMethod.trim() || '未設定',
  remarks: values.remarks.trim(),
})

const calculateEditableFareYen = (values: Pick<
  CaseRecordEditableValues,
  'careOptionFareYen' | 'dispatchFareYen' | 'expenseFareYen'
>) => values.careOptionFareYen + values.dispatchFareYen + values.expenseFareYen

const calculateTotalFareYen = (
  caseRecord: StoredCaseRecord,
  values: CaseRecordEditableValues,
) => {
  const currentEditableFareYen = calculateEditableFareYen(toEditableValues(caseRecord))
  const fixedFareYen = Math.max(caseRecord.totalFareYen - currentEditableFareYen, 0)
  return fixedFareYen + calculateEditableFareYen(values)
}

export async function updateCaseRecordEditableValues(
  caseRecord: StoredCaseRecord,
  values: CaseRecordEditableValues,
) {
  const normalizedValues = normalizeEditableValues(values)
  const previousValues = toEditableValues(caseRecord)
  const changedAt = new Date().toISOString()
  const changeEntries = editableFieldDefinitions.flatMap((field) => {
    const previousValue = previousValues[field.key]
    const nextValue = normalizedValues[field.key]

    if (previousValue === nextValue) {
      return []
    }

    return [{
      changedAt,
      fieldLabel: field.label,
      previousValue: field.format(previousValue),
      nextValue: field.format(nextValue),
    }]
  })

  if (changeEntries.length === 0) {
    return caseRecord
  }

  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    ...normalizedValues,
    totalFareYen: calculateTotalFareYen(caseRecord, normalizedValues),
    changeHistory: [...(caseRecord.changeHistory ?? []), ...changeEntries],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    ...normalizedValues,
    totalFareYen: updatedRecord.totalFareYen,
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  return updatedRecord
}

export async function cancelCaseRecord(caseRecord: StoredCaseRecord) {
  const canceledAt = new Date().toISOString()
  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    canceledAt,
    status: 'canceled',
    changeHistory: [
      ...(caseRecord.changeHistory ?? []),
      {
        changedAt: canceledAt,
        fieldLabel: 'ステータス',
        previousValue: caseRecord.status === 'canceled' ? 'キャンセル済' : '通常',
        nextValue: 'キャンセル済',
      },
    ],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    canceledAt,
    status: 'canceled',
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  return updatedRecord
}

export async function deleteCaseRecordPermanently(caseRecordId: string) {
  await deleteDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecordId))
}

