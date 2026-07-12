import type { PaymentMethod } from '../types/case'
import { createEmptyPaymentAmounts } from '../utils/meterConstants'

export const SETTLEMENT_PAYMENT_METHODS: PaymentMethod[] = [
  '現金',
  'クレジット',
  'QR決済',
  '請求書',
  'その他',
]

export type SettlementSummaryInput = {
  /** 割引前総額（grossFareYen） */
  grossAmountYen: number
  /** 適用済み割引額（disabilityDiscountAmount） */
  discountAmountYen: number
  /** タクシー券適用額（既に最終請求から控除済み） */
  taxiTicketAmountYen?: number
  /**
   * 支払方法で収受すべき最終請求額。
   * 既存の FareBreakdown.totalFareYen と同一（割引・タクシー券控除後）。
   */
  finalChargeAmountYen: number
  paymentAmounts: Record<PaymentMethod, number>
}

export type SettlementSummary = {
  grossAmountYen: number
  discountAmountYen: number
  taxiTicketAmountYen: number
  finalChargeAmountYen: number
  paymentTotalYen: number
  /** paymentTotalYen - finalChargeAmountYen */
  differenceYen: number
  canSave: boolean
}

export const sumPaymentAmountsYen = (
  paymentAmounts: Record<PaymentMethod, number>,
): number =>
  SETTLEMENT_PAYMENT_METHODS.reduce(
    (total, method) => total + Math.max(Math.round(paymentAmounts[method]) || 0, 0),
    0,
  )

/**
 * 精算画面・保存判定・帳票で共通利用する金額サマリー。
 * 保存可否は必ず finalChargeAmountYen（割引後請求額）を基準にする。
 */
export function calculateSettlementSummary({
  grossAmountYen,
  discountAmountYen,
  taxiTicketAmountYen = 0,
  finalChargeAmountYen,
  paymentAmounts,
}: SettlementSummaryInput): SettlementSummary {
  const normalizedGross = Math.max(Math.round(grossAmountYen) || 0, 0)
  const normalizedDiscount = Math.max(Math.round(discountAmountYen) || 0, 0)
  const normalizedTaxiTicket = Math.max(Math.round(taxiTicketAmountYen) || 0, 0)
  const normalizedFinalCharge = Math.max(Math.round(finalChargeAmountYen) || 0, 0)
  const paymentTotalYen = sumPaymentAmountsYen(paymentAmounts)
  const differenceYen = paymentTotalYen - normalizedFinalCharge

  return {
    grossAmountYen: normalizedGross,
    discountAmountYen: normalizedDiscount,
    taxiTicketAmountYen: normalizedTaxiTicket,
    finalChargeAmountYen: normalizedFinalCharge,
    paymentTotalYen,
    differenceYen,
    canSave: differenceYen === 0,
  }
}

/**
 * 請求額が変わったとき、支払総額が「直前の請求額と一致」していれば
 * 新しい最終請求額へ自動追従する（割引適用後のずれ防止）。
 * 複数支払方法の併用中は内訳を壊さないため追従しない。
 */
export function shouldResyncPaymentAmountsToCharge({
  previousChargeYen,
  nextChargeYen,
  paymentTotalYen,
  paymentAmounts,
}: {
  previousChargeYen: number
  nextChargeYen: number
  paymentTotalYen: number
  paymentAmounts?: Record<PaymentMethod, number>
}): boolean {
  const previous = Math.max(Math.round(previousChargeYen) || 0, 0)
  const next = Math.max(Math.round(nextChargeYen) || 0, 0)
  const payment = Math.max(Math.round(paymentTotalYen) || 0, 0)

  if (previous === next) {
    return false
  }

  if (paymentAmounts) {
    const activeMethodCount = SETTLEMENT_PAYMENT_METHODS.filter(
      (method) => Math.max(Math.round(paymentAmounts[method]) || 0, 0) > 0,
    ).length
    if (activeMethodCount > 1) {
      return false
    }
  }

  if (payment === 0) {
    return true
  }

  return payment === previous
}

export function buildPaymentAmountsMatchingCharge(
  paymentMethod: PaymentMethod,
  chargeYen: number,
): Record<PaymentMethod, number> {
  return {
    ...createEmptyPaymentAmounts(),
    [paymentMethod]: Math.max(Math.round(chargeYen) || 0, 0),
  }
}
