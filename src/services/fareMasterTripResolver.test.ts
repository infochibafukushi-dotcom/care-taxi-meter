/**
 * 運行時料金解決テスト
 */
import { describe, expect, it } from 'vitest'
import {
  buildReservationSnapshotMeta,
  mapFareMasterPayloadToPricing,
} from './fareMasterTripResolver'
import { basicFareSettings, waitingFareSettings } from './fare'

describe('fareMasterTripResolver', () => {
  it('prefers reservation snapshot meta over active master', () => {
    const meta = buildReservationSnapshotMeta({
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
    })
    expect(meta?.fareSource).toBe('reservation_snapshot')
    expect(meta?.fareMasterId).toBe('fmv-headquarters-v1')
    expect(meta?.effectiveFareSnapshot).toMatchObject({
      quoteSnapshot: expect.objectContaining({ fixedFareTotal: 6600 }),
    })
  })

  it('maps D1 meter payload to pricing', () => {
    const pricing = mapFareMasterPayloadToPricing({
      fareMasterId: 'fm-1',
      fareVersionId: 'fm-1',
      fareVersion: 'v2',
      fareSource: 'active_master',
      meterSettings: {
        basicFare: {
          initialDistanceKm: 1.06,
          initialFareYen: 520,
          additionalDistanceKm: 0.212,
          additionalFareYen: 100,
        },
        waitingFare: { unitSeconds: 1800, unitFareYen: 900 },
        escortFare: { unitSeconds: 1800, unitFareYen: 1600 },
        assistItems: [],
        dispatchMenuItems: [],
        specialVehicleMenuItems: [],
      },
      calculationRules: {},
      fareSnapshot: {},
    })
    expect(pricing.basicFare.initialFareYen).toBe(520)
    expect(pricing.waitingFare.unitFareYen).toBe(900)
    expect(pricing.basicFare.initialDistanceKm).toBe(basicFareSettings.initialDistanceKm)
    expect(pricing.waitingFare.unitSeconds).toBe(waitingFareSettings.unitSeconds)
  })
})
