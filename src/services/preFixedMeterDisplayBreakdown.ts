import type { FareBreakdown, FareLineItem } from './fare'
import type { ReservationTripContext } from './reservationTripContext'

const resolveServiceFeeLabel = (key: string, label: string) => {
  const trimmedLabel = label.trim()
  if (trimmedLabel) {
    return trimmedLabel
  }

  if (key === 'specialVehicleFee') {
    return '特殊車両使用料'
  }

  return key
}

/** 予約スナップショット由来の料金明細（0円は含めない） */
export const buildPreFixedReservationLineItems = (
  reservationContext: ReservationTripContext | null,
): FareLineItem[] => {
  if (!reservationContext) {
    return []
  }

  const items: FareLineItem[] = []
  const confirmedFareYen = Math.max(Math.round(reservationContext.confirmedFareYen), 0)

  if (confirmedFareYen > 0) {
    items.push({
      label: '事前確定運賃',
      amountYen: confirmedFareYen,
    })
  }

  const serviceFees = reservationContext.quoteSnapshot?.serviceFees ?? []
  for (const fee of serviceFees) {
    const amountYen = Math.max(Math.round(fee.amount), 0)
    if (amountYen <= 0) {
      continue
    }

    items.push({
      label: resolveServiceFeeLabel(fee.key, fee.label),
      amountYen,
    })
  }

  return items
}

/** 運行中に加算された分のみ（予約時点の内訳とは別明細） */
export const buildPreFixedOperationalLineItems = (
  operationalBreakdown: FareBreakdown,
): FareLineItem[] => {
  const items: FareLineItem[] = []

  const additionalRouteFareYen = Math.max(
    Math.round(operationalBreakdown.additionalRouteFareYen ?? 0),
    0,
  )
  if (additionalRouteFareYen > 0) {
    items.push({ label: '追加区間運賃', amountYen: additionalRouteFareYen })
  }

  const additionalCareFareYen = Math.max(
    Math.round(operationalBreakdown.additionalCareFareYen ?? 0),
    0,
  )
  if (additionalCareFareYen > 0) {
    items.push({ label: '追加介助料', amountYen: additionalCareFareYen })
  }

  const waitingFareYen = Math.max(Math.round(operationalBreakdown.waitingFareYen), 0)
  if (waitingFareYen > 0) {
    items.push({ label: '待機料金', amountYen: waitingFareYen })
  }

  const escortFareYen = Math.max(Math.round(operationalBreakdown.escortFareYen), 0)
  if (escortFareYen > 0) {
    items.push({ label: '付き添い料金', amountYen: escortFareYen })
  }

  const customFeeFareYen = Math.max(Math.round(operationalBreakdown.customFeeFareYen), 0)
  if (customFeeFareYen > 0) {
    items.push({ label: 'その他オプション', amountYen: customFeeFareYen })
  }

  const expenseFareYen = Math.max(Math.round(operationalBreakdown.expenseFareYen), 0)
  if (expenseFareYen > 0) {
    items.push({ label: '実費', amountYen: expenseFareYen })
  }

  if (operationalBreakdown.disabilityDiscountAmount > 0) {
    items.push({
      label: operationalBreakdown.discountName,
      amountYen: -operationalBreakdown.disabilityDiscountAmount,
    })
  }

  if (operationalBreakdown.taxiTicketAmountYen > 0) {
    items.push({
      label: 'タクシー券',
      amountYen: -operationalBreakdown.taxiTicketAmountYen,
    })
  }

  return items
}

/**
 * 事前確定Mの料金内訳表示用。
 * 合計・割引計算は operationalBreakdown をそのまま使い、明細だけ予約内容ベースに差し替える。
 */
export const buildPreFixedMeterDisplayBreakdown = (
  reservationContext: ReservationTripContext | null,
  operationalBreakdown: FareBreakdown,
): FareBreakdown => {
  const reservationItems = buildPreFixedReservationLineItems(reservationContext)
  const operationalItems = buildPreFixedOperationalLineItems(operationalBreakdown)

  return {
    ...operationalBreakdown,
    lineItems: [...reservationItems, ...operationalItems],
  }
}
