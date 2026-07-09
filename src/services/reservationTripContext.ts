import type { ActiveTripSnapshot } from './activeTripSnapshot'
import type {
  DriverReservationDetail,
  QuoteSnapshot,
  ReservationConsent,
} from '../types/reservation'
import { isProtectedOperationStatus } from '../utils/meterConstants'
import { resolveReservationIsTest } from '../utils/testReservation'

export const reservationTripContextStorageKey = 'careTaxiMeterReservationTripContext'

export type ReservationTripContext = {
  reservationId: string
  estimateNo: string
  confirmedFareYen: number
  fixedFareTotalYen: number
  snapshotHash: string
  consentAt: string
  pickupAddress: string
  dropoffAddress: string
  isTest?: boolean
  /** 予約 trip.usageSummary（往復/片道判定に使用） */
  usageSummary: string[]
  quoteSnapshot: QuoteSnapshot
  routePlan: unknown | null
  consent: ReservationConsent
  customerName: string
  scheduledAt: string
}

export const buildReservationTripContext = (
  reservation: DriverReservationDetail,
): ReservationTripContext => ({
  reservationId: reservation.reservationId,
  estimateNo: reservation.estimateNo,
  isTest: resolveReservationIsTest(reservation),
  confirmedFareYen: reservation.fixedFare.confirmedFareYen,
  fixedFareTotalYen: reservation.fixedFare.fixedFareTotalYen,
  snapshotHash: reservation.consent.snapshotHash,
  consentAt: reservation.consent.consentAt,
  pickupAddress: reservation.trip.pickupAddress,
  dropoffAddress: reservation.trip.destinationAddress,
  usageSummary: Array.isArray(reservation.trip.usageSummary)
    ? reservation.trip.usageSummary
    : [],
  quoteSnapshot: reservation.quoteSnapshot,
  routePlan: reservation.routePlan,
  consent: reservation.consent,
  customerName: reservation.customer.name,
  scheduledAt: reservation.scheduledAt,
})

/** 既存の同意日時がある場合は上書きせず、未同意時のみ現場同意日時を付与する */
export const buildReservationTripContextForMeterStart = (
  reservation: DriverReservationDetail,
  consentChecked: boolean,
): ReservationTripContext => {
  const baseContext = buildReservationTripContext(reservation)
  const existingConsentAt = baseContext.consentAt.trim()

  if (existingConsentAt || !consentChecked) {
    return baseContext
  }

  const agreedAt = new Date().toISOString()
  return {
    ...baseContext,
    consentAt: agreedAt,
    consent: {
      ...baseContext.consent,
      consentAt: agreedAt,
    },
  }
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

export const saveReservationTripContext = (context: ReservationTripContext) => {
  try {
    sessionStorage.setItem(reservationTripContextStorageKey, JSON.stringify(context))
  } catch (error) {
    console.warn('Failed to save reservation trip context.', error)
  }
}

export const readReservationTripContext = (
  reservationId?: string,
): ReservationTripContext | null => {
  try {
    const stored = sessionStorage.getItem(reservationTripContextStorageKey)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored) as unknown
    if (!isReservationTripContext(parsed)) {
      return null
    }

    if (reservationId && parsed.reservationId !== reservationId) {
      return null
    }

    return parsed
  } catch (error) {
    console.warn('Failed to read reservation trip context.', error)
    return null
  }
}

export const clearReservationTripContext = () => {
  try {
    sessionStorage.removeItem(reservationTripContextStorageKey)
  } catch (error) {
    console.warn('Failed to clear reservation trip context.', error)
  }
}

const emptyQuoteSnapshot = (): QuoteSnapshot => ({
  fixedFareTotal: 0,
  serviceFees: [],
  fareMode: 'pre_fixed_fare',
  selectedRouteId: '',
  selectedUsesToll: false,
  distanceMeters: 0,
  durationSeconds: 0,
  preFixedFareConfirmable: true,
})

const emptyConsent = (): ReservationConsent => ({
  consentAt: '',
  consentTextVersion: '',
  snapshotHash: '',
  quotedFareYen: 0,
  source: '',
})

/** 運行スナップショットから最低限の予約連携コンテキストを再構築する */
export const buildReservationTripContextFromActiveTripSnapshot = (
  snapshot: ActiveTripSnapshot,
): ReservationTripContext | null => {
  if (snapshot.meterMode !== 'fixed') {
    return null
  }

  if (snapshot.reservationTripContext) {
    return snapshot.reservationTripContext
  }

  const reservationId = snapshot.reservationId?.trim() ?? ''
  if (!reservationId) {
    return null
  }

  const confirmedFareYen = Math.max(
    Math.round(snapshot.confirmedFareYen ?? snapshot.fareTotalYen ?? 0),
    0,
  )
  const pickupAddress = snapshot.pickupLocation?.address?.trim() ?? ''
  const dropoffAddress = snapshot.dropoffLocation?.address?.trim() ?? ''
  const snapshotHash = snapshot.snapshotHash?.trim() ?? ''

  return {
    reservationId,
    estimateNo: '',
    confirmedFareYen,
    fixedFareTotalYen: Math.max(Math.round(snapshot.fareTotalYen ?? confirmedFareYen), 0),
    snapshotHash,
    consentAt: '',
    pickupAddress,
    dropoffAddress,
    usageSummary: [],
    quoteSnapshot: {
      ...emptyQuoteSnapshot(),
      fixedFareTotal: confirmedFareYen,
      selectedRouteId: '',
    },
    routePlan: null,
    consent: {
      ...emptyConsent(),
      snapshotHash,
      quotedFareYen: confirmedFareYen,
    },
    customerName: '',
    scheduledAt: snapshot.capturedAt,
  }
}

export type ResolveReservationTripContextOptions = {
  reservationIdFromQuery?: string
  restoredSnapshot?: ActiveTripSnapshot | null
  readStoredContext?: typeof readReservationTripContext
}

/** メーター画面表示時に sessionStorage・復元スナップショットから予約連携を解決する */
export const resolveReservationTripContextForCasePage = ({
  reservationIdFromQuery = '',
  restoredSnapshot = null,
  readStoredContext = readReservationTripContext,
}: ResolveReservationTripContextOptions = {}): ReservationTripContext | null => {
  const queryReservationId = reservationIdFromQuery.trim()
  const snapshotReservationId = restoredSnapshot?.reservationId?.trim() ?? ''

  if (queryReservationId) {
    return (
      readStoredContext(queryReservationId) ??
      (restoredSnapshot ? buildReservationTripContextFromActiveTripSnapshot(restoredSnapshot) : null)
    )
  }

  const storedContext = readStoredContext()
  if (storedContext) {
    if (!snapshotReservationId || storedContext.reservationId === snapshotReservationId) {
      return storedContext
    }

    return (
      readStoredContext(snapshotReservationId) ??
      buildReservationTripContextFromActiveTripSnapshot(restoredSnapshot!)
    )
  }

  if (restoredSnapshot?.meterMode === 'fixed') {
    return buildReservationTripContextFromActiveTripSnapshot(restoredSnapshot)
  }

  return null
}

export const shouldRestoreFixedFareRunFromSnapshot = (snapshot: ActiveTripSnapshot) =>
  snapshot.meterMode === 'fixed' &&
  typeof snapshot.reservationId === 'string' &&
  snapshot.reservationId.trim().length > 0 &&
  isProtectedOperationStatus(snapshot.status)

/** localStorage 永続化向け。routePlan は preFixedOverallStops と重複し得るため除外する */
export const compactReservationTripContextForSnapshot = (
  context: ReservationTripContext,
): ReservationTripContext => ({
  ...context,
  routePlan: null,
})
