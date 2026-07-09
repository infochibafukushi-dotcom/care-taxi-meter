import type { TimerSeconds } from '../hooks/useOperationTimers'
import type { CaseNumberAssignment, FareSnapshot } from './caseRecords'
import type { ReservationTripContext } from './reservationTripContext'
import type {
  ExpenseItem,
  ActivityHistoryEntry,
  GpsPosition,
  MeterMode,
  MeterMovementState,
  OperationStatus,
  PaymentMethod,
  SelectedCareOption,
  CustomFeeItem,
  TaxiTicket,
  TimerKey,
} from '../types/case'
import {
  mapPreFixedFareExceptionFromApi,
  type PreFixedFareException,
} from '../types/preFixedFare'
import type {
  PreFixedFareRouteChangeLog,
  PreFixedFareRouteStop,
} from '../types/preFixedFareRouteChange'
import { parseMeterModeParam } from '../utils/meterConstants'
import { normalizeReservationTripContext } from './reservationTripContext'
import {
  emptyCapturedAddressLocation,
  type CapturedAddressLocation,
} from '../utils/reverseGeocode'
import {
  createEmptyPaymentAmounts,
  isProtectedOperationStatus,
} from '../utils/meterConstants'

export const activeTripSnapshotStorageKey = 'careTaxiMeterActiveTripSnapshot'

/** Absolute start times for the currently open timer segments. */
export type TimerStartedAtMap = Partial<Record<'waiting' | 'accompanying' | 'driving', string>>

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
  customFees: CustomFeeItem[]
  selectedDispatchCharges: SelectedCareOption[]
  selectedExpenses: ExpenseItem[]
  selectedSpecialVehicleCharges: SelectedCareOption[]
  selectedVehicleId: string
  status: OperationStatus
  meterMode: MeterMode
  reservationId?: string
  confirmedFareYen?: number
  snapshotHash?: string
  additionalRouteFareYen?: number
  additionalCareFareYen?: number
  routeChangeLogs?: PreFixedFareRouteChangeLog[]
  preFixedOverallStops?: PreFixedFareRouteStop[]
  preFixedSegmentIndex?: number
  /** 旅客都合変更による途中終了（精算前） */
  preFixedFareException?: PreFixedFareException | null
  /** 事前確定M: 予約連携コンテキスト（復元時の sessionStorage 欠落対策） */
  reservationTripContext?: ReservationTripContext
  /** Start timestamps for open waiting / accompanying / driving segments. */
  timerStartedAt?: TimerStartedAtMap
  taxiTickets: TaxiTicket[]
  timers: TimerSeconds
}

type ActivityTimerKey = 'waiting' | 'accompanying'

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

const isValidIsoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Number.isFinite(new Date(value).getTime())

export const normalizeTimerStartedAt = (value: unknown): TimerStartedAtMap => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const source = value as Partial<Record<string, unknown>>
  const result: TimerStartedAtMap = {}

  for (const key of ['waiting', 'accompanying', 'driving'] as const) {
    if (isValidIsoTimestamp(source[key])) {
      result[key] = source[key]
    }
  }

  return result
}

export const calculateClosedActivitySeconds = (
  histories: ActivityHistoryEntry[],
  type: ActivityTimerKey,
) =>
  histories
    .filter((history) => history.type === type && history.startAt && history.endAt)
    .reduce((totalSeconds, history) => {
      const startAt = new Date(history.startAt).getTime()
      const endAt = new Date(history.endAt).getTime()
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        return totalSeconds
      }
      return totalSeconds + Math.floor((endAt - startAt) / 1000)
    }, 0)

export const getIsoElapsedSeconds = (iso: string, nowMs = Date.now()) => {
  const startedAtMs = new Date(iso).getTime()
  if (!Number.isFinite(startedAtMs)) {
    return 0
  }
  return Math.max(Math.floor((nowMs - startedAtMs) / 1000), 0)
}

const isActivityTimerKey = (value: TimerKey | null | undefined): value is ActivityTimerKey =>
  value === 'waiting' || value === 'accompanying'

export const inferSnapshotMeterMode = (
  snapshot: Partial<ActiveTripSnapshot>,
): MeterMode => {
  const explicit = parseMeterModeParam(snapshot.meterMode)
  if (explicit) {
    return explicit
  }

  if (
    snapshot.reservationTripContext ||
    (typeof snapshot.reservationId === 'string' && snapshot.reservationId.trim()) ||
    typeof snapshot.confirmedFareYen === 'number'
  ) {
    return 'fixed'
  }

  return 'gps'
}

export const readActiveTripSnapshot = (): ActiveTripSnapshot | null => {
  try {
    const snapshotJson = localStorage.getItem(activeTripSnapshotStorageKey)

    if (!snapshotJson) {
      return null
    }

    const snapshot = JSON.parse(snapshotJson) as Partial<ActiveTripSnapshot>
    const meterMode = inferSnapshotMeterMode(snapshot)

    if (!isProtectedOperationStatus(snapshot.status)) {
      return null
    }

    const reservationTripContext = normalizeReservationTripContext(snapshot.reservationTripContext)

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
      customFees: Array.isArray(snapshot.customFees) ? snapshot.customFees : [],
      selectedDispatchCharges: Array.isArray(snapshot.selectedDispatchCharges) ? snapshot.selectedDispatchCharges : [],
      selectedExpenses: Array.isArray(snapshot.selectedExpenses) ? snapshot.selectedExpenses : [],
      selectedSpecialVehicleCharges: Array.isArray(snapshot.selectedSpecialVehicleCharges) ? snapshot.selectedSpecialVehicleCharges : [],
      selectedVehicleId: typeof snapshot.selectedVehicleId === 'string' ? snapshot.selectedVehicleId : '',
      status: snapshot.status,
      meterMode,
      reservationId:
        typeof snapshot.reservationId === 'string' && snapshot.reservationId.trim()
          ? snapshot.reservationId.trim()
          : reservationTripContext?.reservationId,
      confirmedFareYen:
        typeof snapshot.confirmedFareYen === 'number' && Number.isFinite(snapshot.confirmedFareYen)
          ? Math.max(Math.round(snapshot.confirmedFareYen), 0)
          : undefined,
      snapshotHash:
        typeof snapshot.snapshotHash === 'string' && snapshot.snapshotHash.trim()
          ? snapshot.snapshotHash.trim()
          : undefined,
      additionalRouteFareYen:
        typeof snapshot.additionalRouteFareYen === 'number' &&
        Number.isFinite(snapshot.additionalRouteFareYen)
          ? Math.max(Math.round(snapshot.additionalRouteFareYen), 0)
          : undefined,
      additionalCareFareYen:
        typeof snapshot.additionalCareFareYen === 'number' &&
        Number.isFinite(snapshot.additionalCareFareYen)
          ? Math.max(Math.round(snapshot.additionalCareFareYen), 0)
          : undefined,
      routeChangeLogs: Array.isArray(snapshot.routeChangeLogs)
        ? snapshot.routeChangeLogs
        : undefined,
      preFixedOverallStops: Array.isArray(snapshot.preFixedOverallStops)
        ? snapshot.preFixedOverallStops
        : undefined,
      preFixedSegmentIndex:
        typeof snapshot.preFixedSegmentIndex === 'number' &&
        Number.isFinite(snapshot.preFixedSegmentIndex)
          ? Math.max(Math.floor(snapshot.preFixedSegmentIndex), 0)
          : undefined,
      preFixedFareException: mapPreFixedFareExceptionFromApi(snapshot.preFixedFareException),
      reservationTripContext: reservationTripContext ?? undefined,
      timerStartedAt: normalizeTimerStartedAt(snapshot.timerStartedAt),
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

/**
 * Restore open timer segments after browser/app restart.
 * Waiting / accompanying prefer absolute timerStartedAt over capturedAt.
 * GPS/OBD distances are never modified here.
 */
export const applyActiveTripRestoration = (
  snapshot: ActiveTripSnapshot,
  shouldApplyOfflineElapsed: boolean,
  nowMs = Date.now(),
): ActiveTripSnapshot => {
  const nowIso = new Date(nowMs).toISOString()
  const activeTimer = snapshot.activeTimer

  if (isActivityTimerKey(activeTimer)) {
    const startedAt = snapshot.timerStartedAt?.[activeTimer]
    const closedSeconds = calculateClosedActivitySeconds(snapshot.activityHistories, activeTimer)

    if (startedAt) {
      if (shouldApplyOfflineElapsed) {
        const segmentSeconds = getIsoElapsedSeconds(startedAt, nowMs)
        return {
          ...snapshot,
          capturedAt: nowIso,
          timers: {
            ...snapshot.timers,
            [activeTimer]: closedSeconds + segmentSeconds,
          },
        }
      }

      // Decline offline time: keep only the segment until last save, then restart from now.
      const capturedAt = snapshot.capturedAt || nowIso
      const capturedAtMs = new Date(capturedAt).getTime()
      const startedAtMs = new Date(startedAt).getTime()
      const segmentUntilSave =
        Number.isFinite(startedAtMs) && Number.isFinite(capturedAtMs) && capturedAtMs > startedAtMs
          ? Math.floor((capturedAtMs - startedAtMs) / 1000)
          : 0

      const activityHistories =
        segmentUntilSave > 0
          ? [
              ...snapshot.activityHistories,
              {
                endAt: capturedAt,
                id: `frozen-${activeTimer}-${nowMs}`,
                startAt: startedAt,
                type: activeTimer,
              },
            ]
          : snapshot.activityHistories

      return {
        ...snapshot,
        activityHistories,
        capturedAt: nowIso,
        timerStartedAt: {
          ...snapshot.timerStartedAt,
          [activeTimer]: nowIso,
        },
        timers: {
          ...snapshot.timers,
          [activeTimer]: closedSeconds + segmentUntilSave,
        },
      }
    }

    // Legacy snapshots without timerStartedAt: fall back to capturedAt delta.
    if (shouldApplyOfflineElapsed) {
      const elapsedSeconds = getActiveTripSnapshotElapsedSeconds(snapshot, nowMs)
      return applyElapsedSecondsToActiveTimer(snapshot, elapsedSeconds)
    }

    return {
      ...snapshot,
      capturedAt: nowIso,
    }
  }

  if (activeTimer && shouldApplyOfflineElapsed) {
    const elapsedSeconds = getActiveTripSnapshotElapsedSeconds(snapshot, nowMs)
    return applyElapsedSecondsToActiveTimer(snapshot, elapsedSeconds)
  }

  return {
    ...snapshot,
    capturedAt: nowIso,
  }
}
