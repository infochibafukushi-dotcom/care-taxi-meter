import { Link, Navigate, useSearchParams } from 'react-router-dom'
import {
  reviewDemoPreFixedFareReservationSummary,
} from '../fixtures/reviewDemoPreFixedFare'
import { formatFareYen } from '../services/fare'
import {
  formatMeterRunStatus,
  formatReservationStatus,
} from '../types/reservation'
import { ReviewDemoPageShell } from '../components/reviewDemo/ReviewDemoPageShell'
import {
  isPreFixedFareReviewDemoScenario,
  isReviewDemoQueryActive,
  withReviewDemoSearch,
} from '../utils/reviewDemo'
import { formatCaseDateTime } from '../utils/caseRecords'

const formatAddress = (address: string) => (address.trim() ? address : '住所未取得')

const formatOptionalText = (value: string) => (value.trim() ? value : '未設定')

export function ReviewDemoReservationListPage() {
  const [searchParams] = useSearchParams()

  if (!isReviewDemoQueryActive(`?${searchParams.toString()}`)) {
    return <Navigate to={withReviewDemoSearch('/review-demo/reservations')} replace />
  }

  if (!isPreFixedFareReviewDemoScenario(`?${searchParams.toString()}`)) {
    return (
      <ReviewDemoPageShell>
        <section className="content-card reservation-list-card">
          <p className="case-error" role="alert">
            未対応の審査用デモシナリオです。
          </p>
        </section>
      </ReviewDemoPageShell>
    )
  }

  const reservation = reviewDemoPreFixedFareReservationSummary

  return (
    <ReviewDemoPageShell>
      <section className="content-card reservation-list-card">
        <div className="reservation-list-header">
          <div>
            <p className="eyebrow">Review Demo</p>
            <h1 id="review-demo-reservation-list-title">審査用デモ予約一覧</h1>
          </div>
        </div>

        <p className="reservation-list-count" aria-live="polite">
          1件
        </p>

        <div className="reservation-record-list" aria-label="審査用デモ予約一覧">
          <Link
            className="reservation-record-row"
            to={withReviewDemoSearch(`/review-demo/reservations/${reservation.reservationId}`)}
          >
            <span>
              <small>予約ID</small>
              <strong>{reservation.reservationId}</strong>
            </span>
            <span>
              <small>見積番号</small>
              <strong>{formatOptionalText(reservation.estimateNo)}</strong>
            </span>
            <span>
              <small>予約日時</small>
              <strong>{formatCaseDateTime(reservation.scheduledAt)}</strong>
            </span>
            <span>
              <small>利用者</small>
              <strong>{formatOptionalText(reservation.customerName)}</strong>
            </span>
            <span className="reservation-record-address">
              <small>迎車</small>
              <strong>{formatAddress(reservation.pickupAddress)}</strong>
            </span>
            <span className="reservation-record-address">
              <small>降車</small>
              <strong>{formatAddress(reservation.destinationAddress)}</strong>
            </span>
            <span>
              <small>ステータス</small>
              <strong>{formatReservationStatus(reservation.status)}</strong>
            </span>
            <span>
              <small>メーター状態</small>
              <strong>{formatMeterRunStatus(reservation.meterRunStatus)}</strong>
            </span>
            <span>
              <small>確定運賃</small>
              <strong>{formatFareYen(reservation.confirmedFareYen)}円</strong>
            </span>
            <span>
              <small>運賃種別</small>
              <strong>{reservation.fareType}</strong>
            </span>
          </Link>
        </div>
      </section>
    </ReviewDemoPageShell>
  )
}
