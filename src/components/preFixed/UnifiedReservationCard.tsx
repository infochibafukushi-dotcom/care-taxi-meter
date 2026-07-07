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

const formatConfirmedFare = (confirmedFareYen: number) =>
  confirmedFareYen > 0 ? `${formatFareYen(confirmedFareYen)}円` : '未設定'

const formatAddress = (address: string) => (address.trim() ? address : '住所未取得')

const formatOptionalText = (value: string) => (value.trim() ? value : '未設定')

const categoryBadgeClass: Record<ReservationCategory, string> = {
  pre_fixed: 'pre-fixed-reservation-badge pre-fixed-reservation-badge--pre-fixed',
  normal: 'pre-fixed-reservation-badge pre-fixed-reservation-badge--normal',
  phone: 'pre-fixed-reservation-badge pre-fixed-reservation-badge--phone',
}

type UnifiedReservationCardProps = {
  reservation: DriverReservationSummary
  onSelect: (reservationId: string) => void
}

export function UnifiedReservationCard({ reservation, onSelect }: UnifiedReservationCardProps) {
  const category = resolveReservationCategory(reservation)
  const destination = reservation.destinationAddress.trim()
  const billingTotal =
    reservation.fixedFareTotalYen > 0 ? formatFareYen(reservation.fixedFareTotalYen) : null

  return (
    <button
      className="pre-fixed-unified-reservation-card"
      type="button"
      onClick={() => onSelect(reservation.reservationId)}
    >
      <div className="pre-fixed-unified-reservation-card__header">
        <span className={categoryBadgeClass[category]}>
          {reservationCategoryLabels[category]}
        </span>
        <span className="pre-fixed-unified-reservation-card__datetime">
          {formatCaseDateTime(reservation.scheduledAt)}
        </span>
      </div>

      <div className="pre-fixed-unified-reservation-card__grid">
        <div className="pre-fixed-unified-reservation-card__field">
          <small>予約ID</small>
          <strong>{reservation.reservationId}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field">
          <small>利用者名</small>
          <strong>{formatOptionalText(reservation.customerName)}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field">
          <small>電話番号</small>
          <strong>{formatOptionalText(reservation.customerPhone)}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field pre-fixed-unified-reservation-card__field--wide">
          <small>迎車地 / S地点</small>
          <strong>{formatAddress(reservation.pickupAddress)}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field pre-fixed-unified-reservation-card__field--wide">
          <small>目的地 / G地点</small>
          <strong>{formatAddress(destination)}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field">
          <small>確定運賃</small>
          <strong>{formatConfirmedFare(reservation.confirmedFareYen)}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field">
          <small>事前確定運賃</small>
          <strong>{formatPreFixedFareLabel(reservation)}</strong>
        </div>
        {billingTotal ? (
          <div className="pre-fixed-unified-reservation-card__field">
            <small>請求予定合計</small>
            <strong className="pre-fixed-amount-line">{billingTotal}円</strong>
          </div>
        ) : null}
        <div className="pre-fixed-unified-reservation-card__field">
          <small>メーター状態</small>
          <strong>{formatMeterRunStatusForList(reservation.meterRunStatus)}</strong>
        </div>
        <div className="pre-fixed-unified-reservation-card__field">
          <small>ステータス</small>
          <strong>{formatReservationStatus(reservation.status)}</strong>
        </div>
      </div>
    </button>
  )
}
