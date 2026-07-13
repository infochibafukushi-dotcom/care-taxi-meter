import { describe, expect, it } from 'vitest'
import type { FareBreakdown } from './services/fare'
import {
  buildPreFixedMeterDisplayBreakdown,
  buildPreFixedReservationLineItems,
} from './services/preFixedMeterDisplayBreakdown'
import type { ReservationTripContext } from './services/reservationTripContext'

const baseOperationalBreakdown = (): FareBreakdown => ({
  dispatchFareYen: 0,
  specialVehicleFareYen: 0,
  basicFareYen: 3740,
  waitingFareYen: 0,
  meterTimeFareYen: 0,
  escortFareYen: 0,
  careOptionFareYen: 1100,
  customFeeFareYen: 0,
  expenseFareYen: 0,
  normalFareYen: 3740,
  nightSurchargeYen: 0,
  grossFareYen: 4840,
  discountableFareYen: 3740,
  isDisabilityDiscount: false,
  disabilityDiscountRate: 0,
  disabilityDiscountAmount: 0,
  discountName: '障害者割引',
  discountMethod: 'percentage',
  discountValue: 0,
  taxiTicketAmountYen: 0,
  totalFareYen: 4840,
  lineItems: [],
  meterMode: 'fixed',
  timeMeter: null,
  originalConfirmedFareYen: 3740,
  additionalRouteFareYen: 0,
  additionalCareFareYen: 0,
})

const reservationContext: ReservationTripContext = {
  reservationId: 'res-001',
  estimateNo: 'EST-001',
  confirmedFareYen: 3740,
  fixedFareTotalYen: 2640,
  snapshotHash: 'hash',
  consentAt: '2026-07-07T09:00:00+09:00',
  pickupAddress: '千葉市中央区',
  dropoffAddress: '千葉駅',
  usageSummary: [],
  quoteSnapshot: {
    fixedFareTotal: 2640,
    serviceFees: [
      { key: 'assistFee', label: '介助料金', amount: 1100 },
      { key: 'specialVehicleFee', label: '特殊車両使用料', amount: 500 },
    ],
    fareMode: 'pre_fixed_fare',
    selectedRouteId: 'A',
    selectedUsesToll: false,
    distanceMeters: 5000,
    durationSeconds: 900,
    preFixedFareConfirmable: true,
  },
  routePlan: null,
  consent: {
    consentAt: '2026-07-07T09:00:00+09:00',
    consentTextVersion: 'v1',
    snapshotHash: 'hash',
    quotedFareYen: 3740,
    source: 'reservation',
  },
  customerName: '山田太郎',
  scheduledAt: '2026-07-07T10:00:00+09:00',
}

describe('buildPreFixedReservationLineItems', () => {
  it('includes confirmed fare and positive service fees only', () => {
    expect(buildPreFixedReservationLineItems(reservationContext)).toEqual([
      { label: '事前確定運賃', amountYen: 3740 },
      { label: '介助料金', amountYen: 1100 },
      { label: '特殊車両使用料', amountYen: 500 },
    ])
  })

  it('omits waiting and escort fees from reservation rows', () => {
    const context: ReservationTripContext = {
      ...reservationContext,
      quoteSnapshot: {
        ...reservationContext.quoteSnapshot,
        serviceFees: [
          { key: 'assistFee', label: '乗降介助', amount: 1100 },
          { key: 'waitingPlanned', label: '待機（30分）', amount: 800 },
        ],
      },
    }

    expect(buildPreFixedReservationLineItems(context)).toEqual([
      { label: '事前確定運賃', amountYen: 3740 },
      { label: '乗降介助', amountYen: 1100 },
    ])
  })
})

describe('buildPreFixedMeterDisplayBreakdown', () => {
  it('keeps settlement total while replacing line items with reservation-based rows', () => {
    const operational = {
      ...baseOperationalBreakdown(),
      waitingFareYen: 200,
      escortFareYen: 300,
      expenseFareYen: 100,
      additionalCareFareYen: 1600,
      totalFareYen: 5440,
    }

    const display = buildPreFixedMeterDisplayBreakdown(reservationContext, operational, {
      waitingSeconds: 60,
      escortSeconds: 120,
    })

    expect(display.totalFareYen).toBe(5440)
    expect(display.lineItems).toEqual([
      { label: '事前確定運賃', amountYen: 3740 },
      { label: '介助料金', amountYen: 1100 },
      { label: '特殊車両使用料', amountYen: 500 },
      { label: '実費', amountYen: 100 },
      { label: '待機料金（1分）', amountYen: 200 },
      { label: '付き添い料金（2分）', amountYen: 300 },
    ])
  })

  it('shows prepaid waiting as one planned line without extras', () => {
    const context: ReservationTripContext = {
      ...reservationContext,
      confirmedFareYen: 3320,
      quoteSnapshot: {
        ...reservationContext.quoteSnapshot,
        serviceFees: [
          { key: 'boarding-assist', label: '乗降介助', amount: 1100 },
          { key: 'reservedPickup', label: '予約迎車', amount: 800 },
          { key: 'oneBoxLift', label: '1BOXリフト車両', amount: 1000 },
          { key: 'waitingPlanned', label: '待機（30分）', amount: 800 },
        ],
      },
    }
    const display = buildPreFixedMeterDisplayBreakdown(
      context,
      {
        ...baseOperationalBreakdown(),
        waitingFareYen: 800,
        careOptionFareYen: 2900,
        additionalCareFareYen: 2900,
        totalFareYen: 6920,
      },
      { waitingSeconds: 4, waitingPrepaidUnits: 1 },
    )

    expect(display.lineItems.filter((item) => item.label.includes('待機'))).toEqual([
      { label: '待機料金（4秒）', amountYen: 800 },
    ])
    expect(display.lineItems.some((item) => item.label.includes('追加待機'))).toBe(false)
    expect(display.lineItems.some((item) => item.label === '待機（30分）')).toBe(false)
  })

  it('merges prepaid and actual waiting into one 1h28m line', () => {
    const context: ReservationTripContext = {
      ...reservationContext,
      confirmedFareYen: 3320,
      quoteSnapshot: {
        ...reservationContext.quoteSnapshot,
        serviceFees: [
          { key: 'boarding-assist', label: '乗降介助', amount: 1100 },
          { key: 'waitingPlanned', label: '待機（30分）', amount: 800 },
        ],
      },
    }
    const waitingSeconds = 1 * 3600 + 28 * 60
    const display = buildPreFixedMeterDisplayBreakdown(
      context,
      {
        ...baseOperationalBreakdown(),
        waitingFareYen: 2400,
        disabilityDiscountAmount: 330,
        isDisabilityDiscount: true,
        totalFareYen: 8290,
      },
      { waitingSeconds, waitingPrepaidUnits: 1 },
    )

    expect(display.lineItems.filter((item) => item.label.includes('待機'))).toEqual([
      { label: '待機料金（1時間28分）', amountYen: 2400 },
    ])
  })
})
