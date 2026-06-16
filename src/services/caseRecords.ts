import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  runTransaction,
  where,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import type { DocumentData, FieldValue, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { BasicFareSettings, CareOptionMasterItem, DispatchMenuItem, FareBreakdown, MeterTimeFareSettings, SpecialVehicleMenuItem, TimeFareSettings } from './fare'
import type { ExpenseItem, PaymentAllocation, PaymentMethod, SelectedCareOption, TaxiTicket } from '../types/case'
import type { CurrentWorkSession, StaffRole, Vehicle } from '../types/work'
import type { CapturedAddressLocation } from '../utils/reverseGeocode'
import type { ExpensePreset } from './meterSettings'
import { createAuditLog } from './auditLogs'
import type { AuditActor } from './auditLogs'
import { defaultStoreId, getFranchiseeId, getStoreId, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'

export type CaseRecordInput = {
  caseNumber: string
  caseDate?: string
  storeCode?: string
  dailySequence?: number
  fareSnapshot?: FareSnapshot | null
  closedAt: string
  startedAt: string
  endedAt: string
  distanceKm: number
  chargeableDistanceKm: number
  businessDistanceKm: number
  drivingSeconds: number
  waitingSeconds?: number
  accompanyingSeconds?: number
  workSession?: CurrentWorkSession | null
  vehicle?: Vehicle | null
  fareBreakdown: FareBreakdown
  paymentMethod: PaymentMethod
  payments?: PaymentAllocation[]
  receiptName?: string
  taxiTickets?: TaxiTicket[]
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

export type ReceiptReissueEntry = {
  reissuedAt: string
  reissuedBy: string
  reason: string
}

export type SettlementAdjustmentEntry = {
  adjustedAt: string
  adjustedBy: string
  reason: string
  previousTotalFareYen: number
  adjustedTotalFareYen: number
  differenceYen: number
  refundYen: number
  receiptName: string
  taxiTickets: TaxiTicket[]
}

export type FareSnapshot = {
  basicFare: BasicFareSettings
  meterTimeFare: MeterTimeFareSettings
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  midnightEarlyMorning: {
    enabled: boolean
    startTime: string
    endTime: string
    surchargeRate: number
    appliesTo: string[]
  }
  timeSpecificFare: {
    enabled: boolean
    fixedFareYen: number
    timeBands: Array<{ startTime: string; endTime: string; fareYen: number }>
  }
  disabilityDiscount: {
    enabled: boolean
    discountRate: number
    appliesTo: string[]
    rounding: 'floorToTenYen'
  }
  taxiVoucher: {
    multipleAllowed: boolean
    storesVoucherNumber: boolean
    storesMunicipalityName: boolean
  }
  dispatchMenuItems: DispatchMenuItem[]
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
  assistItems: CareOptionMasterItem[]
  expensePresets: Array<ExpensePreset & { amount: number; enabled: boolean; sortOrder: number }>
  capturedAt: string
}

export type CaseNumberAssignment = {
  caseNumber: string
  caseDate: string
  dailySequence: number
  storeCode: string
}

export type CaseRecordDocument = {
  caseNumber: string
  caseDate?: string
  storeCode: string
  dailySequence: number
  fareSnapshot?: FareSnapshot | null
  closedAt: string
  startedAt: string
  endedAt: string
  distanceKm: number
  chargeableDistanceKm: number
  businessDistanceKm: number
  drivingSeconds: number
  waitingSeconds: number
  accompanyingSeconds: number
  companyId: string
  franchiseeId: string
  companyName: string
  staffId: string
  driverId: string
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
  meterTimeFareYen: number
  waitingFareYen: number
  escortFareYen: number
  careOptionFareYen: number
  expenseFareYen: number
  totalFareYen: number
  grossFareYen: number
  discountableFareYen: number
  isDisabilityDiscount: boolean
  disabilityDiscountRate: number
  disabilityDiscountAmount: number
  discountName: string
  discountMethod: 'percentage' | 'fixed'
  discountValue: number
  taxiTicketAmountYen: number
  taxiTickets: TaxiTicket[]
  paymentMethod: string
  payments: PaymentAllocation[]
  receiptName: string
  customerName: string
  remarks: string
  status: CaseRecordStatus
  deleted: boolean
  deletedAt: string
  deletedBy: string
  deleteReason: string
  restoredAt: string
  restoredBy: string
  cancelReason: string
  canceledAt: string
  cancelledBy: string
  receiptReissues: ReceiptReissueEntry[]
  settlementAdjustments: SettlementAdjustmentEntry[]
  changeHistory: CaseRecordChangeEntry[]
  pickupLatitude: number | null
  pickupLongitude: number | null
  pickupAddress: string
  pickupArea: string
  pickupCapturedAt: string | null
  dropoffLatitude: number | null
  dropoffLongitude: number | null
  dropoffAddress: string
  dropoffArea: string
  dropoffCapturedAt: string | null
  assistCharges: AssistCharge[]
  dispatchCharges: AssistCharge[]
  specialVehicleCharges: AssistCharge[]
  expenseCharges: ExpenseCharge[]
  timeDiscountEnabled: boolean
  legalTimeFare: number
  timeDiscountAmount: number
  actualTimeFare: number
  initialMinutes: number
  additionalSeconds: number
  meterMode: string
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
  specialVehicleFareYen: number
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

const toTaxiTickets = (value: unknown): TaxiTicket[] =>
  Array.isArray(value)
    ? value
        .map((item, index) => {
          const source = toObject(item)
          const municipality = toString(source.municipality)
          const ticketNumber = toString(source.ticketNumber)
          const amount = Math.max(Math.round(toNumber(source.amount)), 0)
          const id = toString(source.id) || `taxi-ticket-${index}`

          return municipality && amount > 0
            ? { amount, id, municipality, ticketNumber }
            : null
        })
        .filter((item): item is TaxiTicket => Boolean(item))
    : []

const toPaymentAllocations = (value: unknown): PaymentAllocation[] =>
  Array.isArray(value)
    ? value
        .map((item, index) => {
          const source = toObject(item)
          const type = toString(source.type) as PaymentMethod
          const amount = Math.max(Math.round(toNumber(source.amount)), 0)
          const id = toString(source.id) || `payment-${index}`

          return type && amount > 0 ? { amount, id, type } : null
        })
        .filter((item): item is PaymentAllocation => Boolean(item))
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

const toReceiptReissues = (value: unknown): ReceiptReissueEntry[] =>
  Array.isArray(value)
    ? value
        .map((item) => {
          const source = toObject(item)
          const reissuedAt = toIsoString(source.reissuedAt) || toString(source.reissuedAt)
          const reissuedBy = toString(source.reissuedBy)
          const reason = toString(source.reason)

          return reissuedAt ? { reason, reissuedAt, reissuedBy } : null
        })
        .filter((item): item is ReceiptReissueEntry => Boolean(item))
    : []

const toSettlementAdjustments = (value: unknown): SettlementAdjustmentEntry[] =>
  Array.isArray(value)
    ? value
        .map((item) => {
          const source = toObject(item)
          const adjustedAt = toIsoString(source.adjustedAt) || toString(source.adjustedAt)
          const adjustedBy = toString(source.adjustedBy)
          const reason = toString(source.reason)
          return adjustedAt
            ? {
                adjustedAt,
                adjustedBy,
                reason,
                previousTotalFareYen: Math.max(Math.round(toNumber(source.previousTotalFareYen)), 0),
                adjustedTotalFareYen: Math.max(Math.round(toNumber(source.adjustedTotalFareYen)), 0),
                differenceYen: Math.round(toNumber(source.differenceYen)),
                refundYen: Math.max(Math.round(toNumber(source.refundYen)), 0),
                receiptName: toString(source.receiptName),
                taxiTickets: toTaxiTickets(source.taxiTickets),
              }
            : null
        })
        .filter((item): item is SettlementAdjustmentEntry => Boolean(item))
    : []

const toCaseRecordStatus = (value: unknown): CaseRecordStatus =>
  value === 'canceled' ? 'canceled' : 'completed'

const toPaymentMethod = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : '未設定'

const toBoolean = (value: unknown, fallback = false) =>
  typeof value === 'boolean' ? value : fallback

const toStoredCaseRecord = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
): StoredCaseRecord => {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    caseNumber:
      typeof data.caseNumber === 'string' && data.caseNumber.trim() ? data.caseNumber : snapshot.id,
    caseDate: toString(data.caseDate),
    storeCode: toString(data.storeCode),
    dailySequence: Math.max(Math.floor(toNumber(data.dailySequence)), 0),
    fareSnapshot: toFareSnapshot(data.fareSnapshot),
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : '',
    createdAt: toIsoString(data.createdAt) || toIsoString(data.savedAt),
    startedAt: toString(data.startedAt),
    endedAt: toString(data.endedAt),
    distanceKm: toNumber(data.distanceKm),
    chargeableDistanceKm: toNumber(data.chargeableDistanceKm ?? data.distanceKm),
    businessDistanceKm: toNumber(data.businessDistanceKm ?? data.distanceKm),
    drivingSeconds: toNumber(data.drivingSeconds),
    waitingSeconds: toNumber(data.waitingSeconds),
    accompanyingSeconds: toNumber(data.accompanyingSeconds),
    companyId: getFranchiseeId(data),
    franchiseeId: getFranchiseeId(data),
    companyName: toString(data.companyName),
    staffId: toString(data.staffId) || toString(data.driverId),
    driverId: toString(data.driverId) || toString(data.staffId),
    staffName: toString(data.staffName),
    staffRole: toString(data.staffRole) as StaffRole | '',
    vehicleId: toString(data.vehicleId),
    vehicleName: toString(data.vehicleName),
    vehicleNumber: toString(data.vehicleNumber),
    workSessionId: toString(data.workSessionId),
    storeId: getStoreId(data),
    storeName: toString(data.storeName),
    dispatchFareYen: toNumber(data.dispatchFareYen),
    specialVehicleFareYen: toNumber(data.specialVehicleFareYen),
    basicFareYen: toNumber(data.basicFareYen),
    meterTimeFareYen: toNumber(data.meterTimeFareYen),
    waitingFareYen: toNumber(data.waitingFareYen),
    escortFareYen: toNumber(data.escortFareYen),
    careOptionFareYen: toNumber(data.careOptionFareYen),
    expenseFareYen: toNumber(data.expenseFareYen),
    totalFareYen: toNumber(data.totalFareYen),
    grossFareYen: toNumber(data.grossFareYen),
    discountableFareYen: toNumber(data.discountableFareYen),
    isDisabilityDiscount: toBoolean(data.isDisabilityDiscount),
    disabilityDiscountRate: toNumber(data.disabilityDiscountRate),
    disabilityDiscountAmount: toNumber(data.disabilityDiscountAmount),
    discountName: toString(data.discountName) || '割引',
    discountMethod: data.discountMethod === 'fixed' ? 'fixed' : 'percentage',
    discountValue: toNumber(data.discountValue) || (toNumber(data.disabilityDiscountRate) * 100),
    taxiTicketAmountYen: toNumber(data.taxiTicketAmountYen),
    taxiTickets: toTaxiTickets(data.taxiTickets),
    paymentMethod: toPaymentMethod(data.paymentMethod),
    payments: toPaymentAllocations(data.payments),
    receiptName: toString(data.receiptName),
    customerName: '',
    remarks: toString(data.remarks),
    status: toCaseRecordStatus(data.status),
    deleted: data.deleted === true,
    deletedAt: toIsoString(data.deletedAt) || toString(data.deletedAt),
    deletedBy: toString(data.deletedBy),
    deleteReason: toString(data.deleteReason),
    restoredAt: toIsoString(data.restoredAt) || toString(data.restoredAt),
    restoredBy: toString(data.restoredBy),
    cancelReason: toString(data.cancelReason),
    canceledAt: toString(data.canceledAt),
    cancelledBy: toString(data.cancelledBy),
    receiptReissues: toReceiptReissues(data.receiptReissues),
    settlementAdjustments: toSettlementAdjustments(data.settlementAdjustments),
    changeHistory: toChangeHistory(data.changeHistory),
    pickupLatitude: toNullableNumber(data.pickupLatitude),
    pickupLongitude: toNullableNumber(data.pickupLongitude),
    pickupAddress: toString(data.pickupAddress),
    pickupArea: toString(data.pickupArea) || extractAreaFromAddress(toString(data.pickupAddress)),
    pickupCapturedAt: toString(data.pickupCapturedAt) || null,
    dropoffLatitude: toNullableNumber(data.dropoffLatitude),
    dropoffLongitude: toNullableNumber(data.dropoffLongitude),
    dropoffAddress: toString(data.dropoffAddress),
    dropoffArea: toString(data.dropoffArea) || extractAreaFromAddress(toString(data.dropoffAddress)),
    dropoffCapturedAt: toString(data.dropoffCapturedAt) || null,
    assistCharges: toAssistCharges(data.assistCharges),
    dispatchCharges: toAssistCharges(data.dispatchCharges),
    specialVehicleCharges: toAssistCharges(data.specialVehicleCharges),
    expenseCharges: toExpenseCharges(data.expenseCharges),
    timeDiscountEnabled: toBoolean(data.timeDiscountEnabled),
    legalTimeFare: toNumber(data.legalTimeFare),
    timeDiscountAmount: toNumber(data.timeDiscountAmount),
    actualTimeFare: toNumber(data.actualTimeFare),
    initialMinutes: toNumber(data.initialMinutes),
    additionalSeconds: toNumber(data.additionalSeconds),
    meterMode: toString(data.meterMode) || 'gps',
  }
}

function getCaseRecordsCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, caseRecordsCollectionName)
}

const caseCountersCollectionName = 'caseCounters'

const caseNumberDateKeyFormatter = new Intl.DateTimeFormat('sv-SE', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: '2-digit',
})

const createCaseNumberDateKey = (date = new Date()) =>
  caseNumberDateKeyFormatter.format(date).replaceAll('-', '')

// 店舗コードが未設定の既存データに対応するため、店舗ID/店舗名から英数字のみを抽出し、
// 先頭5文字を店舗コードとして使う。抽出できない場合は STORE をfallbackにする。
export const deriveStoreCode = (storeId: string, storeName = '') => {
  const normalizedSource = (storeId || storeName || 'STORE')
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, '')

  return (normalizedSource || 'STORE').slice(0, 5).padEnd(5, '0')
}

export async function generateCaseNumber({
  franchiseeId = '',
  storeId,
  storeName = '',
}: {
  franchiseeId?: string
  storeId: string
  storeName?: string
}): Promise<CaseNumberAssignment> {
  const db = getFirestore(getFirebaseApp())
  const dateKey = createCaseNumberDateKey()
  const safeStoreId = storeId || defaultStoreId
  const storeCode = deriveStoreCode(safeStoreId, storeName)
  const counterRef = doc(db, caseCountersCollectionName, `${safeStoreId}_${dateKey}`)

  const dailySequence = await runTransaction(db, async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef)
    const currentSequence = counterSnapshot.exists()
      ? Math.max(Math.floor(toNumber(counterSnapshot.data().currentSequence)), 0)
      : 0
    const nextSequence = currentSequence + 1

    transaction.set(counterRef, {
      companyId: franchiseeId,
      currentSequence: nextSequence,
      dateKey,
      franchiseeId,
      storeCode,
      storeId: safeStoreId,
      updatedAt: serverTimestamp(),
    }, { merge: true })

    return nextSequence
  })

  return {
    caseDate: toJapanDateInputValue(new Date().toISOString()),
    caseNumber: `${dateKey}-${storeCode}-${String(dailySequence).padStart(4, '0')}`,
    dailySequence,
    storeCode,
  }
}

export async function saveCaseRecord({
  caseNumber,
  caseDate,
  storeCode = '',
  dailySequence = 0,
  fareSnapshot = null,
  closedAt,
  startedAt,
  endedAt,
  distanceKm,
  chargeableDistanceKm,
  businessDistanceKm,
  drivingSeconds,
  waitingSeconds = 0,
  accompanyingSeconds = 0,
  workSession = null,
  vehicle = null,
  fareBreakdown,
  paymentMethod,
  payments = [],
  taxiTickets = [],
  pickupLocation,
  selectedCareOptions,
  selectedDispatchCharges = [],
  selectedSpecialVehicleCharges = [],
  selectedExpenses,
  dropoffLocation,
}: CaseRecordInput) {
  const franchiseeId = workSession?.franchiseeId || workSession?.companyId || ''
  const staffId = workSession?.staffId ?? ''
  const storeId = workSession?.storeId ?? ''
  const workSessionId = workSession?.id ?? ''

  if (!franchiseeId || !storeId || !staffId || !workSessionId) {
    throw new Error('案件保存に必要な勤務セッション情報が不足しています。出勤状態を確認してから再度お試しください。')
  }

  const record: CaseRecordDocument = {
    caseNumber,
    caseDate: caseDate || toJapanDateInputValue(closedAt),
    storeCode,
    dailySequence: Math.max(Math.floor(dailySequence), 0),
    fareSnapshot,
    closedAt,
    startedAt,
    endedAt,
    distanceKm: Number(distanceKm.toFixed(3)),
    chargeableDistanceKm: Number(chargeableDistanceKm.toFixed(3)),
    businessDistanceKm: Number(businessDistanceKm.toFixed(3)),
    drivingSeconds: Math.max(Math.floor(drivingSeconds), 0),
    waitingSeconds: Math.max(Math.floor(waitingSeconds), 0),
    accompanyingSeconds: Math.max(Math.floor(accompanyingSeconds), 0),
    companyId: franchiseeId,
    franchiseeId,
    companyName: workSession?.companyName ?? '',
    staffId,
    driverId: staffId,
    staffName: workSession?.staffName ?? '',
    staffRole: workSession?.staffRole ?? '',
    vehicleId: vehicle?.id ?? '',
    vehicleName: vehicle?.name ?? '',
    vehicleNumber: vehicle?.number ?? '',
    workSessionId,
    storeId,
    storeName: workSession?.storeName ?? '',
    dispatchFareYen: fareBreakdown.dispatchFareYen,
    specialVehicleFareYen: fareBreakdown.specialVehicleFareYen,
    basicFareYen: fareBreakdown.basicFareYen,
    meterTimeFareYen: fareBreakdown.meterTimeFareYen,
    waitingFareYen: fareBreakdown.waitingFareYen,
    escortFareYen: fareBreakdown.escortFareYen,
    careOptionFareYen: fareBreakdown.careOptionFareYen,
    expenseFareYen: fareBreakdown.expenseFareYen,
    totalFareYen: fareBreakdown.totalFareYen,
    grossFareYen: fareBreakdown.grossFareYen,
    discountableFareYen: fareBreakdown.discountableFareYen,
    isDisabilityDiscount: fareBreakdown.isDisabilityDiscount,
    disabilityDiscountRate: fareBreakdown.disabilityDiscountRate,
    disabilityDiscountAmount: fareBreakdown.disabilityDiscountAmount,
    discountName: fareBreakdown.discountName,
    discountMethod: fareBreakdown.discountMethod,
    discountValue: fareBreakdown.discountValue,
    taxiTicketAmountYen: fareBreakdown.taxiTicketAmountYen,
    taxiTickets,
    paymentMethod,
    payments,
    receiptName: '',
    customerName: '',
    remarks: '',
    status: 'completed',
    deleted: false,
    deletedAt: '',
    deletedBy: '',
    deleteReason: '',
    restoredAt: '',
    restoredBy: '',
    cancelReason: '',
    canceledAt: '',
    cancelledBy: '',
    receiptReissues: [],
    settlementAdjustments: [],
    changeHistory: [],
    pickupLatitude: pickupLocation.latitude,
    pickupLongitude: pickupLocation.longitude,
    pickupAddress: pickupLocation.address,
    pickupArea: extractAreaFromAddress(pickupLocation.address),
    pickupCapturedAt: pickupLocation.capturedAt,
    dropoffLatitude: dropoffLocation.latitude,
    dropoffLongitude: dropoffLocation.longitude,
    dropoffAddress: dropoffLocation.address,
    dropoffArea: extractAreaFromAddress(dropoffLocation.address),
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
    timeDiscountEnabled: fareBreakdown.timeMeter?.timeDiscountEnabled ?? false,
    legalTimeFare: fareBreakdown.timeMeter?.legalTimeFare ?? 0,
    timeDiscountAmount: fareBreakdown.timeMeter?.timeDiscountAmount ?? 0,
    actualTimeFare: fareBreakdown.timeMeter?.actualTimeFare ?? 0,
    initialMinutes: fareBreakdown.timeMeter?.initialMinutes ?? 0,
    additionalSeconds: fareBreakdown.timeMeter?.additionalSeconds ?? 0,
    meterMode: fareBreakdown.meterMode,
    savedAt: serverTimestamp(),
  }

  return addDoc(getCaseRecordsCollection(), record)
}

const createCaseRecordTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || scope.role === 'hq_admin') return []

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const constraints: QueryConstraint[] = []

  if (franchiseeId) {
    constraints.push(where('franchiseeId', '==', franchiseeId))
  }

  if ((scope.role === 'manager' || scope.role === 'driver') && scope.storeId) {
    constraints.push(where('storeId', '==', scope.storeId))
  }

  if (scope.role === 'driver' && scope.staffId) {
    constraints.push(where('staffId', '==', scope.staffId))
  }

  return constraints
}

export async function fetchCaseRecords(scope?: TenantAccessScope) {
  const snapshots = await getDocs(
    query(
      getCaseRecordsCollection(),
      ...createCaseRecordTenantConstraints(scope),
      orderBy('closedAt', 'desc'),
    ),
  )

  return snapshots.docs.map(toStoredCaseRecord).filter((record) => matchesTenantScope(record, scope))
}

export async function fetchCaseRecordsInClosedAtRange({
  endIso,
  startIso,
  scope,
}: {
  endIso: string
  startIso: string
  scope?: TenantAccessScope
}) {
  const snapshots = await getDocs(
    query(
      getCaseRecordsCollection(),
      ...createCaseRecordTenantConstraints(scope),
      where('closedAt', '>=', startIso),
      where('closedAt', '<', endIso),
      orderBy('closedAt', 'desc'),
    ),
  )

  return snapshots.docs.map(toStoredCaseRecord).filter((record) => matchesTenantScope(record, scope))
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
  { key: 'specialVehicleFareYen', label: '特殊車両料金', format: (value) => formatYenForHistory(Number(value)) },
  { key: 'expenseFareYen', label: '実費', format: (value) => formatYenForHistory(Number(value)) },
  { key: 'paymentMethod', label: '支払方法', format: (value) => String(value || '未設定') },
  { key: 'remarks', label: '備考', format: (value) => String(value || '未設定') },
]

const toEditableValues = (caseRecord: StoredCaseRecord): CaseRecordEditableValues => ({
  careOptionFareYen: caseRecord.careOptionFareYen,
  dispatchFareYen: caseRecord.dispatchFareYen,
  specialVehicleFareYen: caseRecord.specialVehicleFareYen,
  expenseFareYen: caseRecord.expenseFareYen,
  paymentMethod: caseRecord.paymentMethod,
  remarks: caseRecord.remarks,
})

const normalizeEditableValues = (values: CaseRecordEditableValues): CaseRecordEditableValues => ({
  careOptionFareYen: Math.max(Math.round(values.careOptionFareYen), 0),
  dispatchFareYen: Math.max(Math.round(values.dispatchFareYen), 0),
  specialVehicleFareYen: Math.max(Math.round(values.specialVehicleFareYen), 0),
  expenseFareYen: Math.max(Math.round(values.expenseFareYen), 0),
  paymentMethod: values.paymentMethod.trim() || '未設定',
  remarks: values.remarks.trim(),
})

const calculateEditableFareYen = (values: Pick<
  CaseRecordEditableValues,
  'careOptionFareYen' | 'dispatchFareYen' | 'specialVehicleFareYen' | 'expenseFareYen'
>) => values.careOptionFareYen + values.dispatchFareYen + values.specialVehicleFareYen + values.expenseFareYen

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
  actor?: AuditActor | null,
  reason = "案件修正",
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

  await createAuditLog({
    action: "case_update",
    actor,
    targetId: caseRecord.id,
    targetType: 'caseRecord',
    before: previousValues,
    after: { ...normalizedValues, totalFareYen: updatedRecord.totalFareYen },
    reason,
  })

  return updatedRecord
}

export async function cancelCaseRecord(
  caseRecord: StoredCaseRecord,
  { actor = null, reason }: { actor?: AuditActor | null; reason: string },
) {
  const canceledAt = new Date().toISOString()
  const cancelledBy = actor?.userId ?? ''
  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    cancelReason: reason,
    canceledAt,
    cancelledBy,
    status: 'canceled',
    changeHistory: [
      ...(caseRecord.changeHistory ?? []),
      {
        changedAt: canceledAt,
        fieldLabel: 'キャンセル',
        previousValue: caseRecord.status === 'canceled' ? 'キャンセル済' : '通常',
        nextValue: `キャンセル済（${reason}）`,
      },
    ],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    cancelReason: reason,
    canceledAt,
    cancelledBy,
    status: 'canceled',
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  await createAuditLog({
    action: 'case_cancel',
    actor,
    targetId: caseRecord.id,
    targetType: 'caseRecord',
    before: { cancelReason: caseRecord.cancelReason, canceledAt: caseRecord.canceledAt, status: caseRecord.status },
    after: { cancelReason: reason, canceledAt, cancelledBy, status: 'canceled' },
    reason,
  })

  return updatedRecord
}

export async function softDeleteCaseRecord(
  caseRecord: StoredCaseRecord,
  { actor = null, reason }: { actor?: AuditActor | null; reason: string },
) {
  const deletedAt = new Date().toISOString()
  const deletedBy = actor?.userId ?? ""
  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    deleted: true,
    deletedAt,
    deletedBy,
    deleteReason: reason,
    changeHistory: [
      ...(caseRecord.changeHistory ?? []),
      {
        changedAt: deletedAt,
        fieldLabel: "削除",
        previousValue: caseRecord.deleted ? "削除済" : "通常",
        nextValue: `削除済（${reason}）`,
      },
    ],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    deleted: true,
    deletedAt: serverTimestamp(),
    deletedBy,
    deleteReason: reason,
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  await createAuditLog({
    action: "case_delete",
    actor,
    targetId: caseRecord.id,
    targetType: 'caseRecord',
    before: { deleted: caseRecord.deleted, deleteReason: caseRecord.deleteReason },
    after: { deleted: true, deletedAt, deletedBy, deleteReason: reason },
    reason,
  })

  return updatedRecord
}


export async function restoreCaseRecord(
  caseRecord: StoredCaseRecord,
  { actor = null, reason }: { actor?: AuditActor | null; reason: string },
) {
  const restoredAt = new Date().toISOString()
  const restoredBy = actor?.userId ?? ''
  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    deleted: false,
    restoredAt,
    restoredBy,
    changeHistory: [
      ...(caseRecord.changeHistory ?? []),
      {
        changedAt: restoredAt,
        fieldLabel: '復元',
        previousValue: caseRecord.deleted ? `削除済（${caseRecord.deleteReason || '理由未記録'}）` : '通常',
        nextValue: `通常（${reason}）`,
      },
    ],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    deleted: false,
    restoredAt,
    restoredBy,
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  await createAuditLog({
    action: 'case_restore',
    actor,
    targetId: caseRecord.id,
    targetType: 'caseRecord',
    before: { deleted: caseRecord.deleted, deleteReason: caseRecord.deleteReason },
    after: { deleted: false, restoredAt, restoredBy },
    reason,
  })

  return updatedRecord
}

export async function recordReceiptReissue(
  caseRecord: StoredCaseRecord,
  { actor = null, reason }: { actor?: AuditActor | null; reason: string },
) {
  const reissuedAt = new Date().toISOString()
  const reissuedBy = actor?.userId ?? ''
  const receiptReissue = { reason, reissuedAt, reissuedBy }
  const receiptReissues = [...(caseRecord.receiptReissues ?? []), receiptReissue]
  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    receiptReissues,
    changeHistory: [
      ...(caseRecord.changeHistory ?? []),
      {
        changedAt: reissuedAt,
        fieldLabel: '領収書再発行',
        previousValue: `${caseRecord.receiptReissues.length}回`,
        nextValue: `${receiptReissues.length}回（${reason}）`,
      },
    ],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    receiptReissues,
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  await createAuditLog({
    action: 'receipt_reissue',
    actor,
    targetId: caseRecord.id,
    targetType: 'caseRecord',
    before: { receiptReissueCount: caseRecord.receiptReissues.length },
    after: { receiptReissueCount: receiptReissues.length, receiptReissue },
    reason,
  })

  return updatedRecord
}

export async function recordSettlementAdjustment(
  caseRecord: StoredCaseRecord,
  {
    actor = null,
    reason,
    receiptName,
    taxiTickets,
  }: {
    actor?: AuditActor | null
    reason: string
    receiptName: string
    taxiTickets: TaxiTicket[]
  },
) {
  const adjustedAt = new Date().toISOString()
  const adjustedBy = actor?.userId ?? ''
  const normalizedTickets = taxiTickets
    .map((ticket, index) => ({
      amount: Math.max(Math.round(ticket.amount) || 0, 0),
      id: ticket.id || `adjustment-ticket-${index}`,
      municipality: ticket.municipality.trim(),
      ticketNumber: ticket.ticketNumber.trim(),
    }))
    .filter((ticket) => ticket.municipality && ticket.amount > 0)
  const adjustedTaxiTicketAmountYen = normalizedTickets.reduce((total, ticket) => total + ticket.amount, 0)
  const previousTicketAmountYen = caseRecord.taxiTicketAmountYen
  const differenceYen = adjustedTaxiTicketAmountYen - previousTicketAmountYen
  const refundYen = Math.max(differenceYen, 0)
  const adjustedTotalFareYen = Math.max(caseRecord.grossFareYen - caseRecord.disabilityDiscountAmount - adjustedTaxiTicketAmountYen, 0)
  const adjustment: SettlementAdjustmentEntry = {
    adjustedAt,
    adjustedBy,
    reason,
    previousTotalFareYen: caseRecord.totalFareYen,
    adjustedTotalFareYen,
    differenceYen: adjustedTotalFareYen - caseRecord.totalFareYen,
    refundYen,
    receiptName: receiptName.trim(),
    taxiTickets: normalizedTickets,
  }
  const settlementAdjustments = [...(caseRecord.settlementAdjustments ?? []), adjustment]
  const updatedRecord: StoredCaseRecord = {
    ...caseRecord,
    settlementAdjustments,
    changeHistory: [
      ...(caseRecord.changeHistory ?? []),
      {
        changedAt: adjustedAt,
        fieldLabel: '訂正処理',
        previousValue: `${formatYenForHistory(caseRecord.totalFareYen)} / タクシー券 ${formatYenForHistory(previousTicketAmountYen)}`,
        nextValue: `${formatYenForHistory(adjustedTotalFareYen)} / タクシー券 ${formatYenForHistory(adjustedTaxiTicketAmountYen)} / 返金 ${formatYenForHistory(refundYen)}（${reason}）`,
      },
    ],
  }

  await updateDoc(doc(getFirestore(getFirebaseApp()), caseRecordsCollectionName, caseRecord.id), {
    settlementAdjustments,
    changeHistory: updatedRecord.changeHistory,
    savedAt: serverTimestamp(),
  })

  await createAuditLog({
    action: 'settlement_adjustment',
    actor,
    targetId: caseRecord.id,
    targetType: 'caseRecord',
    before: {
      receiptName: caseRecord.receiptName,
      taxiTicketAmountYen: previousTicketAmountYen,
      totalFareYen: caseRecord.totalFareYen,
    },
    after: {
      receiptName: adjustment.receiptName,
      taxiTicketAmountYen: adjustedTaxiTicketAmountYen,
      totalFareYen: adjustedTotalFareYen,
      differenceYen: adjustment.differenceYen,
      refundYen,
      taxiTicketNumbers: normalizedTickets.map((ticket) => ticket.ticketNumber),
    },
    reason,
  })

  return updatedRecord
}
