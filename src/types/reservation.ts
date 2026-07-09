/** reservation-v4 driver API raw response shapes (from production smoke samples). */

import type {
  CompletionReason,
  PreFixedFareCompletionStatus,
  PreFixedFareException,
} from './preFixedFare'

export type ReservationServiceFeeApi = {
  key: string
  label: string
  amount: number
}

export type ReservationCustomerApi = {
  name: string
  kana: string
  phone: string
  email: string
}

export type ReservationTripApi = {
  date: string
  time: string
  pickupAddress: string
  destinationAddress: string
  vehicle: string
  usageSummary: string[]
  notes: string
}

export type ReservationFixedFareApi = {
  confirmedFareYen: number
  fixedFareTotalYen: number
  fareType: string | null
  fareLockedAt: string | null
  selectedRouteId: string | null
  selectedOverallRouteId: string | null
  useToll: boolean
  preFixedFareConfirmable: boolean
}

export type ReservationConsentApi = {
  consentAt: string
  consentTextVersion: string
  snapshotHash: string
  quotedFareYen: number
  source: string
}

export type QuoteSnapshotApi = {
  fixedFareTotal: number
  serviceFees: ReservationServiceFeeApi[]
  fareMode: string
  selectedRouteId: string
  selectedUsesToll: boolean
  distanceMeters: number
  durationSeconds: number
  preFixedFareConfirmable: boolean
}

export type ReservationIntegrityApi = {
  snapshotHash: string | null
  computedSnapshotHash: string | null
  snapshotHashVerified: boolean
  confirmedFareMatchesSnapshot: boolean
  consentSnapshotHashMatches: boolean | null
}

export type DriverReservationListItemApi = {
  reservationId: string
  estimateNo: string | null
  status: string
  isTest?: boolean
  meterRunStatus: string
  scheduledAt: string
  date: string
  time: string
  customerName: string
  customerPhone: string
  pickupAddress: string
  destinationAddress: string
  confirmedFareYen: number
  fixedFareTotalYen: number
  fareType: string | null
  preFixedFareConfirmable: boolean
  useToll: boolean
  selectedRouteId: string | null
  consentAt: string | null
  snapshotHash: string | null
  franchiseeId: string | null
  storeId: string | null
}

export type DriverReservationDetailApi = {
  reservationId: string
  estimateNo: string | null
  status: string
  isTest?: boolean
  meterRunStatus: string
  scheduledAt: string
  customer: ReservationCustomerApi
  trip: ReservationTripApi
  fixedFare: ReservationFixedFareApi
  consent: ReservationConsentApi | null
  quoteSnapshot: QuoteSnapshotApi | null
  routePlan: unknown | null
  integrity: ReservationIntegrityApi
  franchiseeId: string | null
  storeId: string | null
  fixedFareCompletionStatus?: PreFixedFareCompletionStatus | string | null
  fixedFareCompletionReason?: CompletionReason | string | null
  preFixedFareException?: PreFixedFareException | Record<string, unknown> | null
}

export type DriverReservationsListResponseApi = {
  success: boolean
  date: string
  reservations: DriverReservationListItemApi[]
}

export type DriverReservationDetailResponseApi = {
  success: boolean
  reservation: DriverReservationDetailApi
}

/** Mapped view models consumed by pages. */

export type ReservationServiceFee = ReservationServiceFeeApi
export type ReservationCustomer = ReservationCustomerApi
export type ReservationTrip = ReservationTripApi
export type ReservationFixedFare = ReservationFixedFareApi
export type ReservationConsent = ReservationConsentApi
export type QuoteSnapshot = QuoteSnapshotApi
export type ReservationIntegrity = ReservationIntegrityApi

export type DriverReservationSummary = DriverReservationListItemApi

export type DriverReservationDetail = {
  reservationId: string
  estimateNo: string
  status: string
  isTest: boolean
  meterRunStatus: string
  scheduledAt: string
  customer: ReservationCustomer
  trip: ReservationTrip
  fixedFare: ReservationFixedFare
  consent: ReservationConsent
  quoteSnapshot: QuoteSnapshot
  routePlan: unknown | null
  integrity: ReservationIntegrity
  franchiseeId: string | null
  storeId: string | null
  snapshotHashVerified: boolean
  fareMatch: boolean
  fixedFareCompletionStatus: PreFixedFareCompletionStatus | string | null
  fixedFareCompletionReason: CompletionReason | string | null
  preFixedFareException: PreFixedFareException | null
}

export { isPreFixedFarePassengerChangeCompletion as isPreFixedFarePassengerChangeReservation } from './preFixedFare'

export const reservationStatusLabels: Record<string, string> = {
  active: '有効',
  test: 'テスト予約',
}

export const meterRunStatusLabels: Record<string, string> = {
  not_started: '未開始',
  in_progress: '運行中',
  completed: '完了',
}

export const formatReservationStatus = (status: string) =>
  reservationStatusLabels[status] ?? status

export const formatMeterRunStatus = (status: string) =>
  meterRunStatusLabels[status] ?? status
