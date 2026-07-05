import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  buildReviewDemoReservationTripContext,
  reviewDemoConfirmedFareBreakdownTotalYen,
  reviewDemoPreFixedFareReservationDetail,
} from '../fixtures/reviewDemoPreFixedFare'
import { ReviewDemoPageShell } from '../components/reviewDemo/ReviewDemoPageShell'
import { formatFareYen } from '../services/fare'
import {
  markReviewDemoRunInProgress,
  readReviewDemoRunState,
} from '../services/reviewDemoRunState'
import {
  readReviewDemoActiveTripSnapshot,
  saveReviewDemoReservationTripContext,
} from '../services/reviewDemoStorage'
import { formatMeterRunStatus, formatReservationStatus } from '../types/reservation'
import { formatCaseDateTime } from '../utils/caseRecords'
import { formatElapsedTime } from '../utils/time'
import {
  isPreFixedFareReviewDemoScenario,
  isReviewDemoQueryActive,
  REVIEW_DEMO_RESERVATION_ID,
  withReviewDemoSearch,
} from '../utils/reviewDemo'

const formatAddress = (address: string) => (address.trim() ? address : '住所未取得')
const formatOptionalText = (value: string) => (value.trim() ? value : '未設定')
const formatVerificationBadge = (verified: boolean) => (verified ? 'OK' : '要確認')

export function ReviewDemoReservationDetailPage() {
  const navigate = useNavigate()
  const { reservationId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const [isStarting, setIsStarting] = useState(false)
  const [actionErrorMessage, setActionErrorMessage] = useState('')
  const runState = readReviewDemoRunState()
  const reservation = useMemo(() => {
    const base = reviewDemoPreFixedFareReservationDetail
    return {
      ...base,
      meterRunStatus: runState.meterRunStatus,
    }
  }, [runState.meterRunStatus])

  if (!isReviewDemoQueryActive(`?${searchParams.toString()}`)) {
    return (
      <Navigate
        to={withReviewDemoSearch(`/review-demo/reservations/${reservationId || REVIEW_DEMO_RESERVATION_ID}`)}
        replace
      />
    )
  }

  if (reservationId !== REVIEW_DEMO_RESERVATION_ID) {
    return (
      <ReviewDemoPageShell backTo={withReviewDemoSearch('/review-demo/reservations')} backLabel="← 一覧へ戻る">
        <section className="content-card reservation-detail-card">
          <p className="case-error" role="alert">
            指定された審査用デモ予約が見つかりません。
          </p>
        </section>
      </ReviewDemoPageShell>
    )
  }

  if (!isPreFixedFareReviewDemoScenario(`?${searchParams.toString()}`)) {
    return (
      <ReviewDemoPageShell backTo={withReviewDemoSearch('/review-demo/reservations')} backLabel="← 一覧へ戻る">
        <section className="content-card reservation-detail-card">
          <p className="case-error" role="alert">
            未対応の審査用デモシナリオです。
          </p>
        </section>
      </ReviewDemoPageShell>
    )
  }

  const quoteServiceFees = reservation.quoteSnapshot.serviceFees

  const handleStartFixedFareRun = () => {
    if (isStarting) {
      return
    }

    setActionErrorMessage('')
    setIsStarting(true)

    try {
      saveReviewDemoReservationTripContext(buildReviewDemoReservationTripContext())
      markReviewDemoRunInProgress()
      navigate(withReviewDemoSearch(`/review-demo/case/start?reservationId=${encodeURIComponent(reservationId)}`))
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error ? error.message : '審査用デモ運行の開始に失敗しました。',
      )
    } finally {
      setIsStarting(false)
    }
  }

  const handleReturnToActiveMeter = () => {
    if (!readReviewDemoActiveTripSnapshot()) {
      setActionErrorMessage('この端末に運行中メーターデータがありません。')
      return
    }

    navigate(withReviewDemoSearch('/review-demo/case'))
  }

  return (
    <ReviewDemoPageShell
      backTo={withReviewDemoSearch('/review-demo/reservations')}
      backLabel="← 一覧へ戻る"
    >
      <section className="content-card reservation-detail-card">
        <div className="reservation-detail-header">
          <div>
            <p className="eyebrow">Review Demo Detail</p>
            <h1 id="review-demo-reservation-detail-title">審査用デモ予約詳細</h1>
          </div>
        </div>

        {actionErrorMessage ? (
          <p className="case-error" role="alert">
            {actionErrorMessage}
          </p>
        ) : null}

        <div className="reservation-detail-grid">
          <section className="reservation-detail-section" aria-label="事前確定M 運行">
            <h2>事前確定M 運行</h2>
            {reservation.meterRunStatus === 'not_started' ? (
              <button
                className="primary-action"
                type="button"
                disabled={isStarting}
                onClick={handleStartFixedFareRun}
              >
                {isStarting ? '開始処理中…' : '事前確定Mで開始'}
              </button>
            ) : null}
            {reservation.meterRunStatus === 'in_progress' ? (
              <>
                <p className="reservation-run-status">事前確定M 運行中</p>
                <button className="primary-action" type="button" onClick={handleReturnToActiveMeter}>
                  運行中のメーターへ戻る
                </button>
              </>
            ) : null}
            {reservation.meterRunStatus === 'completed' ? (
              <p className="reservation-run-status">事前確定M 完了</p>
            ) : null}
          </section>

          <section className="reservation-detail-section" aria-label="検証結果">
            <h2>検証結果</h2>
            <div className="reservation-verification-badges">
              <span className="reservation-verification-badge reservation-verification-badge--ok">
                スナップショット検証: {formatVerificationBadge(reservation.snapshotHashVerified)}
              </span>
              <span className="reservation-verification-badge reservation-verification-badge--ok">
                料金整合: {formatVerificationBadge(reservation.fareMatch)}
              </span>
              <span className="reservation-verification-badge reservation-verification-badge--ok">
                同意スナップショット:{' '}
                {formatVerificationBadge(reservation.integrity.consentSnapshotHashMatches)}
              </span>
            </div>
          </section>

          <section className="reservation-detail-section" aria-label="基本情報">
            <h2>基本情報</h2>
            <dl className="reservation-detail-dl">
              <div>
                <dt>予約ID</dt>
                <dd>{reservation.reservationId}</dd>
              </div>
              <div>
                <dt>予約日時</dt>
                <dd>{formatCaseDateTime(reservation.scheduledAt)}</dd>
              </div>
              <div>
                <dt>ステータス</dt>
                <dd>{formatReservationStatus(reservation.status)}</dd>
              </div>
              <div>
                <dt>メーター状態</dt>
                <dd>{formatMeterRunStatus(reservation.meterRunStatus)}</dd>
              </div>
              <div>
                <dt>事前確定M</dt>
                <dd>{reservation.fixedFare.preFixedFareConfirmable ? '対象' : '対象外'}</dd>
              </div>
            </dl>
          </section>

          <section className="reservation-detail-section" aria-label="利用者情報">
            <h2>利用者</h2>
            <dl className="reservation-detail-dl">
              <div>
                <dt>氏名</dt>
                <dd>{formatOptionalText(reservation.customer.name)}</dd>
              </div>
            </dl>
          </section>

          <section className="reservation-detail-section" aria-label="行程">
            <h2>行程</h2>
            <dl className="reservation-detail-dl">
              <div>
                <dt>日付</dt>
                <dd>{reservation.trip.date}</dd>
              </div>
              <div>
                <dt>時刻</dt>
                <dd>{reservation.trip.time}</dd>
              </div>
              <div>
                <dt>迎車</dt>
                <dd>{formatAddress(reservation.trip.pickupAddress)}</dd>
              </div>
              <div>
                <dt>降車</dt>
                <dd>{formatAddress(reservation.trip.destinationAddress)}</dd>
              </div>
            </dl>
          </section>

          <section className="reservation-detail-section" aria-label="料金">
            <h2>料金</h2>
            <dl className="reservation-detail-dl">
              <div>
                <dt>確定運賃（予約時同意額）</dt>
                <dd>{formatFareYen(reservation.fixedFare.confirmedFareYen)}円</dd>
              </div>
              <div>
                <dt>運賃種別</dt>
                <dd>{reservation.fixedFare.fareType}</dd>
              </div>
            </dl>

            <div className="reservation-fare-breakdown">
              <h3>確定運賃の内訳</h3>
              <dl className="reservation-detail-dl">
                <div>
                  <dt>運賃本体</dt>
                  <dd>{formatFareYen(reservation.fixedFare.fixedFareTotalYen)}円</dd>
                </div>
                {quoteServiceFees.map((fee) => (
                  <div key={fee.key}>
                    <dt>{fee.label}</dt>
                    <dd>{formatFareYen(fee.amount)}円</dd>
                  </div>
                ))}
                <div>
                  <dt>内訳合計</dt>
                  <dd>{formatFareYen(reviewDemoConfirmedFareBreakdownTotalYen)}円</dd>
                </div>
              </dl>
            </div>

            <dl className="reservation-detail-dl">
              <div>
                <dt>見積距離</dt>
                <dd>{(reservation.quoteSnapshot.distanceMeters / 1000).toFixed(1)} km</dd>
              </div>
              <div>
                <dt>見積時間</dt>
                <dd>{formatElapsedTime(reservation.quoteSnapshot.durationSeconds)}</dd>
              </div>
            </dl>
          </section>

          <section className="reservation-detail-section" aria-label="同意証跡">
            <h2>同意証跡</h2>
            <dl className="reservation-detail-dl">
              <div>
                <dt>同意日時</dt>
                <dd>{formatCaseDateTime(reservation.consent.consentAt)}</dd>
              </div>
              <div>
                <dt>同意状態</dt>
                <dd>同意済み</dd>
              </div>
              <div>
                <dt>見積運賃</dt>
                <dd>{formatFareYen(reservation.consent.quotedFareYen)}円</dd>
              </div>
            </dl>
          </section>
        </div>

        <p className="save-note">
          <Link className="text-link" to={withReviewDemoSearch('/review-demo/reservations')}>
            審査用デモ予約一覧へ戻る
          </Link>
        </p>
      </section>
    </ReviewDemoPageShell>
  )
}
