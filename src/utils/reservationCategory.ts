import type { DriverReservationDetail, DriverReservationSummary } from '../types/reservation'

export type ReservationCategory = 'pre_fixed' | 'normal' | 'phone'

export const reservationCategoryLabels: Record<ReservationCategory, string> = {
  pre_fixed: '事前確定',
  normal: '通常予約',
  phone: '電話予約',
}

type ReservationCategoryInput = Pick<
  DriverReservationSummary,
  'fareType' | 'preFixedFareConfirmable' | 'confirmedFareYen' | 'consentAt'
>

const normalizeCategoryInput = (
  reservation: ReservationCategoryInput | DriverReservationDetail,
): ReservationCategoryInput => {
  if ('fixedFare' in reservation) {
    return {
      fareType: reservation.fixedFare.fareType,
      preFixedFareConfirmable: reservation.fixedFare.preFixedFareConfirmable,
      confirmedFareYen: reservation.fixedFare.confirmedFareYen,
      consentAt: reservation.consent.consentAt,
    }
  }

  return reservation
}

export const resolveReservationCategory = (
  reservation: ReservationCategoryInput | DriverReservationDetail,
): ReservationCategory => {
  const normalized = normalizeCategoryInput(reservation)
  const fareType = normalized.fareType.trim()

  if (fareType.includes('電話')) {
    return 'phone'
  }

  if (
    normalized.preFixedFareConfirmable &&
    normalized.confirmedFareYen > 0 &&
    (fareType.includes('事前確定') || Boolean(normalized.consentAt?.trim()))
  ) {
    return 'pre_fixed'
  }

  if (normalized.preFixedFareConfirmable && normalized.confirmedFareYen > 0) {
    return 'pre_fixed'
  }

  return 'normal'
}

export const isPreFixedReservationReady = (
  reservation: DriverReservationDetail,
): boolean => {
  if (resolveReservationCategory(reservation) !== 'pre_fixed') {
    return false
  }

  if (reservation.routePlan && typeof reservation.routePlan === 'object') {
    const plan = reservation.routePlan as Record<string, unknown>
    if (Array.isArray(plan.stops) && plan.stops.length >= 2) {
      return reservation.fixedFare.confirmedFareYen > 0
    }
  }

  return (
    reservation.trip.pickupAddress.trim().length > 0 &&
    reservation.trip.destinationAddress.trim().length > 0 &&
    reservation.fixedFare.confirmedFareYen > 0
  )
}

export const formatPreFixedFareLabel = (
  reservation: Pick<DriverReservationSummary, 'confirmedFareYen' | 'preFixedFareConfirmable'>,
): string => {
  if (reservation.preFixedFareConfirmable && reservation.confirmedFareYen > 0) {
    return `${reservation.confirmedFareYen.toLocaleString('ja-JP')}円`
  }
  return '未確定'
}

export const formatMeterRunStatusForList = (status: string): string => {
  if (status === 'not_started') {
    return '未開始'
  }
  if (status === 'in_progress') {
    return '開始済み'
  }
  if (status === 'completed') {
    return '完了'
  }
  return status
}
