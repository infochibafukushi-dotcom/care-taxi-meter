import type {
  DriverReservationDetail,
  QuoteSnapshot,
  ReservationConsent,
} from '../types/reservation'

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
  confirmedFareYen: reservation.fixedFare.confirmedFareYen,
  fixedFareTotalYen: reservation.fixedFare.fixedFareTotalYen,
  snapshotHash: reservation.consent.snapshotHash,
  consentAt: reservation.consent.consentAt,
  pickupAddress: reservation.trip.pickupAddress,
  dropoffAddress: reservation.trip.destinationAddress,
  quoteSnapshot: reservation.quoteSnapshot,
  routePlan: reservation.routePlan,
  consent: reservation.consent,
  customerName: reservation.customer.name,
  scheduledAt: reservation.scheduledAt,
})

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
