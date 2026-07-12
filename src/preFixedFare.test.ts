import { describe, expect, it } from 'vitest'
import {
  buildFixedFareBreakdown,
  calculatePreFixedWaitingEscortFareYen,
  calculatePrepaidWaitingEscortBillableYen,
  escortFareSettings,
  PRE_FIXED_WAITING_ESCORT_FREE_SECONDS,
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
  const waiting = waitingFareSettings
  const escort = escortFareSettings

  it.each([
    { label: '0秒', seconds: 0, expected: 0 },
    { label: '1秒', seconds: 1, expected: 0 },
    { label: '29分59秒', seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS - 1, expected: 0 },
    { label: '30分00秒', seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS, expected: waiting.unitFareYen },
    { label: '30分01秒', seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS + 1, expected: waiting.unitFareYen },
    {
      label: '次境界直前',
      seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS * 2 - 1,
      expected: waiting.unitFareYen,
    },
    {
      label: '次境界到達',
      seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS * 2,
      expected: waiting.unitFareYen * 2,
    },
  ])('待機 $label → $expected 円', ({ seconds, expected }) => {
    expect(calculatePreFixedWaitingEscortFareYen(seconds, waiting, false)).toBe(expected)
    // 片道・往復で同じ閾値
    expect(calculatePreFixedWaitingEscortFareYen(seconds, waiting, true)).toBe(expected)
  })

  it.each([
    { label: '0秒', seconds: 0, expected: 0 },
    { label: '1秒', seconds: 1, expected: 0 },
    { label: '29分59秒', seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS - 1, expected: 0 },
    { label: '30分00秒', seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS, expected: escort.unitFareYen },
    { label: '30分01秒', seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS + 1, expected: escort.unitFareYen },
    {
      label: '次境界到達',
      seconds: PRE_FIXED_WAITING_ESCORT_FREE_SECONDS * 2,
      expected: escort.unitFareYen * 2,
    },
  ])('付き添い $label → $expected 円', ({ seconds, expected }) => {
    expect(calculatePreFixedWaitingEscortFareYen(seconds, escort, false)).toBe(expected)
  })

  it('累積29分59秒（分割計測想定）は0円', () => {
    const total = 10 * 60 + 19 * 60 + 59
    expect(total).toBe(PRE_FIXED_WAITING_ESCORT_FREE_SECONDS - 1)
    expect(calculatePreFixedWaitingEscortFareYen(total, waiting, false)).toBe(0)
  })

  it('累積30分00秒（分割計測想定）は1単位', () => {
    const total = 10 * 60 + 20 * 60
    expect(total).toBe(PRE_FIXED_WAITING_ESCORT_FREE_SECONDS)
    expect(calculatePreFixedWaitingEscortFareYen(total, waiting, false)).toBe(waiting.unitFareYen)
  })
})

describe('buildFixedFareBreakdown × pre-fixed waiting boundaries', () => {
  it('1秒待機では合計に待機料金を載せない', () => {
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

    expect(breakdown.waitingFareYen).toBe(0)
    expect(breakdown.totalFareYen).toBe(1620)
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
  it('charges nothing until the prepaid unit is exceeded', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(30, waitingFareSettings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1801, waitingFareSettings, 1)).toBe(
      waitingFareSettings.unitFareYen,
    )
  })
})
