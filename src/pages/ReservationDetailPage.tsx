import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import {
  fetchDriverReservation,
  startFixedFareRun,
} from '../services/reservationApi'
import {
  buildReservationTripContext,
  saveReservationTripContext,
} from '../services/reservationTripContext'
import { PreFixedFarePassengerChangeDetailSection } from '../components/case/PreFixedFarePassengerChangeDetailSection'
import type { DriverReservationDetail } from '../types/reservation'
import {
  formatMeterRunStatus,
  formatReservationStatus,
  isPreFixedFarePassengerChangeReservation,
} from '../types/reservation'
import {
  formatFixedFareCompletionReason,
  formatFixedFareCompletionStatus,
} from '../types/preFixedFare'
import { formatFareYen } from '../services/fare'
import { formatCaseDateTime } from '../utils/caseRecords'
import { formatElapsedTime } from '../utils/time'
import { logDiagnostic } from '../utils/diagnostics'

const formatAddress = (address: string) =>
  address.trim() ? address : '住所未取得'

const formatOptionalText = (value: string) =>
  value.trim() ? value : '未設定'

const formatVerificationBadge = (verified: boolean) =>
  verified ? 'OK' : '要確認'

type ReservationDetailState = {
  actionErrorMessage: string
  errorMessage: string
  isActionLoading: boolean
  isLoading: boolean
  reservation: DriverReservationDetail | null
}

type ReservationListLocationState = {
  listDate?: string
}

export function ReservationDetailPage() {
  const navigate = useNavigate()
  const { reservationId = '' } = useParams()
  const location = useLocation()
  const listDate = (location.state as ReservationListLocationState | null)?.listDate
  const backToListPath = listDate ? `/reservations?date=${encodeURIComponent(listDate)}` : '/reservations'
  const [state, setState] = useState<ReservationDetailState>({
    actionErrorMessage: '',
    errorMessage: '',
    isActionLoading: false,
    isLoading: true,
    reservation: null,
  })

  const loadReservation = useCallback(async (targetReservationId: string) => {
    const reservation = await fetchDriverReservation(targetReservationId)
    setState((current) => ({
      ...current,
      actionErrorMessage: '',
      errorMessage: '',
      isLoading: false,
      reservation,
    }))
    return reservation
  }, [])

  useEffect(() => {
    logDiagnostic('ReservationDetailPage mount', { reservationId })
    return () => logDiagnostic('ReservationDetailPage unmount', { reservationId })
  }, [reservationId])

  useEffect(() => {
    if (!reservationId) {
      setState({
        actionErrorMessage: '',
        errorMessage: '予約IDが指定されていません。',
        isActionLoading: false,
        isLoading: false,
        reservation: null,
      })
      return undefined
    }

    let isMounted = true

    setState((current) => ({
      ...current,
      actionErrorMessage: '',
      errorMessage: '',
      isLoading: true,
      reservation: null,
    }))

    loadReservation(reservationId).catch((error) => {
      if (!isMounted) {
        return
      }

      setState((current) => ({
        ...current,
        errorMessage:
          error instanceof Error
            ? error.message
            : '予約詳細の取得に失敗しました。',
        isLoading: false,
        reservation: null,
      }))
    })

    return () => {
      isMounted = false
    }
  }, [loadReservation, reservationId])

  const handleStartFixedFareRun = async () => {
    if (!reservationId || state.isActionLoading) {
      return
    }

    if (readActiveTripSnapshot()) {
      setState((current) => ({
        ...current,
        actionErrorMessage:
          '未終了の運行があります。予約連携を開始する前に、メーター画面で運行を終了または復元してください。',
      }))
      return
    }

    setState((current) => ({
      ...current,
      actionErrorMessage: '',
      isActionLoading: true,
    }))

    try {
      await startFixedFareRun(reservationId)
      const reservation = await loadReservation(reservationId)
      saveReservationTripContext(buildReservationTripContext(reservation))
      navigate(`/case/start?reservationId=${encodeURIComponent(reservationId)}`)
    } catch (error) {
      setState((current) => ({
        ...current,
        actionErrorMessage:
          error instanceof Error
            ? error.message
            : '事前確定Mの開始に失敗しました。',
      }))
    } finally {
      setState((current) => ({
        ...current,
        isActionLoading: false,
      }))
    }
  }

  const handleReturnToActiveMeter = () => {
    if (!reservationId) {
      return
    }

    const activeTripSnapshot = readActiveTripSnapshot()

    if (!activeTripSnapshot) {
      setState((current) => ({
        ...current,
        actionErrorMessage:
          'この端末に運行中メーターデータがありません。別端末で開始したか、データが消えた可能性があります。',
      }))
      return
    }

    const snapshotReservationId = activeTripSnapshot.reservationId?.trim() ?? ''
    if (snapshotReservationId && snapshotReservationId !== reservationId) {
      setState((current) => ({
        ...current,
        actionErrorMessage:
          '別の未終了運行があります。先にそちらを復元または終了してください。',
      }))
      return
    }

    setState((current) => ({
      ...current,
      actionErrorMessage: '',
    }))
    navigate('/case')
  }

  const reservation = state.reservation
  const meterRunStatus = reservation?.meterRunStatus ?? ''
  const isPassengerChangeCompletion = reservation
    ? isPreFixedFarePassengerChangeReservation(reservation)
    : false
  const showPassengerChangePanel = Boolean(reservation?.preFixedFareException)

  return (
    <main className="page reservation-detail-page" aria-labelledby="reservation-detail-title">
      <section className="content-card reservation-detail-card">
        <div className="reservation-detail-header">
          <div>
            <Link className="text-link" to={backToListPath}>
              ← 一覧へ戻る
            </Link>
            <p className="eyebrow">Reservation Detail</p>
            <h1 id="reservation-detail-title">予約詳細</h1>
          </div>
        </div>

        {state.isLoading ? (
          <p className="empty-note">予約詳細を取得中です。</p>
        ) : null}

        {state.errorMessage ? (
          <p className="case-error" role="alert">
            {state.errorMessage}
          </p>
        ) : null}

        {state.actionErrorMessage ? (
          <p className="case-error" role="alert">
            {state.actionErrorMessage}
          </p>
        ) : null}

        {reservation ? (
          <div className="reservation-detail-grid">
            {meterRunStatus === 'not_started' ||
            meterRunStatus === 'in_progress' ||
            meterRunStatus === 'completed' ? (
              <section className="reservation-detail-section" aria-label="事前確定M 運行">
                <h2>事前確定M 運行</h2>
                {meterRunStatus === 'not_started' ? (
                  <button
                    className="primary-action"
                    type="button"
                    disabled={state.isActionLoading}
                    onClick={handleStartFixedFareRun}
                  >
                    {state.isActionLoading ? '開始処理中…' : '事前確定Mで開始'}
                  </button>
                ) : null}
                {meterRunStatus === 'in_progress' ? (
                  <>
                    <p className="reservation-run-status">事前確定M 運行中</p>
                    <button
                      className="primary-action"
                      type="button"
                      onClick={handleReturnToActiveMeter}
                    >
                      運行中のメーターへ戻る
                    </button>
                  </>
                ) : null}
                {meterRunStatus === 'completed' ? (
                  <p className="reservation-run-status">
                    {isPassengerChangeCompletion
                      ? '事前確定M 旅客都合途中終了'
                      : '事前確定M 完了'}
                  </p>
                ) : null}
              </section>
            ) : null}

            {showPassengerChangePanel && reservation ? (
              <PreFixedFarePassengerChangeDetailSection
                completionStatusLabel={
                  reservation.fixedFareCompletionStatus === 'completed_with_passenger_change'
                    ? formatFixedFareCompletionStatus(reservation.fixedFareCompletionStatus)
                    : isPassengerChangeCompletion
                      ? formatFixedFareCompletionStatus('completed_with_passenger_change')
                      : null
                }
                completionReasonLabel={
                  reservation.fixedFareCompletionReason
                    ? formatFixedFareCompletionReason(reservation.fixedFareCompletionReason)
                    : null
                }
                preFixedFareException={reservation.preFixedFareException}
              />
            ) : null}

            <section className="reservation-detail-section" aria-label="検証結果">
              <h2>検証結果</h2>
              <div className="reservation-verification-badges">
                <span
                  className={`reservation-verification-badge reservation-verification-badge--${
                    reservation.snapshotHashVerified ? 'ok' : 'warn'
                  }`}
                >
                  スナップショット検証: {formatVerificationBadge(reservation.snapshotHashVerified)}
                </span>
                <span
                  className={`reservation-verification-badge reservation-verification-badge--${
                    reservation.fareMatch ? 'ok' : 'warn'
                  }`}
                >
                  料金整合: {formatVerificationBadge(reservation.fareMatch)}
                </span>
                <span
                  className={`reservation-verification-badge reservation-verification-badge--${
                    reservation.integrity.consentSnapshotHashMatches ? 'ok' : 'warn'
                  }`}
                >
                  同意スナップショット: {formatVerificationBadge(reservation.integrity.consentSnapshotHashMatches)}
                </span>
              </div>
            </section>

            <section className="reservation-detail-section" aria-label="基本情報">
              <h2>基本情報</h2>
              <dl className="reservation-detail-dl">
                <div><dt>予約ID</dt><dd>{reservation.reservationId}</dd></div>
                <div><dt>見積番号</dt><dd>{formatOptionalText(reservation.estimateNo)}</dd></div>
                <div><dt>予約日時</dt><dd>{formatCaseDateTime(reservation.scheduledAt)}</dd></div>
                <div><dt>ステータス</dt><dd>{formatReservationStatus(reservation.status)}</dd></div>
                <div><dt>メーター状態</dt><dd>{formatMeterRunStatus(reservation.meterRunStatus)}</dd></div>
                <div><dt>事前確定M</dt><dd>{reservation.fixedFare.preFixedFareConfirmable ? '対象' : '対象外'}</dd></div>
              </dl>
            </section>

            <section className="reservation-detail-section" aria-label="利用者情報">
              <h2>利用者</h2>
              <dl className="reservation-detail-dl">
                <div><dt>氏名</dt><dd>{formatOptionalText(reservation.customer.name)}</dd></div>
                <div><dt>フリガナ</dt><dd>{formatOptionalText(reservation.customer.kana)}</dd></div>
                <div><dt>電話</dt><dd>{formatOptionalText(reservation.customer.phone)}</dd></div>
                <div><dt>メール</dt><dd>{formatOptionalText(reservation.customer.email)}</dd></div>
              </dl>
            </section>

            <section className="reservation-detail-section" aria-label="行程">
              <h2>行程</h2>
              <dl className="reservation-detail-dl">
                <div><dt>日付</dt><dd>{reservation.trip.date}</dd></div>
                <div><dt>時刻</dt><dd>{reservation.trip.time}</dd></div>
                <div><dt>迎車</dt><dd>{formatAddress(reservation.trip.pickupAddress)}</dd></div>
                <div><dt>降車</dt><dd>{formatAddress(reservation.trip.destinationAddress)}</dd></div>
                <div><dt>車両</dt><dd>{formatOptionalText(reservation.trip.vehicle)}</dd></div>
                <div><dt>備考</dt><dd>{formatOptionalText(reservation.trip.notes)}</dd></div>
              </dl>
            </section>

            <section className="reservation-detail-section" aria-label="料金">
              <h2>料金</h2>
              <dl className="reservation-detail-dl">
                <div><dt>確定運賃</dt><dd>{formatFareYen(reservation.fixedFare.confirmedFareYen)}円</dd></div>
                <div><dt>事前確定運賃本体</dt><dd>{formatFareYen(reservation.fixedFare.fixedFareTotalYen)}円</dd></div>
                <div><dt>運賃種別</dt><dd>{reservation.fixedFare.fareType}</dd></div>
                <div><dt>高速利用</dt><dd>{reservation.fixedFare.useToll ? 'あり' : 'なし'}</dd></div>
                <div><dt>ルートID</dt><dd>{formatOptionalText(reservation.fixedFare.selectedRouteId)}</dd></div>
                <div><dt>料金確定日時</dt><dd>{formatCaseDateTime(reservation.fixedFare.fareLockedAt)}</dd></div>
              </dl>
              {reservation.quoteSnapshot.serviceFees.length > 0 ? (
                <div className="reservation-service-fees">
                  <h3>サービス料金</h3>
                  <ul>
                    {reservation.quoteSnapshot.serviceFees.map((fee) => (
                      <li key={fee.key}>
                        {fee.label}: {formatFareYen(fee.amount)}円
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <dl className="reservation-detail-dl">
                <div><dt>見積距離</dt><dd>{(reservation.quoteSnapshot.distanceMeters / 1000).toFixed(1)} km</dd></div>
                <div><dt>見積時間</dt><dd>{formatElapsedTime(reservation.quoteSnapshot.durationSeconds)}</dd></div>
                <div><dt>見積モード</dt><dd>{reservation.quoteSnapshot.fareMode}</dd></div>
              </dl>
            </section>

            <section className="reservation-detail-section" aria-label="同意証跡">
              <h2>同意証跡</h2>
              <dl className="reservation-detail-dl">
                <div><dt>同意日時</dt><dd>{formatCaseDateTime(reservation.consent.consentAt)}</dd></div>
                <div><dt>同意文バージョン</dt><dd>{formatOptionalText(reservation.consent.consentTextVersion)}</dd></div>
                <div><dt>見積運賃</dt><dd>{formatFareYen(reservation.consent.quotedFareYen)}円</dd></div>
                <div><dt>ソース</dt><dd>{formatOptionalText(reservation.consent.source)}</dd></div>
                <div><dt>スナップショットハッシュ</dt><dd className="reservation-hash">{reservation.consent.snapshotHash}</dd></div>
              </dl>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  )
}
