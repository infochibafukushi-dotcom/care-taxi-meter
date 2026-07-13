import { describe, expect, it } from 'vitest'
import {
  buildFixedFareBreakdown,
  calculatePreFixedWaitingEscortFareYen,
  calculatePrepaidWaitingEscortBillableYen,
  calculateTimedFeeYen,
  escortFareSettings,
  PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS,
  resolveWaitingEscortPrepaidUnitsFromServiceFees,
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

describe('calculateTimedFeeYen / calculatePreFixedWaitingEscortFareYen', () => {
  const waiting = waitingFareSettings
  const escort = escortFareSettings
  const unit = PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS

  it.each([
    { label: '0秒', seconds: 0, expected: 0 },
    { label: '1秒', seconds: 1, expected: waiting.unitFareYen },
    { label: '1799秒', seconds: 1799, expected: waiting.unitFareYen },
    { label: '1800秒', seconds: 1800, expected: waiting.unitFareYen },
    { label: '1801秒', seconds: 1801, expected: waiting.unitFareYen * 2 },
    { label: '3600秒', seconds: 3600, expected: waiting.unitFareYen * 2 },
    { label: '3601秒', seconds: 3601, expected: waiting.unitFareYen * 3 },
  ])('待機 $label → $expected 円', ({ seconds, expected }) => {
    expect(calculateTimedFeeYen(seconds, unit, waiting.unitFareYen)).toBe(expected)
    expect(calculatePreFixedWaitingEscortFareYen(seconds, waiting, false)).toBe(expected)
    expect(calculatePreFixedWaitingEscortFareYen(seconds, waiting, true)).toBe(expected)
  })

  it.each([
    { label: '0秒', seconds: 0, expected: 0 },
    { label: '1秒', seconds: 1, expected: escort.unitFareYen },
    { label: '1799秒', seconds: 1799, expected: escort.unitFareYen },
    { label: '1800秒', seconds: 1800, expected: escort.unitFareYen },
    { label: '1801秒', seconds: 1801, expected: escort.unitFareYen * 2 },
    { label: '3600秒', seconds: 3600, expected: escort.unitFareYen * 2 },
    { label: '3601秒', seconds: 3601, expected: escort.unitFareYen * 3 },
  ])('付き添い $label → $expected 円', ({ seconds, expected }) => {
    expect(calculateTimedFeeYen(seconds, unit, escort.unitFareYen)).toBe(expected)
    expect(calculatePreFixedWaitingEscortFareYen(seconds, escort, false)).toBe(expected)
  })

  it('累積時間基準でも同じ境界を使う', () => {
    const under = 10 * 60 + 19 * 60 + 59
    expect(under).toBe(1799)
    expect(calculatePreFixedWaitingEscortFareYen(under, waiting, false)).toBe(waiting.unitFareYen)

    const exact = 10 * 60 + 20 * 60
    expect(exact).toBe(1800)
    expect(calculatePreFixedWaitingEscortFareYen(exact, waiting, false)).toBe(waiting.unitFareYen)
  })
})

describe('buildFixedFareBreakdown × pre-fixed waiting boundaries', () => {
  it('1秒待機で待機料金800円を加算する', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 1620,
      careOptions: [],
      expenses: [],
      waitingSeconds: 1,
      escortSeconds: 0,
      isRoundTrip: false,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
      },
    })

    expect(breakdown.waitingFareYen).toBe(800)
    expect(breakdown.totalFareYen).toBe(2420)
  })

  it('30分待機で待機料金800円を加算する', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 1620,
      careOptions: [],
      expenses: [],
      waitingSeconds: 1800,
      escortSeconds: 0,
      isRoundTrip: false,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
      },
    })

    expect(breakdown.waitingFareYen).toBe(800)
    expect(breakdown.totalFareYen).toBe(2420)
  })

  it('30分付き添いで付き添い料金1600円を加算する', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 1620,
      careOptions: [],
      expenses: [],
      waitingSeconds: 0,
      escortSeconds: 1800,
      isRoundTrip: false,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
      },
    })

    expect(breakdown.escortFareYen).toBe(1600)
    expect(breakdown.totalFareYen).toBe(3220)
  })
})

describe('calculatePrepaidWaitingEscortBillableYen', () => {
  it('事前選択1単位ありでは最初の30分を二重加算しない', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(0, waitingFareSettings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1, waitingFareSettings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1800, waitingFareSettings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1801, waitingFareSettings, 1)).toBe(
      waitingFareSettings.unitFareYen,
    )
  })

  it('付き添い事前選択でも同様', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(1, escortFareSettings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1801, escortFareSettings, 1)).toBe(
      escortFareSettings.unitFareYen,
    )
  })
})

describe('service fee handoff + prepaid units', () => {
  it('resolves prepaid waiting/escort units from create-flow meter ids', () => {
    expect(
      resolveWaitingEscortPrepaidUnitsFromServiceFees([
        { key: 'boarding-assist', amount: 1100 },
        { key: 'reservedPickup', amount: 800 },
        { key: 'oneBoxLift', amount: 1000 },
        { key: 'waitingPlanned', amount: 800 },
      ]),
    ).toEqual({ waitingPrepaidUnits: 1, escortPrepaidUnits: 0 })
  })

  it('puts prepaid waiting into waitingFareYen, not careOptions', () => {
    const careOptions = [{ amountYen: 1100 }, { amountYen: 800 }, { amountYen: 1000 }]
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3220,
      careOptions,
      expenses: [],
      waitingSeconds: 0,
      escortSeconds: 0,
      waitingPrepaidUnits: 1,
      escortPrepaidUnits: 0,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
      },
    })

    expect(breakdown.careOptionFareYen).toBe(2900)
    expect(breakdown.waitingFareYen).toBe(800)
    expect(breakdown.totalFareYen).toBe(6920)
  })

  it('keeps waiting total at 800 yen after 4 seconds when prepaid', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3220,
      careOptions: [{ amountYen: 1100 }, { amountYen: 800 }, { amountYen: 1000 }],
      expenses: [],
      waitingSeconds: 4,
      escortSeconds: 0,
      waitingPrepaidUnits: 1,
      escortPrepaidUnits: 0,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
      },
    })

    expect(breakdown.waitingFareYen).toBe(800)
    expect(breakdown.totalFareYen).toBe(6920)
  })

  it('uses final waiting total after 1801 seconds when prepaid', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3220,
      careOptions: [{ amountYen: 1100 }, { amountYen: 800 }, { amountYen: 1000 }],
      expenses: [],
      waitingSeconds: 1801,
      escortSeconds: 0,
      waitingPrepaidUnits: 1,
      escortPrepaidUnits: 0,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
      },
    })

    expect(breakdown.waitingFareYen).toBe(1600)
    expect(breakdown.totalFareYen).toBe(7720)
  })

  it('uses final waiting total for 1 hour 28 minutes as one line', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3320,
      careOptions: [{ amountYen: 1100 }, { amountYen: 800 }, { amountYen: 1000 }],
      expenses: [],
      waitingSeconds: 1 * 3600 + 28 * 60,
      escortSeconds: 0,
      waitingPrepaidUnits: 1,
      escortPrepaidUnits: 0,
      isDisabilityDiscount: true,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
        discount: { name: '障害者割引', method: 'percentage', value: 10 },
      },
    })

    expect(breakdown.waitingFareYen).toBe(2400)
    expect(breakdown.disabilityDiscountAmount).toBe(330)
    expect(breakdown.totalFareYen).toBe(8290)
    expect(breakdown.lineItems.filter((item) => item.label.includes('待機'))).toEqual([
      { label: '待機料金（1時間28分）', amountYen: 2400 },
    ])
    expect(breakdown.lineItems.some((item) => item.label.includes('待機/付き添い'))).toBe(false)
  })
})
