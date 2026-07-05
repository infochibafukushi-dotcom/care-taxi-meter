import type { ActiveTripSnapshot } from './activeTripSnapshot'
import type { ReservationTripContext } from './reservationTripContext'
import { REVIEW_DEMO_RESERVATION_ID } from '../utils/reviewDemo'

export const reviewDemoReservationTripContextStorageKey =
  'careTaxiMeterReviewDemoReservationContext'

export const reviewDemoActiveTripSnapshotStorageKey =
  'careTaxiMeterReviewDemoTripSnapshot'

export const reviewDemoPostSettlementLockStorageKey =
  'careTaxiMeterReviewDemoPostSettlementLock'

export type ReviewDemoPostSettlementLock = {
  caseNumber: string
  lockedAt: string
}

const isReservationTripContext = (value: unknown): value is ReservationTripContext => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const context = value as Partial<ReservationTripContext>
  return (
    typeof context.reservationId === 'string' &&
    context.reservationId.trim().length > 0 &&
    typeof context.confirmedFareYen === 'number' &&
    typeof context.snapshotHash === 'string' &&
    typeof context.pickupAddress === 'string' &&
    typeof context.dropoffAddress === 'string'
  )
}

export const saveReviewDemoReservationTripContext = (context: ReservationTripContext) => {
  sessionStorage.setItem(reviewDemoReservationTripContextStorageKey, JSON.stringify(context))
}

export const readReviewDemoReservationTripContext = (
  reservationId = REVIEW_DEMO_RESERVATION_ID,
): ReservationTripContext | null => {
  try {
    const stored = sessionStorage.getItem(reviewDemoReservationTripContextStorageKey)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored) as unknown
    if (!isReservationTripContext(parsed)) {
      return null
    }

    if (parsed.reservationId !== reservationId) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export const clearReviewDemoReservationTripContext = () => {
  sessionStorage.removeItem(reviewDemoReservationTripContextStorageKey)
}

export const saveReviewDemoActiveTripSnapshot = (snapshot: ActiveTripSnapshot) => {
  localStorage.setItem(reviewDemoActiveTripSnapshotStorageKey, JSON.stringify(snapshot))
}

export const readReviewDemoActiveTripSnapshot = (): ActiveTripSnapshot | null => {
  try {
    const stored = localStorage.getItem(reviewDemoActiveTripSnapshotStorageKey)
    if (!stored) {
      return null
    }

    return JSON.parse(stored) as ActiveTripSnapshot
  } catch {
    return null
  }
}

export const clearReviewDemoActiveTripSnapshot = () => {
  localStorage.removeItem(reviewDemoActiveTripSnapshotStorageKey)
}

export const writeReviewDemoPostSettlementLock = (caseNumber: string) => {
  const lock: ReviewDemoPostSettlementLock = {
    caseNumber,
    lockedAt: new Date().toISOString(),
  }
  sessionStorage.setItem(reviewDemoPostSettlementLockStorageKey, JSON.stringify(lock))
}

export const readReviewDemoPostSettlementLock = (): ReviewDemoPostSettlementLock | null => {
  try {
    const stored = sessionStorage.getItem(reviewDemoPostSettlementLockStorageKey)
    if (!stored) {
      return null
    }

    return JSON.parse(stored) as ReviewDemoPostSettlementLock
  } catch {
    return null
  }
}

export const clearReviewDemoPostSettlementLock = () => {
  sessionStorage.removeItem(reviewDemoPostSettlementLockStorageKey)
}

export const clearReviewDemoSessionState = () => {
  clearReviewDemoReservationTripContext()
  clearReviewDemoActiveTripSnapshot()
  clearReviewDemoPostSettlementLock()
}
