import { describe, expect, it } from 'vitest'
import {
  calculatePreFixedWaitingEscortFareYen,
  calculatePrepaidWaitingEscortBillableYen,
  PRE_FIXED_ROUND_TRIP_FREE_SECONDS,
  waitingFareSettings,
} from './services/fare'
import { isPreFixedFareRoundTrip } from './services/preFixedFareRoute'
import type { ReservationTripContext } from './services/reservationTripContext'

const baseContext = {
  reservationId: 'res-1',
  estimateNo: 'EST-1',
  confirmedFareYen: 5000,
  fixedFareTotalYen: 5000,
  snapshotHash: 'hash',
  consentAt: '2026-01-01T00:00:00+09:00',
  pickupAddress: '自宅',
  dropoffAddress: '病院',
  usageSummary: [] as string[],
  quoteSnapshot: {
    fixedFareTotal: 5000,
    serviceFees: [],
    fareMode: 'pre_fixed_fare',
    selectedRouteId: 'route-1',
    selectedUsesToll: false,
    distanceMeters: 1000,
    durationSeconds: 600,
    preFixedFareConfirmable: true,
  },
  routePlan: null,
  consent: {
    consentAt: '2026-01-01T00:00:00+09:00',
    consentTextVersion: 'v1',
    snapshotHash: 'hash',
    quotedFareYen: 5000,
    source: 'app',
  },
  customerName: 'テスト',
  scheduledAt: '2026-01-01T09:00:00+09:00',
} satisfies ReservationTripContext

describe('isPreFixedFareRoundTrip', () => {
  it('detects round trip from usageSummary keywords', () => {
    expect(
      isPreFixedFareRoundTrip({
        ...baseContext,
        usageSummary: ['往復利用'],
      }),
    ).toBe(true)
    expect(
      isPreFixedFareRoundTrip({
        ...baseContext,
        usageSummary: ['帰宅介助'],
      }),
    ).toBe(true)
  })

  it('detects one-way from usageSummary', () => {
    expect(
      isPreFixedFareRoundTrip({
        ...baseContext,
        usageSummary: ['片道'],
      }),
    ).toBe(false)
  })
})

describe('calculatePreFixedWaitingEscortFareYen', () => {
  const settings = waitingFareSettings

  it('charges nothing for round trip within the first 30 minutes', () => {
    expect(
      calculatePreFixedWaitingEscortFareYen(
        PRE_FIXED_ROUND_TRIP_FREE_SECONDS,
        settings,
        true,
      ),
    ).toBe(0)
  })

  it('starts billing after 30 minutes for round trip', () => {
    expect(
      calculatePreFixedWaitingEscortFareYen(
        PRE_FIXED_ROUND_TRIP_FREE_SECONDS + 1,
        settings,
        true,
      ),
    ).toBe(settings.unitFareYen)
  })

  it('uses the standard time fare rule for one-way trips', () => {
    expect(calculatePreFixedWaitingEscortFareYen(1, settings, false)).toBe(
      settings.unitFareYen,
    )
  })
})

describe('calculatePrepaidWaitingEscortBillableYen', () => {
  it('charges nothing until the prepaid unit is exceeded', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(30, waitingFareSettings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1801, waitingFareSettings, 1)).toBe(
      waitingFareSettings.unitFareYen,
    )
  })
})
