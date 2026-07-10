import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fareMasterService from './fareMasterService'
import { resolveTripFareForMeter } from './fareMasterTripResolver'

function mockLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

const reservationContext = {
  reservationId: 'r-1',
  estimateNo: 'e-1',
  confirmedFareYen: 7700,
  fixedFareTotalYen: 6600,
  snapshotHash: '',
  consentAt: '',
  pickupAddress: '',
  dropoffAddress: '',
  usageSummary: [],
  quoteSnapshot: {
    fixedFareTotal: 6600,
    serviceFees: [{ key: 'assistanceFee', amount: 1100 }],
    fareMasterId: 'fmv-headquarters-v1',
    fareMode: 'distance_time',
    selectedRouteId: '',
    selectedUsesToll: false,
    distanceMeters: 0,
    durationSeconds: 0,
    preFixedFareConfirmable: false,
  },
  routePlan: null,
  consent: {
    consentAt: '',
    consentTextVersion: '',
    snapshotHash: '',
    quotedFareYen: 7700,
    source: '',
  },
  customerName: '',
  scheduledAt: '',
} as const

const activePayload = {
  fareMasterId: 'fmv-headquarters-v1',
  fareVersionId: 'fmv-headquarters-v1',
  fareVersion: 'v1',
  fareSource: 'active_master',
  meterSettings: {
    basicFare: {
      initialDistanceKm: 1.06,
      initialFareYen: 520,
      additionalDistanceKm: 0.212,
      additionalFareYen: 100,
    },
    waitingFare: { unitSeconds: 1800, unitFareYen: 800 },
    escortFare: { unitSeconds: 1800, unitFareYen: 1600 },
    timeMeter: { baseAmountYen: 4180 },
    assistItems: [],
    dispatchMenuItems: [],
    specialVehicleMenuItems: [],
  },
  calculationRules: {},
  fareSnapshot: { fareMasterId: 'fmv-headquarters-v1', capturedAt: '2026-07-10T00:00:00.000Z' },
}

describe('resolveTripFareForMeter proxy flow', () => {
  beforeEach(() => {
    mockLocalStorage()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses active_master when proxy fetch succeeds', async () => {
    vi.spyOn(fareMasterService, 'fetchActiveFareMaster').mockResolvedValue(activePayload)

    const resolved = await resolveTripFareForMeter({ preferReservationSnapshot: false })

    expect(resolved.meta.fareSource).toBe('active_master')
    expect(resolved.meta.fareMasterId).toBe('fmv-headquarters-v1')
    expect(resolved.pricing.waitingFare.unitFareYen).toBe(800)
  })

  it('falls back to cached_master when proxy fetch fails', async () => {
    localStorage.setItem(
      'careTaxiMeterFareMasterCache::',
      JSON.stringify({ fetchedAt: Date.now(), data: activePayload }),
    )
    vi.spyOn(fareMasterService, 'fetchActiveFareMaster').mockRejectedValue(new Error('fare master HTTP 500'))

    const resolved = await resolveTripFareForMeter({ preferReservationSnapshot: false })

    expect(resolved.meta.fareSource).toBe('cached_master')
    expect(resolved.meta.fareMasterId).toBe('fmv-headquarters-v1')
  })

  it('falls back to system_fallback when proxy and cache are unavailable', async () => {
    vi.spyOn(fareMasterService, 'fetchActiveFareMaster').mockRejectedValue(new Error('fare master HTTP 401'))

    const resolved = await resolveTripFareForMeter({ preferReservationSnapshot: false })

    expect(resolved.meta.fareSource).toBe('system_fallback')
    expect(resolved.meta.fareMasterId).toBeNull()
    expect(resolved.pricing.waitingFare.unitFareYen).toBe(800)
  })

  it('keeps reservation_snapshot meta without calling fare master API', async () => {
    const fetchSpy = vi.spyOn(fareMasterService, 'fetchActiveFareMaster')

    const resolved = await resolveTripFareForMeter({
      reservationContext,
      preferReservationSnapshot: true,
    })

    expect(resolved.meta.fareSource).toBe('reservation_snapshot')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resolved.meta.fareMasterId).toBe('fmv-headquarters-v1')
  })

  it('captures effectiveFareSnapshot from active master payload', async () => {
    vi.spyOn(fareMasterService, 'fetchActiveFareMaster').mockResolvedValue(activePayload)

    const resolved = await resolveTripFareForMeter({ preferReservationSnapshot: false })

    expect(resolved.meta.fareSource).toBe('active_master')
    expect(resolved.meta.effectiveFareSnapshot).toEqual(activePayload.fareSnapshot)
  })
})
