import { describe, expect, it } from 'vitest'
import {
  buildFixedFareBreakdown,
  calculateFareBreakdown,
  DEFAULT_DISCOUNT_SETTINGS,
} from './services/fare'
import { defaultTimeMeterSettings } from './services/meterSettings'
import {
  buildPaymentAmountsMatchingCharge,
  calculateSettlementSummary,
  shouldResyncPaymentAmountsToCharge,
} from './services/settlementSummary'
import { createEmptyPaymentAmounts } from './utils/meterConstants'

describe('calculateSettlementSummary', () => {
  it('ケース1: 割引なしは請求額＝支払総額で保存可能', () => {
    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 0,
      finalChargeAmountYen: 8620,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8620),
    })

    expect(summary.finalChargeAmountYen).toBe(8620)
    expect(summary.paymentTotalYen).toBe(8620)
    expect(summary.differenceYen).toBe(0)
    expect(summary.canSave).toBe(true)
  })

  it('ケース2: 割合割引後の最終請求額を基準に保存可能', () => {
    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 160,
      finalChargeAmountYen: 8460,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8460),
    })

    expect(summary.grossAmountYen).toBe(8620)
    expect(summary.discountAmountYen).toBe(160)
    expect(summary.finalChargeAmountYen).toBe(8460)
    expect(summary.paymentTotalYen).toBe(8460)
    expect(summary.differenceYen).toBe(0)
    expect(summary.canSave).toBe(true)
  })

  it('ケース3: 割引後も割引前金額を支払うと差額が発生し保存不可', () => {
    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 160,
      finalChargeAmountYen: 8460,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8620),
    })

    expect(summary.differenceYen).toBe(160)
    expect(summary.canSave).toBe(false)
  })

  it('ケース4: 支払不足は負の差額で保存不可', () => {
    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 160,
      finalChargeAmountYen: 8460,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8000),
    })

    expect(summary.differenceYen).toBe(-460)
    expect(summary.canSave).toBe(false)
  })

  it('ケース5: 複数支払方法の合計が最終請求額と一致すれば保存可能', () => {
    const paymentAmounts = createEmptyPaymentAmounts()
    paymentAmounts['現金'] = 5000
    paymentAmounts['クレジット'] = 3460

    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 160,
      finalChargeAmountYen: 8460,
      paymentAmounts,
    })

    expect(summary.paymentTotalYen).toBe(8460)
    expect(summary.differenceYen).toBe(0)
    expect(summary.canSave).toBe(true)
  })

  it('ケース6: 金額割引後の最終請求額を基準に保存可能', () => {
    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 500,
      finalChargeAmountYen: 8120,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8120),
    })

    expect(summary.finalChargeAmountYen).toBe(8120)
    expect(summary.differenceYen).toBe(0)
    expect(summary.canSave).toBe(true)
  })

  it('保存判定は割引前総額（gross）ではなく最終請求額を使う', () => {
    const summary = calculateSettlementSummary({
      grossAmountYen: 8620,
      discountAmountYen: 160,
      finalChargeAmountYen: 8460,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8460),
    })

    // gross との差分は 160 だが、最終請求額基準では差額 0
    expect(summary.grossAmountYen - summary.paymentTotalYen).toBe(160)
    expect(summary.differenceYen).toBe(0)
    expect(summary.canSave).toBe(true)
  })
})

describe('shouldResyncPaymentAmountsToCharge', () => {
  it('直前の請求額と支払総額が一致していれば割引適用後に追従する', () => {
    expect(
      shouldResyncPaymentAmountsToCharge({
        previousChargeYen: 8620,
        nextChargeYen: 8460,
        paymentTotalYen: 8620,
      }),
    ).toBe(true)
  })

  it('利用者が意図的に別額を入力している場合は追従しない', () => {
    expect(
      shouldResyncPaymentAmountsToCharge({
        previousChargeYen: 8620,
        nextChargeYen: 8460,
        paymentTotalYen: 8000,
      }),
    ).toBe(false)
  })

  it('複数支払方法の併用中は内訳を壊さない', () => {
    const paymentAmounts = createEmptyPaymentAmounts()
    paymentAmounts['現金'] = 5000
    paymentAmounts['クレジット'] = 3620

    expect(
      shouldResyncPaymentAmountsToCharge({
        previousChargeYen: 8620,
        nextChargeYen: 8460,
        paymentTotalYen: 8620,
        paymentAmounts,
      }),
    ).toBe(false)
  })
})

describe('meter fare breakdown × settlement summary', () => {
  const discount = { ...DEFAULT_DISCOUNT_SETTINGS, method: 'percentage' as const, value: 10 }

  it('ケース7: 事前確定運賃Mで割引後請求額を保存基準にする', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 1620,
      careOptions: [{ amountYen: 4600 }],
      expenses: [],
      waitingSeconds: 1800 * 3,
      escortSeconds: 0,
      isRoundTrip: false,
      isDisabilityDiscount: true,
      settings: {
        waitingFare: { unitSeconds: 1800, unitFareYen: 800 },
        discount,
      },
    })

    expect(breakdown.grossFareYen).toBe(8620)
    expect(breakdown.disabilityDiscountAmount).toBe(160)
    expect(breakdown.totalFareYen).toBe(8460)

    const summary = calculateSettlementSummary({
      grossAmountYen: breakdown.grossFareYen,
      discountAmountYen: breakdown.disabilityDiscountAmount,
      taxiTicketAmountYen: breakdown.taxiTicketAmountYen,
      finalChargeAmountYen: breakdown.totalFareYen,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', breakdown.totalFareYen),
    })

    expect(summary.canSave).toBe(true)
    expect(summary.differenceYen).toBe(0)
  })

  it('ケース7: GPSM / OBDM でも割引後請求額を保存基準にする', () => {
    for (const meterMode of ['gps', 'obd'] as const) {
      const breakdown = calculateFareBreakdown({
        distanceKm: 0,
        waitingSeconds: 0,
        escortSeconds: 0,
        careOptions: [{ amountYen: 7000 }],
        expenses: [],
        isDisabilityDiscount: true,
        meterMode,
        settings: {
          basicFare: {
            initialDistanceKm: 1,
            initialFareYen: 1620,
            additionalDistanceKm: 0.233,
            additionalFareYen: 100,
          },
          discount,
        },
      })

      // 距離0でも初乗り1620 + 介助7000 = 8620、割引160
      expect(breakdown.grossFareYen).toBe(8620)
      expect(breakdown.disabilityDiscountAmount).toBe(160)
      expect(breakdown.totalFareYen).toBe(8460)

      const summary = calculateSettlementSummary({
        grossAmountYen: breakdown.grossFareYen,
        discountAmountYen: breakdown.disabilityDiscountAmount,
        finalChargeAmountYen: breakdown.totalFareYen,
        paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8460),
      })
      expect(summary.canSave).toBe(true)
    }
  })

  it('ケース6: 金額割引でも最終請求額基準で保存可能', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 1620,
      careOptions: [{ amountYen: 4600 }],
      expenses: [],
      waitingSeconds: 1800 * 3,
      escortSeconds: 0,
      isRoundTrip: false,
      isDisabilityDiscount: true,
      settings: {
        waitingFare: { unitSeconds: 1800, unitFareYen: 800 },
        discount: { name: '金額割引', method: 'fixed', value: 500 },
      },
    })

    expect(breakdown.grossFareYen).toBe(8620)
    expect(breakdown.disabilityDiscountAmount).toBe(500)
    expect(breakdown.totalFareYen).toBe(8120)

    const summary = calculateSettlementSummary({
      grossAmountYen: breakdown.grossFareYen,
      discountAmountYen: breakdown.disabilityDiscountAmount,
      finalChargeAmountYen: breakdown.totalFareYen,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', 8120),
    })
    expect(summary.canSave).toBe(true)
  })

  it('ケース7: 時間Mでも割引後請求額を保存基準にする', () => {
    const breakdown = calculateFareBreakdown({
      distanceKm: 0,
      waitingSeconds: 0,
      escortSeconds: 0,
      careOptions: [{ amountYen: 7000 }],
      expenses: [],
      isDisabilityDiscount: true,
      meterMode: 'time',
      drivingSeconds: 30 * 60,
      timeMeterSettings: defaultTimeMeterSettings,
      settings: { discount },
    })

    expect(breakdown.disabilityDiscountAmount).toBeGreaterThan(0)
    const summary = calculateSettlementSummary({
      grossAmountYen: breakdown.grossFareYen,
      discountAmountYen: breakdown.disabilityDiscountAmount,
      finalChargeAmountYen: breakdown.totalFareYen,
      paymentAmounts: buildPaymentAmountsMatchingCharge('現金', breakdown.totalFareYen),
    })
    expect(summary.canSave).toBe(true)
    expect(summary.finalChargeAmountYen).toBe(breakdown.totalFareYen)
    expect(summary.finalChargeAmountYen).toBeLessThan(breakdown.grossFareYen)
  })

  it('事前確定Mの明細に割引行を含め、合計と請求額が一致する', () => {
    const breakdown = buildFixedFareBreakdown({
      confirmedFareYen: 1620,
      careOptions: [{ amountYen: 4600 }],
      expenses: [],
      waitingSeconds: 1800 * 3,
      escortSeconds: 0,
      isRoundTrip: false,
      isDisabilityDiscount: true,
      settings: {
        waitingFare: { unitSeconds: 1800, unitFareYen: 800 },
        discount,
      },
    })

    const lineSum = breakdown.lineItems.reduce((sum, item) => sum + item.amountYen, 0)
    expect(lineSum).toBe(breakdown.totalFareYen)
    expect(breakdown.lineItems.some((item) => item.amountYen === -160)).toBe(true)
  })
})
