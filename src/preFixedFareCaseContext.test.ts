import { describe, expect, it } from 'vitest'
import { buildPreFixedFareCaseContext } from './services/preFixedFareCaseContext'
import type { ReservationTripContext } from './services/reservationTripContext'
import { reviewDemoPreFixedFareReservationDetail } from './fixtures/reviewDemoPreFixedFare'
import { buildReservationTripContext, buildReservationTripContextForMeterStart } from './services/reservationTripContext'

const baseContext: ReservationTripContext = {
  reservationId: 'res-normal-001',
  estimateNo: 'EST-100',
  confirmedFareYen: 3200,
  fixedFareTotalYen: 4300,
  snapshotHash: 'hash-normal',
  consentAt: '2026-07-07T09:00:00+09:00',
  pickupAddress: '千葉市中央区',
  dropoffAddress: '千葉駅',
  usageSummary: ['片道'],
  quoteSnapshot: {
    fixedFareTotal: 3200,
    serviceFees: [{ key: 'assistFee', label: '介助料金', amount: 1100 }],
    fareMode: 'pre_fixed_fare',
    selectedRouteId: 'B',
    selectedUsesToll: false,
    distanceMeters: 5000,
    durationSeconds: 900,
    preFixedFareConfirmable: true,
  },
  routePlan: {
    stops: [
      { role: 'S', address: '千葉市中央区' },
      { role: 'via', address: '病院前' },
      { role: 'G', address: '千葉駅' },
    ],
  },
  consent: {
    consentAt: '2026-07-07T09:00:00+09:00',
    consentTextVersion: '2026-07-01',
    snapshotHash: 'hash-normal',
    quotedFareYen: 4300,
    source: 'normal_reservation',
  },
  customerName: '山田太郎',
  scheduledAt: '2026-07-07T10:00:00+09:00',
}

describe('buildPreFixedFareCaseContext', () => {
  it('maps normal reservation conversion fields for Firestore persistence', () => {
    const result = buildPreFixedFareCaseContext({
      tripContext: baseContext,
      settlementTotalYen: 4300,
    })

    expect(result.sourceFlow).toBe('normal_reservation')
    expect(result.reservationCategory).toBe('normal')
    expect(result.reservationId).toBe('res-normal-001')
    expect(result.pickupAddress).toBe('千葉市中央区')
    expect(result.dropoffAddress).toBe('千葉駅')
    expect(result.viaAddresses).toEqual(['病院前'])
    expect(result.selectedRouteId).toBe('B')
    expect(result.preFixedFareYen).toBe(3200)
    expect(result.assistFareYen).toBe(1100)
    expect(result.billingTotalYen).toBe(4300)
    expect(result.consentAt).toBe('2026-07-07T09:00:00+09:00')
    expect(result.consentAgreed).toBe(true)
    expect(result.meterMode).toBe('fixed')
    expect(result.fareMode).toBe('pre_fixed_fare')
  })

  it('detects fixed reservation source flow from reservation trip context', () => {
    const fixedContext = buildReservationTripContext(reviewDemoPreFixedFareReservationDetail)
    const result = buildPreFixedFareCaseContext({ tripContext: fixedContext })

    expect(result.sourceFlow).toBe('fixed_reservation')
    expect(result.reservationCategory).toBe('pre_fixed')
    expect(result.consentAt).toBe(fixedContext.consentAt)
  })
})

describe('buildReservationTripContextForMeterStart', () => {
  it('preserves existing consent datetime', () => {
    const result = buildReservationTripContextForMeterStart(
      reviewDemoPreFixedFareReservationDetail,
      true,
    )

    expect(result.consentAt).toBe(reviewDemoPreFixedFareReservationDetail.consent.consentAt)
  })
})
