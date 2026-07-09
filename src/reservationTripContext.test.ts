import { describe, expect, it, vi } from 'vitest'
import type { ActiveTripSnapshot } from './services/activeTripSnapshot'
import {
  buildReservationTripContextFromActiveTripSnapshot,
  compactReservationTripContextForSnapshot,
  resolveReservationTripContextForCasePage,
  shouldRestoreFixedFareRunFromSnapshot,
} from './services/reservationTripContext'
import type { ReservationTripContext } from './services/reservationTripContext'

const baseSnapshot = (): ActiveTripSnapshot => ({
  activeTimer: null,
  activityHistories: [],
  billableTimeStarted: { accompanying: false, waiting: false },
  caseNumber: 'CASE-001',
  caseNumberAssignment: null,
  capturedAt: '2026-07-09T04:00:00.000Z',
  distances: { businessDistanceKm: 0, chargeableDistanceKm: 0 },
  dropoffLocation: {
    address: '千葉市若葉区 テスト目的地',
    capturedAt: null,
    latitude: null,
    longitude: null,
  },
  fareSnapshot: null,
  fareTotalYen: 13100,
  gps: {
    currentSpeedKmh: null,
    gpsLogCount: 0,
    lowSpeedSeconds: 0,
    movementState: 'stopped',
    position: null,
    speedSource: 'none',
  },
  isDisabilityDiscount: false,
  operationEndedAt: '',
  operationStartedAt: '',
  paymentAmounts: {
    QR決済: 0,
    その他: 0,
    クレジット: 0,
    現金: 0,
    請求書: 0,
  },
  paymentMethod: '現金',
  pickupLocation: {
    address: '千葉市中央区 テスト出発地',
    capturedAt: null,
    latitude: null,
    longitude: null,
  },
  selectedCareOptions: [],
  customFees: [],
  selectedDispatchCharges: [],
  selectedExpenses: [],
  selectedSpecialVehicleCharges: [],
  selectedVehicleId: 'vehicle-1',
  status: '空車',
  meterMode: 'fixed',
  taxiTickets: [],
  timers: { accompanying: 0, driving: 0, waiting: 0 },
})

const storedContext: ReservationTripContext = {
  reservationId: 'res-13100',
  estimateNo: 'EST-001',
  confirmedFareYen: 10000,
  fixedFareTotalYen: 13100,
  snapshotHash: 'hash-abc',
  consentAt: '2026-07-09T03:00:00+09:00',
  pickupAddress: '千葉市中央区 テスト出発地',
  dropoffAddress: '千葉市若葉区 テスト目的地',
  usageSummary: [],
  quoteSnapshot: {
    fixedFareTotal: 10000,
    serviceFees: [
      { key: 'assist', label: '追加介助料', amount: 3700 },
      { key: 'waiting', label: '待機料金', amount: 9100 },
      { key: 'escort', label: '付き添い料金', amount: 300 },
    ],
    fareMode: 'pre_fixed_fare',
    selectedRouteId: 'A',
    selectedUsesToll: false,
    distanceMeters: 1000,
    durationSeconds: 600,
    preFixedFareConfirmable: true,
  },
  routePlan: null,
  consent: {
    consentAt: '2026-07-09T03:00:00+09:00',
    consentTextVersion: 'v1',
    snapshotHash: 'hash-abc',
    quotedFareYen: 13100,
    source: 'reservation',
  },
  customerName: 'テスト太郎',
  scheduledAt: '2026-07-09T06:00:00+09:00',
}

describe('buildReservationTripContextFromActiveTripSnapshot', () => {
  it('reuses embedded reservation trip context when present', () => {
    const snapshot = {
      ...baseSnapshot(),
      reservationId: 'res-13100',
      reservationTripContext: storedContext,
    }

    expect(buildReservationTripContextFromActiveTripSnapshot(snapshot)).toEqual(storedContext)
  })

  it('builds minimal context from snapshot reservation fields', () => {
    const snapshot = {
      ...baseSnapshot(),
      reservationId: 'res-13100',
      confirmedFareYen: 10000,
      snapshotHash: 'hash-abc',
    }

    const context = buildReservationTripContextFromActiveTripSnapshot(snapshot)
    expect(context?.reservationId).toBe('res-13100')
    expect(context?.confirmedFareYen).toBe(10000)
    expect(context?.pickupAddress).toBe('千葉市中央区 テスト出発地')
    expect(context?.dropoffAddress).toBe('千葉市若葉区 テスト目的地')
  })
})

describe('resolveReservationTripContextForCasePage', () => {
  it('reads sessionStorage when restoring without query params', () => {
    const readStoredContext = vi.fn(() => storedContext)

    const resolved = resolveReservationTripContextForCasePage({
      restoredSnapshot: {
        ...baseSnapshot(),
        reservationId: 'res-13100',
      },
      readStoredContext,
    })

    expect(readStoredContext).toHaveBeenCalledWith()
    expect(resolved?.reservationId).toBe('res-13100')
    expect(resolved?.quoteSnapshot.serviceFees).toHaveLength(3)
  })

  it('falls back to snapshot when sessionStorage is empty', () => {
    const resolved = resolveReservationTripContextForCasePage({
      restoredSnapshot: {
        ...baseSnapshot(),
        reservationId: 'res-13100',
        confirmedFareYen: 10000,
        snapshotHash: 'hash-abc',
      },
      readStoredContext: () => null,
    })

    expect(resolved?.reservationId).toBe('res-13100')
    expect(resolved?.confirmedFareYen).toBe(10000)
  })
})

describe('compactReservationTripContextForSnapshot', () => {
  it('drops routePlan from persisted context', () => {
    const compacted = compactReservationTripContextForSnapshot({
      ...storedContext,
      routePlan: { geometry: 'large-payload' },
    })

    expect(compacted.routePlan).toBeNull()
    expect(compacted.reservationId).toBe(storedContext.reservationId)
    expect(compacted.quoteSnapshot.serviceFees).toHaveLength(3)
  })
})

describe('shouldRestoreFixedFareRunFromSnapshot', () => {
  it('restores fixed fare run only after the trip has entered a protected status', () => {
    expect(
      shouldRestoreFixedFareRunFromSnapshot({
        ...baseSnapshot(),
        reservationId: 'res-13100',
        status: '空車',
      }),
    ).toBe(false)

    expect(
      shouldRestoreFixedFareRunFromSnapshot({
        ...baseSnapshot(),
        reservationId: 'res-13100',
        status: '走行中',
      }),
    ).toBe(true)
  })
})
