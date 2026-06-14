import type { TimerSeconds } from '../hooks/useOperationTimers'
import type { CaseNumberAssignment, FareSnapshot } from './caseRecords'
import type {
  ExpenseItem,
  ActivityHistoryEntry,
  GpsPosition,
  MeterMovementState,
  OperationStatus,
  PaymentMethod,
  SelectedCareOption,
  TaxiTicket,
  TimerKey,
} from '../types/case'
import {
  emptyCapturedAddressLocation,
  type CapturedAddressLocation,
} from '../utils/reverseGeocode'

export const activeTripSnapshotStorageKey = 'careTaxiMeterActiveTripSnapshot'

export type ActiveTripSnapshot = {
  activeTimer: TimerKey | null
  activityHistories: ActivityHistoryEntry[]
  billableTimeStarted: {
    accompanying: boolean
    waiting: boolean
  }
  caseNumber: string
  caseNumberAssignment: CaseNumberAssignment | null
  capturedAt: string
  distances: {
    businessDistanceKm: number
    chargeableDistanceKm: number
  }
  dropoffLocation: CapturedAddressLocation
  fareSnapshot: FareSnapshot | null
  fareTotalYen: number
  gps: {
    currentSpeedKmh: number | null
    gpsLogCount: number
    lowSpeedSeconds: number
    movementState: MeterMovementState
    position: GpsPosition | null
    speedSource: string
  }
  isDisabilityDiscount: boolean
  operationEndedAt: string
  operationStartedAt: string
  paymentAmounts: Record<PaymentMethod, number>
  paymentMethod: PaymentMethod
  pickupLocation: CapturedAddressLocation
  selectedCareOptions: SelectedCareOption[]
  selectedDispatchCharges: SelectedCareOption[]
  selectedExpenses: ExpenseItem[]
  selectedSpecialVehicleCharges: SelectedCareOption[]
  selectedVehicleId: string
  status: OperationStatus
  taxiTickets: TaxiTicket[]
  timers: TimerSeconds
}

export type ActiveTripRestorationPlan = {
  elapsedSeconds: number
  shouldApplyElapsed: boolean
  shouldBridgeGpsDistance: boolean
}

const activeTimerMap: Partial<Record<OperationStatus, TimerKey>> = {
  走行中: 'driving',
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
}

const protectedOperationStatuses = new Set<OperationStatus>([
  '走行中',
  '待機中',
  '院内付き添い中',
  '精算前',
  '精算修正',
])

const createEmptyPaymentAmounts = (): Record<PaymentMethod, number> => ({
  QR決済: 0,
  その他: 0,
  クレジット: 0,
  現金: 0,
  請求書: 0,
})

const isProtectedOperationStatus = (value: unknown): value is OperationStatus =>
  typeof value === 'string' && protectedOperationStatuses.has(value as OperationStatus)

const toFiniteSnapshotNumber = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const normalizeSnapshotTimerSeconds = (value: unknown): TimerSeconds => {
  const source = value && typeof value === 'object' ? value as Partial<TimerSeconds> : {}

  return {
    accompanying: Math.max(Math.floor(toFiniteSnapshotNumber(source.accompanying)), 0),
    driving: Math.max(Math.floor(toFiniteSnapshotNumber(source.driving)), 0),
    waiting: Math.max(Math.floor(toFiniteSnapshotNumber(source.waiting)), 0),
  }
}

export const readActiveTripSnapshot = (): ActiveTripSnapshot | null => {
  try {
    const snapshotJson = localStorage.getItem(activeTripSnapshotStorageKey)

    if (!snapshotJson) {
      return null
    }

    const snapshot = JSON.parse(snapshotJson) as Partial<ActiveTripSnapshot>

    if (!isProtectedOperationStatus(snapshot.status)) {
      return null
    }

    return {
      activeTimer: snapshot.activeTimer ?? activeTimerMap[snapshot.status] ?? null,
      activityHistories: Array.isArray(snapshot.activityHistories)
        ? snapshot.activityHistories.filter((entry): entry is ActivityHistoryEntry =>
            Boolean(
              entry &&
              typeof entry === 'object' &&
              typeof (entry as ActivityHistoryEntry).id === 'string' &&
              ((entry as ActivityHistoryEntry).type === 'waiting' || (entry as ActivityHistoryEntry).type === 'accompanying') &&
              typeof (entry as ActivityHistoryEntry).startAt === 'string' &&
              typeof (entry as ActivityHistoryEntry).endAt === 'string',
            ),
          )
        : [],
      billableTimeStarted: {
        accompanying: Boolean(snapshot.billableTimeStarted?.accompanying),
        waiting: Boolean(snapshot.billableTimeStarted?.waiting),
      },
      caseNumber: typeof snapshot.caseNumber === 'string' && snapshot.caseNumber
        ? snapshot.caseNumber
        : '未採番',
      caseNumberAssignment: snapshot.caseNumberAssignment ?? null,
      capturedAt: typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : '',
      distances: {
        businessDistanceKm: Math.max(toFiniteSnapshotNumber(snapshot.distances?.businessDistanceKm), 0),
        chargeableDistanceKm: Math.max(toFiniteSnapshotNumber(snapshot.distances?.chargeableDistanceKm), 0),
      },
      dropoffLocation: snapshot.dropoffLocation ?? emptyCapturedAddressLocation,
      fareSnapshot: snapshot.fareSnapshot ?? null,
      fareTotalYen: Math.max(Math.round(toFiniteSnapshotNumber(snapshot.fareTotalYen)), 0),
      gps: {
        currentSpeedKmh: snapshot.gps?.currentSpeedKmh ?? null,
        gpsLogCount: Math.max(Math.floor(toFiniteSnapshotNumber(snapshot.gps?.gpsLogCount)), 0),
        lowSpeedSeconds: Math.max(Math.floor(toFiniteSnapshotNumber(snapshot.gps?.lowSpeedSeconds)), 0),
        movementState: snapshot.gps?.movementState ?? 'unknown',
        position: snapshot.gps?.position ?? null,
        speedSource: snapshot.gps?.speedSource ?? 'unavailable',
      },
      isDisabilityDiscount: Boolean(snapshot.isDisabilityDiscount),
      operationEndedAt: typeof snapshot.operationEndedAt === 'string' ? snapshot.operationEndedAt : '',
      operationStartedAt: typeof snapshot.operationStartedAt === 'string' ? snapshot.operationStartedAt : '',
      paymentAmounts: snapshot.paymentAmounts ?? createEmptyPaymentAmounts(),
      paymentMethod: snapshot.paymentMethod ?? '現金',
      pickupLocation: snapshot.pickupLocation ?? emptyCapturedAddressLocation,
      selectedCareOptions: Array.isArray(snapshot.selectedCareOptions) ? snapshot.selectedCareOptions : [],
      selectedDispatchCharges: Array.isArray(snapshot.selectedDispatchCharges) ? snapshot.selectedDispatchCharges : [],
      selectedExpenses: Array.isArray(snapshot.selectedExpenses) ? snapshot.selectedExpenses : [],
      selectedSpecialVehicleCharges: Array.isArray(snapshot.selectedSpecialVehicleCharges) ? snapshot.selectedSpecialVehicleCharges : [],
      selectedVehicleId: typeof snapshot.selectedVehicleId === 'string' ? snapshot.selectedVehicleId : '',
      status: snapshot.status,
      taxiTickets: Array.isArray(snapshot.taxiTickets) ? snapshot.taxiTickets : [],
      timers: normalizeSnapshotTimerSeconds(snapshot.timers),
    }
  } catch (error) {
    console.warn('Failed to read active trip snapshot.', error)
    return null
  }
}

export const saveActiveTripSnapshot = (snapshot: ActiveTripSnapshot) => {
  try {
    localStorage.setItem(activeTripSnapshotStorageKey, JSON.stringify(snapshot))
  } catch (error) {
    console.warn('Failed to save active trip snapshot.', error)
  }
}

export const clearActiveTripSnapshot = () => {
  try {
    localStorage.removeItem(activeTripSnapshotStorageKey)
  } catch (error) {
    console.warn('Failed to clear active trip snapshot.', error)
  }
}

export const getActiveTripSnapshotElapsedSeconds = (
  snapshot: ActiveTripSnapshot,
  nowMs = Date.now(),
) => {
  const capturedAtMs = new Date(snapshot.capturedAt).getTime()

  if (!Number.isFinite(capturedAtMs)) {
    return 0
  }

  return Math.max(Math.floor((nowMs - capturedAtMs) / 1000), 0)
}

export const applyElapsedSecondsToActiveTimer = (
  snapshot: ActiveTripSnapshot,
  elapsedSeconds: number,
): ActiveTripSnapshot => {
  if (!snapshot.activeTimer || elapsedSeconds <= 0) {
    return snapshot
  }

  return {
    ...snapshot,
    capturedAt: new Date().toISOString(),
    timers: {
      ...snapshot.timers,
      [snapshot.activeTimer]: snapshot.timers[snapshot.activeTimer] + elapsedSeconds,
    },
  }
}
