import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeTripSnapshotStorageKey,
  inferSnapshotMeterMode,
  readActiveTripSnapshot,
  saveActiveTripSnapshot,
} from './services/activeTripSnapshot'
import type { ReservationTripContext } from './services/reservationTripContext'

const createLocalStorageMock = () => {
  let store: Record<string, string> = {}

  return {
    clear: () => {
      store = {}
    },
    getItem: (key: string) => store[key] ?? null,
    removeItem: (key: string) => {
      delete store[key]
    },
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  }
}

const embeddedContext: ReservationTripContext = {
  reservationId: 'res-embedded',
  estimateNo: 'EST-1',
  confirmedFareYen: 10000,
  fixedFareTotalYen: 13100,
  snapshotHash: 'hash-1',
  consentAt: '2026-07-09T03:00:00+09:00',
  pickupAddress: '千葉市中央区',
  dropoffAddress: '千葉市若葉区',
  usageSummary: [],
  quoteSnapshot: {
    fixedFareTotal: 10000,
    serviceFees: [],
    fareMode: 'pre_fixed_fare',
    selectedRouteId: 'A',
    selectedUsesToll: false,
    distanceMeters: 0,
    durationSeconds: 0,
    preFixedFareConfirmable: true,
  },
  routePlan: null,
  consent: {
    consentAt: '2026-07-09T03:00:00+09:00',
    consentTextVersion: 'v1',
    snapshotHash: 'hash-1',
    quotedFareYen: 13100,
    source: 'reservation',
  },
  customerName: 'テスト太郎',
  scheduledAt: '2026-07-09T06:00:00+09:00',
}

describe('inferSnapshotMeterMode', () => {
  it('infers fixed mode from legacy reservation fields', () => {
    expect(
      inferSnapshotMeterMode({
        reservationId: 'res-legacy',
        confirmedFareYen: 13100,
      }),
    ).toBe('fixed')
  })
})

describe('readActiveTripSnapshot', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
  })

  afterEach(() => {
    localStorage.removeItem(activeTripSnapshotStorageKey)
    vi.unstubAllGlobals()
  })

  it('restores embedded reservation trip context from localStorage', () => {
    saveActiveTripSnapshot({
      activeTimer: 'waiting',
      activityHistories: [],
      billableTimeStarted: { accompanying: false, waiting: true },
      caseNumber: 'CASE-1',
      caseNumberAssignment: null,
      capturedAt: '2026-07-09T04:00:00.000Z',
      distances: { businessDistanceKm: 0, chargeableDistanceKm: 0 },
      dropoffLocation: {
        address: '千葉市若葉区',
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
        address: '千葉市中央区',
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
      status: '待機中',
      meterMode: 'fixed',
      reservationTripContext: embeddedContext,
      taxiTickets: [],
      timers: { accompanying: 0, driving: 0, waiting: 0 },
    })

    const restored = readActiveTripSnapshot()
    expect(restored?.meterMode).toBe('fixed')
    expect(restored?.reservationTripContext?.reservationId).toBe('res-embedded')
    expect(restored?.reservationId).toBe('res-embedded')
  })
})
