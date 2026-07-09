import { activeTripSnapshotStorageKey } from '../services/activeTripSnapshot'
import { preFixedMeterSessionStorageKey } from '../services/preFixedMeterSession'
import { reservationTripContextStorageKey } from '../services/reservationTripContext'
import {
  reviewDemoActiveTripSnapshotStorageKey,
  reviewDemoPostSettlementLockStorageKey,
  reviewDemoReservationTripContextStorageKey,
} from '../services/reviewDemoStorage'

const LOCAL_STORAGE_KEYS = [
  activeTripSnapshotStorageKey,
  reviewDemoActiveTripSnapshotStorageKey,
  'careTaxiMeterInputHistory',
] as const

const SESSION_STORAGE_KEYS = [
  reservationTripContextStorageKey,
  preFixedMeterSessionStorageKey,
  reviewDemoReservationTripContextStorageKey,
  reviewDemoPostSettlementLockStorageKey,
  'careTaxiMeterPostSettlementLock',
  'careTaxiMeterReviewDemoRunState',
] as const

/**
 * Clears operational temporary data on the current device.
 * Does not remove auth session, meter/printer/obd settings, or admin credentials.
 */
export function clearPreOpeningLocalDeviceData() {
  if (typeof window === 'undefined') {
    return
  }

  LOCAL_STORAGE_KEYS.forEach((key) => {
    window.localStorage.removeItem(key)
  })
  SESSION_STORAGE_KEYS.forEach((key) => {
    window.sessionStorage.removeItem(key)
  })
}
