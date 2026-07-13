import { describe, expect, it } from 'vitest'
import {
  buildFixedFareBreakdown,
  escortFareSettings,
  waitingFareSettings,
} from './services/fare'
import { buildPreFixedMeterDisplayBreakdown } from './services/preFixedMeterDisplayBreakdown'
import {
  buildAssistFeeLineItems,
  calculatePreFixedFareBreakdown,
  computeAssistFeeBreakdown,
} from './services/preFixedAssistSelection'
import { createEmptyAssistSelectionState } from './types/preFixedAssistSelection'
import type { ReservationTripContext } from './services/reservationTripContext'

const careWithoutWaiting = [
  { amountYen: 1100 }, // 乗降介助
  { amountYen: 800 }, // 予約迎車
  { amountYen: 1000 }, // 1BOX
]

const reservationContext: ReservationTripContext = {
  reservationId: 'qa-1',
  estimateNo: 'QA-1',
  confirmedFareYen: 3320,
  fixedFareTotalYen: 7020,
  snapshotHash: 'hash',
  consentAt: '2026-07-13T00:00:00+09:00',
  pickupAddress: '出洲港',
  dropoffAddress: '出洲港',
  usageSummary: ['立ち寄りあり'],
  quoteSnapshot: {
    fixedFareTotal: 3320,
    serviceFees: [
      { key: 'boarding-assist', label: '乗降介助', amount: 1100 },
      { key: 'reservedPickup', label: '予約迎車', amount: 800 },
      { key: 'oneBoxLift', label: '1BOXリフト車両', amount: 1000 },
      { key: 'waitingPlanned', label: '待機（30分）', amount: 800 },
    ],
    fareMode: 'pre_fixed_fare',
    selectedRouteId: 'A',
    selectedUsesToll: false,
    distanceMeters: 6000,
    durationSeconds: 1200,
    preFixedFareConfirmable: true,
  },
  routePlan: null,
  consent: {
    consentAt: '2026-07-13T00:00:00+09:00',
    consentTextVersion: 'v1',
    snapshotHash: 'hash',
    quotedFareYen: 7020,
    source: 'app',
  },
  customerName: 'QA',
  scheduledAt: '2026-07-13T10:00:00+09:00',
}

describe('final QA amounts for waiting display', () => {
  it('keeps create/confirm totals including prepaid waiting', () => {
    const selection = {
      ...createEmptyAssistSelectionState(),
      mobilityId: 'free-wheelchair',
      assistanceId: 'boarding-assist',
      stairId: 'stair-none',
      extraIds: ['reservedPickup', 'oneBoxLift'],
      roundTripAddonId: 'waiting',
    }
    const fees = computeAssistFeeBreakdown(selection)
    expect(fees.serviceTotal).toBe(3700)
    expect(calculatePreFixedFareBreakdown({ routeFareYen: 3320, assistFeesYen: fees.serviceTotal }))
      .toMatchObject({ totalEstimatedFareYen: 7020 })
    expect(buildAssistFeeLineItems(selection).filter((line) => line.label.includes('待機'))).toEqual([
      { label: '待機料金（予定30分）', amount: 800 },
    ])
  })

  it('starts meter at 7020 with one planned waiting line', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3320,
      careOptions: careWithoutWaiting,
      expenses: [],
      waitingSeconds: 0,
      escortSeconds: 0,
      waitingPrepaidUnits: 1,
      escortPrepaidUnits: 0,
      settings: { waitingFare: waitingFareSettings, escortFare: escortFareSettings },
    })
    const display = buildPreFixedMeterDisplayBreakdown(reservationContext, breakdown, {
      waitingSeconds: 0,
      waitingPrepaidUnits: 1,
    })

    expect(breakdown.waitingFareYen).toBe(800)
    expect(breakdown.totalFareYen).toBe(7020)
    expect(display.lineItems).toEqual([
      { label: '事前確定運賃', amountYen: 3320 },
      { label: '乗降介助', amountYen: 1100 },
      { label: '予約迎車', amountYen: 800 },
      { label: '1BOXリフト車両', amountYen: 1000 },
      { label: '待機料金（予定30分）', amountYen: 800 },
    ])
    expect(display.lineItems.some((item) => item.label.includes('追加待機'))).toBe(false)
    expect(display.lineItems.some((item) => item.label.includes('待機/付き添い'))).toBe(false)
    expect(display.lineItems.some((item) => item.label.includes('小計'))).toBe(false)
  })

  it('keeps 7020 after 4 seconds with one waiting line', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3320,
      careOptions: careWithoutWaiting,
      expenses: [],
      waitingSeconds: 4,
      waitingPrepaidUnits: 1,
      settings: { waitingFare: waitingFareSettings, escortFare: escortFareSettings },
    })
    const display = buildPreFixedMeterDisplayBreakdown(reservationContext, breakdown, {
      waitingSeconds: 4,
      waitingPrepaidUnits: 1,
    })
    expect(breakdown.totalFareYen).toBe(7020)
    expect(display.lineItems.filter((item) => item.label.includes('待機'))).toEqual([
      { label: '待機料金（4秒）', amountYen: 800 },
    ])
  })

  it('shows 1600 waiting as one line at 31 minutes', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3320,
      careOptions: careWithoutWaiting,
      expenses: [],
      waitingSeconds: 31 * 60,
      waitingPrepaidUnits: 1,
      settings: { waitingFare: waitingFareSettings, escortFare: escortFareSettings },
    })
    const display = buildPreFixedMeterDisplayBreakdown(reservationContext, breakdown, {
      waitingSeconds: 31 * 60,
      waitingPrepaidUnits: 1,
    })
    expect(breakdown.waitingFareYen).toBe(1600)
    expect(breakdown.totalFareYen).toBe(7820)
    expect(display.lineItems.filter((item) => item.label.includes('待機'))).toEqual([
      { label: '待機料金（31分）', amountYen: 1600 },
    ])
  })

  it('shows 2400 waiting and 8290 after disability discount at 1h28m', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3320,
      careOptions: careWithoutWaiting,
      expenses: [],
      waitingSeconds: 1 * 3600 + 28 * 60,
      waitingPrepaidUnits: 1,
      isDisabilityDiscount: true,
      settings: {
        waitingFare: waitingFareSettings,
        escortFare: escortFareSettings,
        discount: { name: '障害者割引', method: 'percentage', value: 10 },
      },
    })
    const display = buildPreFixedMeterDisplayBreakdown(reservationContext, breakdown, {
      waitingSeconds: 1 * 3600 + 28 * 60,
      waitingPrepaidUnits: 1,
    })

    expect(breakdown.waitingFareYen).toBe(2400)
    expect(breakdown.grossFareYen).toBe(8620)
    expect(breakdown.disabilityDiscountAmount).toBe(330)
    expect(breakdown.totalFareYen).toBe(8290)
    expect(display.lineItems).toEqual([
      { label: '事前確定運賃', amountYen: 3320 },
      { label: '乗降介助', amountYen: 1100 },
      { label: '予約迎車', amountYen: 800 },
      { label: '1BOXリフト車両', amountYen: 1000 },
      { label: '待機料金（1時間28分）', amountYen: 2400 },
      { label: '障害者割引', amountYen: -330 },
    ])
  })

  it('keeps escort and waiting as separate lines', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 3320,
      careOptions: careWithoutWaiting,
      expenses: [],
      waitingSeconds: 1800,
      escortSeconds: 1800,
      waitingPrepaidUnits: 1,
      escortPrepaidUnits: 1,
      settings: { waitingFare: waitingFareSettings, escortFare: escortFareSettings },
    })
    const display = buildPreFixedMeterDisplayBreakdown(
      {
        ...reservationContext,
        quoteSnapshot: {
          ...reservationContext.quoteSnapshot,
          serviceFees: [
            ...reservationContext.quoteSnapshot.serviceFees,
            { key: 'escortPlanned', label: '付き添い（30分）', amount: 1600 },
          ],
        },
      },
      breakdown,
      {
        waitingSeconds: 1800,
        escortSeconds: 1800,
        waitingPrepaidUnits: 1,
        escortPrepaidUnits: 1,
      },
    )

    expect(display.lineItems.filter((item) => item.label.includes('待機'))).toEqual([
      { label: '待機料金（30分）', amountYen: 800 },
    ])
    expect(display.lineItems.filter((item) => item.label.includes('付き添い'))).toEqual([
      { label: '付き添い料金（30分）', amountYen: 1600 },
    ])
    expect(display.lineItems.some((item) => item.label.includes('待機/付き添い'))).toBe(false)
  })
})
