import type { DriverReservationDetail, DriverReservationSummary } from '../types/reservation'
import type { ReservationTripContext } from '../services/reservationTripContext'
import { buildReservationTripContext } from '../services/reservationTripContext'
import {
  REVIEW_DEMO_DESTINATION_ADDRESS,
  REVIEW_DEMO_PICKUP_ADDRESS,
  REVIEW_DEMO_RESERVATION_ID,
} from '../utils/reviewDemo'

export const REVIEW_DEMO_SCHEDULED_AT = '2026-09-01T10:00:00+09:00'
const REVIEW_DEMO_FARE_LOCKED_AT = '2026-08-25T15:30:00+09:00'
const REVIEW_DEMO_CONSENT_AT = '2026-08-25T15:35:00+09:00'
const REVIEW_DEMO_SNAPSHOT_HASH = 'review-demo-snapshot-hash-pf-review-001'

const REVIEW_DEMO_FIXED_FARE_TOTAL_YEN = 2640
export const REVIEW_DEMO_ASSIST_FEE_YEN = 1100
export const REVIEW_DEMO_PRE_FIXED_FARE_YEN = 3740
const REVIEW_DEMO_CONFIRMED_FARE_YEN = REVIEW_DEMO_PRE_FIXED_FARE_YEN
export const REVIEW_DEMO_TOTAL_FARE_YEN = 4840
const REVIEW_DEMO_TOTAL_YEN = REVIEW_DEMO_TOTAL_FARE_YEN

export const reviewDemoPreFixedFareReservationDetail: DriverReservationDetail = {
  reservationId: REVIEW_DEMO_RESERVATION_ID,
  estimateNo: 'REVIEW-DEMO-001',
  status: 'active',
  meterRunStatus: 'not_started',
  scheduledAt: REVIEW_DEMO_SCHEDULED_AT,
  customer: {
    name: '審査用デモ',
    kana: 'シンサヨウデモ',
    phone: '043-000-0000',
    email: 'review-demo@example.com',
  },
  trip: {
    date: '2026-09-01',
    time: '10:00',
    pickupAddress: REVIEW_DEMO_PICKUP_ADDRESS,
    destinationAddress: REVIEW_DEMO_DESTINATION_ADDRESS,
    vehicle: '一般車',
    usageSummary: ['事前確定運賃'],
    notes: '審査用デモ予約',
  },
  fixedFare: {
    confirmedFareYen: REVIEW_DEMO_CONFIRMED_FARE_YEN,
    fixedFareTotalYen: REVIEW_DEMO_FIXED_FARE_TOTAL_YEN,
    fareType: '事前確定運賃',
    fareLockedAt: REVIEW_DEMO_FARE_LOCKED_AT,
    selectedRouteId: 'review-demo-route',
    selectedOverallRouteId: 'review-demo-overall-route',
    useToll: false,
    preFixedFareConfirmable: true,
  },
  consent: {
    consentAt: REVIEW_DEMO_CONSENT_AT,
    consentTextVersion: 'review-demo-v1',
    snapshotHash: REVIEW_DEMO_SNAPSHOT_HASH,
    quotedFareYen: REVIEW_DEMO_CONFIRMED_FARE_YEN,
    source: 'review-demo',
  },
  quoteSnapshot: {
    fixedFareTotal: REVIEW_DEMO_FIXED_FARE_TOTAL_YEN,
    serviceFees: [
      {
        key: 'assistFee',
        label: '介助料金',
        amount: REVIEW_DEMO_ASSIST_FEE_YEN,
      },
    ],
    fareMode: 'pre_fixed',
    selectedRouteId: 'review-demo-route',
    selectedUsesToll: false,
    distanceMeters: 8200,
    durationSeconds: 1200,
    preFixedFareConfirmable: true,
  },
  routePlan: {
    stops: [
      {
        id: 'review-demo-pickup',
        role: 'S',
        label: '乗車地',
        address: REVIEW_DEMO_PICKUP_ADDRESS,
        lat: 35.5774,
        lng: 140.1225,
      },
      {
        id: 'review-demo-destination',
        role: 'G',
        label: '目的地',
        address: REVIEW_DEMO_DESTINATION_ADDRESS,
        lat: 35.6328,
        lng: 140.1532,
      },
    ],
  },
  integrity: {
    snapshotHash: REVIEW_DEMO_SNAPSHOT_HASH,
    computedSnapshotHash: REVIEW_DEMO_SNAPSHOT_HASH,
    snapshotHashVerified: true,
    confirmedFareMatchesSnapshot: true,
    consentSnapshotHashMatches: true,
  },
  franchiseeId: 'review-demo-company',
  storeId: 'review-demo-store',
  snapshotHashVerified: true,
  fareMatch: true,
  fixedFareCompletionStatus: null,
  fixedFareCompletionReason: null,
  preFixedFareException: null,
}

export const reviewDemoPreFixedFareReservationSummary: DriverReservationSummary = {
  reservationId: REVIEW_DEMO_RESERVATION_ID,
  estimateNo: 'REVIEW-DEMO-001',
  status: 'active',
  meterRunStatus: 'not_started',
  scheduledAt: REVIEW_DEMO_SCHEDULED_AT,
  date: '2026-09-01',
  time: '10:00',
  customerName: '審査用デモ',
  customerPhone: '043-000-0000',
  pickupAddress: REVIEW_DEMO_PICKUP_ADDRESS,
  destinationAddress: REVIEW_DEMO_DESTINATION_ADDRESS,
  confirmedFareYen: REVIEW_DEMO_CONFIRMED_FARE_YEN,
  fixedFareTotalYen: REVIEW_DEMO_FIXED_FARE_TOTAL_YEN,
  fareType: '事前確定運賃',
  preFixedFareConfirmable: true,
  useToll: false,
  selectedRouteId: 'review-demo-route',
  consentAt: REVIEW_DEMO_CONSENT_AT,
  snapshotHash: REVIEW_DEMO_SNAPSHOT_HASH,
  franchiseeId: 'review-demo-company',
  storeId: 'review-demo-store',
}

export const reviewDemoConfirmedFareBreakdownTotalYen = REVIEW_DEMO_TOTAL_YEN

export const buildReviewDemoReservationTripContext = (): ReservationTripContext =>
  buildReservationTripContext(reviewDemoPreFixedFareReservationDetail)
