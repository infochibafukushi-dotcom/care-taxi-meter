import { formatFareYen } from '../../services/fare'
import type { DriverReservationSummary } from '../../types/reservation'
import { formatReservationStatus } from '../../types/reservation'
import { formatCaseDateTime } from '../../utils/caseRecords'
import {
  formatMeterRunStatusForList,
  formatPreFixedFareLabel,
  reservationCategoryLabels,
  resolveReservationCategory,
  type ReservationCategory,
} from '../../utils/reservationCategory'
import { resolveReservationIsTest } from '../../utils/testReservation'

const formatAddress = (address: string) => (address.trim() ? address : '住所未取得')

const categoryBadgeClass: Record<ReservationCategory, string> = {
  pre_fixed: 'pre-fixed-reservation-badge pre-fixed-reservation-badge--pre-fixed',
  normal: 'pre-fixed-reservation-badge pre-fixed-reservation-badge--normal',
  phone: 'pre-fixed-reservation-badge pre-fixed-reservation-badge--phone',
}

const resolveFareSummary = (
  category: ReservationCategory,
  reservation: DriverReservationSummary,
): string | null => {
  if (category === 'pre_fixed') {
    if (reservation.fixedFareTotalYen > 0) {
      return `請求予定 ${formatFareYen(reservation.fixedFareTotalYen)}円`
    }
    const preFixedLabel = formatPreFixedFareLabel(reservation)
    return preFixedLabel !== '未確定' ? `確定運賃 ${preFixedLabel}` : null
  }

  if (reservation.confirmedFareYen > 0) {
    return `確定運賃 ${formatFareYen(reservation.confirmedFareYen)}円`
  }

  return null
}

type UnifiedReservationCardProps = {
  reservation: DriverReservationSummary
  onSelect: (reservationId: string) => void
  actionLabel?: string
}

export function UnifiedReservationCard({
  reservation,
  onSelect,
  actionLabel = '詳細',
}: UnifiedReservationCardProps) {
  const category = resolveReservationCategory(reservation)
  const isTestReservation = resolveReservationIsTest(reservation)
  const customerName = reservation.customerName.trim() || '未設定'
  const fareSummary = resolveFareSummary(category, reservation)

  return (
    <button
      className="pre-fixed-unified-reservation-card"
      type="button"
      onClick={() => onSelect(reservation.reservationId)}
    >
      <div className="pre-fixed-unified-reservation-card__header">
        <div className="pre-fixed-unified-reservation-card__badges">
          {isTestReservation ? (
            <span className="pre-fixed-reservation-badge pre-fixed-reservation-badge--test">
              テスト予約
            </span>
          ) : null}
          <span className={categoryBadgeClass[category]}>
            {reservationCategoryLabels[category]}
          </span>
        </div>
        <span className="pre-fixed-unified-reservation-card__datetime">
          {formatCaseDateTime(reservation.scheduledAt)}
        </span>
      </div>

      <p className="pre-fixed-unified-reservation-card__customer">{customerName}</p>

      <div className="pre-fixed-unified-reservation-card__route">
        <p className="pre-fixed-unified-reservation-card__route-line">
          <span className="pre-fixed-unified-reservation-card__route-label">乗</span>
          <span className="pre-fixed-unified-reservation-card__route-text">
            {formatAddress(reservation.pickupAddress)}
          </span>
        </p>
        <p className="pre-fixed-unified-reservation-card__route-line">
          <span className="pre-fixed-unified-reservation-card__route-label">降</span>
          <span className="pre-fixed-unified-reservation-card__route-text">
            {formatAddress(reservation.destinationAddress)}
          </span>
        </p>
      </div>

      <div className="pre-fixed-unified-reservation-card__footer">
        <div className="pre-fixed-unified-reservation-card__status-group">
          <span className="pre-fixed-unified-reservation-card__status">
            {formatReservationStatus(reservation.status)}
          </span>
          <span className="pre-fixed-unified-reservation-card__meter-status">
            {formatMeterRunStatusForList(reservation.meterRunStatus)}
          </span>
        </div>
        {fareSummary ? (
          <span className="pre-fixed-unified-reservation-card__fare">{fareSummary}</span>
        ) : null}
        <span className="pre-fixed-unified-reservation-card__action">{actionLabel}</span>
      </div>
    </button>
  )
}
