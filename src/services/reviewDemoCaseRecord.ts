import type { FareBreakdown } from '../services/fare'
import type { CaseNumberAssignment, FareSnapshot, StoredCaseRecord, CaseRecordStatus } from '../services/caseRecords'
import type { WorkSession } from '../types/work'
import type { Vehicle } from '../types/work'
import type { CapturedAddressLocation } from '../utils/reverseGeocode'
import type { PreFixedFareException, CompletionReason } from '../types/preFixedFare'
import type { PreFixedFareRouteChangeLog } from '../types/preFixedFareRouteChange'
import type { ReservationTripContext } from '../services/reservationTripContext'
import {
  REVIEW_DEMO_CASE_NUMBER_PREFIX,
  REVIEW_DEMO_COMPANY_NAME,
  REVIEW_DEMO_DRIVER_NAME,
  REVIEW_DEMO_RESERVATION_ID,
  REVIEW_DEMO_STORE_NAME,
  REVIEW_DEMO_VEHICLE_ID,
  REVIEW_DEMO_VEHICLE_NAME,
  REVIEW_DEMO_WORK_SESSION,
} from '../utils/reviewDemo'
import { FARE_MODE_PRE_FIXED } from '../types/preFixedFare'
import { extractAreaFromAddress } from '../utils/address'

export const REVIEW_DEMO_VEHICLE: Vehicle = {
  id: REVIEW_DEMO_VEHICLE_ID,
  companyId: REVIEW_DEMO_WORK_SESSION.companyId,
  franchiseeId: REVIEW_DEMO_WORK_SESSION.franchiseeId,
  storeId: REVIEW_DEMO_WORK_SESSION.storeId,
  storeName: REVIEW_DEMO_STORE_NAME,
  name: REVIEW_DEMO_VEHICLE_NAME,
  vehicleName: REVIEW_DEMO_VEHICLE_NAME,
  number: 'デモ001',
  plateNumber: 'デモ001',
  status: '稼働中',
  fuelType: 'ガソリン',
  vehicleType: '一般車',
  wheelchairCapacity: 0,
  stretcherSupported: false,
  inspectionExpiresAt: '',
  insuranceExpiresAt: '',
  memo: '審査用デモ車両',
  enabled: true,
  isActive: true,
  sortOrder: 0,
}

export const createReviewDemoCaseNumberAssignment = (): CaseNumberAssignment => ({
  caseDate: '2026-09-01',
  caseNumber: `${REVIEW_DEMO_CASE_NUMBER_PREFIX}-001`,
  dailySequence: 1,
  storeCode: 'DEMO0',
})

export type BuildReviewDemoSavedCaseRecordInput = {
  caseNumber: string
  caseNumberAssignment: CaseNumberAssignment | null
  fareSnapshot: FareSnapshot | null
  closedAt: string
  startedAt: string
  endedAt: string
  settlementBreakdown: FareBreakdown
  paymentMethod: StoredCaseRecord['paymentMethod']
  payments: StoredCaseRecord['payments']
  receiptName: string
  reservationTripContext: ReservationTripContext | null
  fixedFareRun: {
    confirmedFareYen: number
    reservationId: string
    snapshotHash: string
  } | null
  additionalRouteFareYen: number
  additionalCareFareYen: number
  routeChangeLogs: PreFixedFareRouteChangeLog[]
  preFixedFareSaveExtras: {
    fareMode?: typeof FARE_MODE_PRE_FIXED
    completionReason?: CompletionReason
    preFixedFareException?: PreFixedFareException
    recordStatus?: CaseRecordStatus
  }
  pickupLocation: CapturedAddressLocation
  dropoffLocation: CapturedAddressLocation
  drivingSeconds: number
  waitingSeconds: number
  accompanyingSeconds: number
}

export const buildReviewDemoSavedCaseRecord = ({
  caseNumber,
  caseNumberAssignment,
  fareSnapshot,
  closedAt,
  startedAt,
  endedAt,
  settlementBreakdown,
  paymentMethod,
  payments,
  receiptName,
  reservationTripContext,
  fixedFareRun,
  additionalRouteFareYen,
  additionalCareFareYen,
  routeChangeLogs,
  preFixedFareSaveExtras,
  pickupLocation,
  dropoffLocation,
  drivingSeconds,
  waitingSeconds,
  accompanyingSeconds,
}: BuildReviewDemoSavedCaseRecordInput): StoredCaseRecord => {
  const workSession: WorkSession = REVIEW_DEMO_WORK_SESSION

  return {
    id: `review-demo-${caseNumber}`,
    caseNumber,
    caseDate: caseNumberAssignment?.caseDate ?? '2026-09-01',
    storeCode: caseNumberAssignment?.storeCode ?? 'DEMO0',
    dailySequence: caseNumberAssignment?.dailySequence ?? 1,
    fareSnapshot,
    closedAt,
    startedAt,
    endedAt,
    distanceKm: 0,
    chargeableDistanceKm: 0,
    businessDistanceKm: 0,
    drivingSeconds,
    waitingSeconds,
    accompanyingSeconds,
    companyId: workSession.franchiseeId,
    franchiseeId: workSession.franchiseeId,
    companyName: REVIEW_DEMO_COMPANY_NAME,
    staffId: workSession.staffId,
    driverId: workSession.staffId,
    staffName: REVIEW_DEMO_DRIVER_NAME,
    staffRole: workSession.staffRole,
    vehicleId: REVIEW_DEMO_VEHICLE.id,
    vehicleName: REVIEW_DEMO_VEHICLE.name,
    vehicleNumber: REVIEW_DEMO_VEHICLE.number,
    workSessionId: workSession.id,
    storeId: workSession.storeId,
    storeName: REVIEW_DEMO_STORE_NAME,
    dispatchFareYen: settlementBreakdown.dispatchFareYen,
    specialVehicleFareYen: settlementBreakdown.specialVehicleFareYen,
    basicFareYen: settlementBreakdown.basicFareYen,
    meterTimeFareYen: settlementBreakdown.meterTimeFareYen,
    waitingFareYen: settlementBreakdown.waitingFareYen,
    escortFareYen: settlementBreakdown.escortFareYen,
    careOptionFareYen: settlementBreakdown.careOptionFareYen,
    customFeeFareYen: settlementBreakdown.customFeeFareYen,
    expenseFareYen: settlementBreakdown.expenseFareYen,
    normalFareYen: settlementBreakdown.normalFareYen,
    nightSurchargeYen: settlementBreakdown.nightSurchargeYen,
    totalFareYen: settlementBreakdown.totalFareYen,
    grossFareYen: settlementBreakdown.grossFareYen,
    discountableFareYen: settlementBreakdown.discountableFareYen,
    isDisabilityDiscount: settlementBreakdown.isDisabilityDiscount,
    disabilityDiscountRate: settlementBreakdown.disabilityDiscountRate,
    disabilityDiscountAmount: settlementBreakdown.disabilityDiscountAmount,
    discountName: settlementBreakdown.discountName,
    discountMethod: settlementBreakdown.discountMethod,
    discountValue: settlementBreakdown.discountValue,
    taxiTicketAmountYen: settlementBreakdown.taxiTicketAmountYen,
    taxiTickets: [],
    paymentMethod,
    payments,
    receiptName,
    customerName: receiptName || reservationTripContext?.customerName || '審査用デモ',
    remarks: preFixedFareSaveExtras.preFixedFareException?.note ?? '',
    status: preFixedFareSaveExtras.recordStatus ?? 'completed',
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
    assistCharges: [],
    customFees: [],
    dispatchCharges: [],
    specialVehicleCharges: [],
    expenseCharges: [],
    timeDiscountEnabled: settlementBreakdown.timeMeter?.timeDiscountEnabled ?? false,
    legalTimeFare: settlementBreakdown.timeMeter?.legalTimeFare ?? 0,
    timeDiscountAmount: settlementBreakdown.timeMeter?.timeDiscountAmount ?? 0,
    actualTimeFare: settlementBreakdown.timeMeter?.actualTimeFare ?? 0,
    initialMinutes: settlementBreakdown.timeMeter?.initialMinutes ?? 0,
    additionalSeconds: settlementBreakdown.timeMeter?.additionalSeconds ?? 0,
    meterMode: settlementBreakdown.meterMode,
    actualMeterMode: settlementBreakdown.meterMode,
    actualFareYen: settlementBreakdown.totalFareYen,
    gpsComparisonFareYen: null,
    timeComparisonFareYen: null,
    obdComparisonFareYen: null,
    reservationId: fixedFareRun?.reservationId ?? REVIEW_DEMO_RESERVATION_ID,
    confirmedFareYen: fixedFareRun?.confirmedFareYen ?? reservationTripContext?.confirmedFareYen ?? 0,
    snapshotHash: fixedFareRun?.snapshotHash ?? reservationTripContext?.snapshotHash ?? '',
    additionalRouteFareYen,
    additionalCareFareYen: settlementBreakdown.additionalCareFareYen ?? additionalCareFareYen,
    routeChangeLogs,
    fareMode: preFixedFareSaveExtras.fareMode ?? FARE_MODE_PRE_FIXED,
    preFixedFareException: preFixedFareSaveExtras.preFixedFareException,
    completionReason: preFixedFareSaveExtras.completionReason,
  }
}
