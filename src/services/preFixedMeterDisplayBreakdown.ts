import type { FareBreakdown, FareLineItem } from './fare'
import {
  buildWaitingEscortFareDisplayLabel,
  isEscortServiceFeeKey,
  isWaitingServiceFeeKey,
} from './fare'
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

/** 予約スナップショット由来の料金明細（待機／付き添いは統合行へ回すため除外） */
export const buildPreFixedReservationLineItems = (
  reservationContext: ReservationTripContext | null,
  options?: { omitWaitingEscort?: boolean },
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

  const omitWaitingEscort = options?.omitWaitingEscort !== false
  const serviceFees = reservationContext.quoteSnapshot?.serviceFees ?? []
  for (const fee of serviceFees) {
    const amountYen = Math.max(Math.round(fee.amount), 0)
    if (amountYen <= 0) {
      continue
    }
    if (omitWaitingEscort && (isWaitingServiceFeeKey(fee.key) || isEscortServiceFeeKey(fee.key))) {
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
  options?: {
    /** 予約 serviceFees があるときは小計行を出さず二重表示を避ける */
    omitCareSubtotal?: boolean
    /** 待機／付き添いは統合行側で出すためここには出さない */
    omitWaitingEscort?: boolean
  },
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
  if (!options?.omitCareSubtotal && additionalCareFareYen > 0) {
    items.push({ label: '介助・サービス料金小計', amountYen: additionalCareFareYen })
  }

  if (!options?.omitWaitingEscort) {
    const waitingFareYen = Math.max(Math.round(operationalBreakdown.waitingFareYen), 0)
    if (waitingFareYen > 0) {
      items.push({ label: '待機料金', amountYen: waitingFareYen })
    }

    const escortFareYen = Math.max(Math.round(operationalBreakdown.escortFareYen), 0)
    if (escortFareYen > 0) {
      items.push({ label: '付き添い料金', amountYen: escortFareYen })
    }
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
 * 待機／付き添いは事前選択＋実時間の最終合計を各1行で出す。
 */
export const buildPreFixedMeterDisplayBreakdown = (
  reservationContext: ReservationTripContext | null,
  operationalBreakdown: FareBreakdown,
  options?: {
    waitingSeconds?: number
    escortSeconds?: number
    waitingPrepaidUnits?: number
    escortPrepaidUnits?: number
  },
): FareBreakdown => {
  const serviceFees = reservationContext?.quoteSnapshot?.serviceFees ?? []
  const hasReservationServiceFees = serviceFees.some(
    (fee) =>
      Number.isFinite(fee.amount) &&
      fee.amount > 0 &&
      !isWaitingServiceFeeKey(fee.key) &&
      !isEscortServiceFeeKey(fee.key),
  )

  const waitingSeconds = Math.max(0, Math.floor(options?.waitingSeconds ?? 0))
  const escortSeconds = Math.max(0, Math.floor(options?.escortSeconds ?? 0))
  const waitingPrepaidUnits = Math.max(0, Math.floor(options?.waitingPrepaidUnits ?? 0))
  const escortPrepaidUnits = Math.max(0, Math.floor(options?.escortPrepaidUnits ?? 0))

  const reservationItems = buildPreFixedReservationLineItems(reservationContext, {
    omitWaitingEscort: true,
  })
  const operationalItems = buildPreFixedOperationalLineItems(operationalBreakdown, {
    omitCareSubtotal: hasReservationServiceFees || Boolean(reservationContext),
    omitWaitingEscort: true,
  })

  const timedFeeItems: FareLineItem[] = []
  const waitingFareYen = Math.max(Math.round(operationalBreakdown.waitingFareYen), 0)
  if (waitingFareYen > 0) {
    timedFeeItems.push({
      label: buildWaitingEscortFareDisplayLabel({
        kind: 'waiting',
        elapsedSeconds: waitingSeconds,
        prepaidUnits: waitingPrepaidUnits,
      }),
      amountYen: waitingFareYen,
    })
  }

  const escortFareYen = Math.max(Math.round(operationalBreakdown.escortFareYen), 0)
  if (escortFareYen > 0) {
    timedFeeItems.push({
      label: buildWaitingEscortFareDisplayLabel({
        kind: 'escort',
        elapsedSeconds: escortSeconds,
        prepaidUnits: escortPrepaidUnits,
      }),
      amountYen: escortFareYen,
    })
  }

  // 割引・タクシー券は operational 末尾にあるので、その前に待機／付き添いを差し込む
  const discountAndTicketLabels = new Set([
    operationalBreakdown.discountName,
    'タクシー券',
  ])
  const beforeDiscount: FareLineItem[] = []
  const afterDiscount: FareLineItem[] = []
  for (const item of operationalItems) {
    if (discountAndTicketLabels.has(item.label) || item.amountYen < 0) {
      afterDiscount.push(item)
    } else {
      beforeDiscount.push(item)
    }
  }

  return {
    ...operationalBreakdown,
    lineItems: [...reservationItems, ...beforeDiscount, ...timedFeeItems, ...afterDiscount],
  }
}
