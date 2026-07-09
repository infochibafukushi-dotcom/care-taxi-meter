import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import {
  fetchDriverReservation,
  resetFixedFareRun,
} from '../services/reservationApi'
import {
  clearReservationTripContext,
} from '../services/reservationTripContext'
import { PreFixedFarePassengerChangeDetailSection } from '../components/case/PreFixedFarePassengerChangeDetailSection'
import type { DriverReservationDetail, ReservationServiceFee } from '../types/reservation'
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
import { resolveReservationIsTest } from '../utils/testReservation'

const formatAddress = (address: string) =>
  address.trim() ? address : '住所未取得'

const formatOptionalText = (value: string | null | undefined) =>
  (value ?? '').trim() ? (value ?? '').trim() : '未設定'

const formatVerificationBadge = (verified: boolean) =>
  verified ? 'OK' : '要確認'

/** reservation-v4 の calculateTotalFromSnapshot と同じく、確定運賃合計から除外するサービス料金キー */
const SERVICE_FEE_KEYS_EXCLUDED_FROM_CONFIRMED_TOTAL = new Set(['specialVehicleFee'])

const partitionQuoteServiceFees = (serviceFees: ReservationServiceFee[]) => {
  const includedInConfirmedFare: ReservationServiceFee[] = []
  const excludedFromConfirmedFare: ReservationServiceFee[] = []

  for (const fee of serviceFees) {
    if (SERVICE_FEE_KEYS_EXCLUDED_FROM_CONFIRMED_TOTAL.has(fee.key)) {
      excludedFromConfirmedFare.push(fee)
    } else {
      includedInConfirmedFare.push(fee)
    }
  }

  return { includedInConfirmedFare, excludedFromConfirmedFare }
}

const resolveActiveTripRestoreState = (currentReservationId: string) => {
  const activeTripSnapshot = readActiveTripSnapshot()

  if (!activeTripSnapshot) {
    return {
      canRestore: false,
      needsReset: true,
      message:
        'この端末に運行中メーターデータがありません。別端末で開始したか、データが消えた可能性があります。',
    }
  }

  const snapshotReservationId = activeTripSnapshot.reservationId?.trim() ?? ''
  if (snapshotReservationId && snapshotReservationId !== currentReservationId) {
    return {
      canRestore: false,
      needsReset: true,
      message: '別の未終了運行があります。先にそちらを復元または終了してください。',
    }
  }

  return {
    canRestore: true,
    needsReset: false,
    message: '',
  }
}

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

  const handleStartFixedFareRun = () => {
    if (!reservationId || !state.reservation) {
      return
    }

    const query = new URLSearchParams()
    if (listDate) {
      query.set('date', listDate)
    }
    query.set('reservationId', reservationId)
    query.set('autoOpen', '1')
    navigate(`/case/pre-fixed/reservations?${query.toString()}`)
  }

  const handleReturnToActiveMeter = () => {
    if (!reservationId) {
      return
    }

    const restoreState = resolveActiveTripRestoreState(reservationId)
    if (!restoreState.canRestore) {
      setState((current) => ({
        ...current,
        actionErrorMessage: restoreState.message,
      }))
      return
    }

    setState((current) => ({
      ...current,
      actionErrorMessage: '',
    }))
    navigate('/case')
  }

  const handleResetMeterRunStatus = async () => {
    if (!reservationId || state.isActionLoading) {
      return
    }

    const confirmed = window.confirm(
      'この予約の運行中状態をリセットします。メーター精算・売上保存は行われません。テストデータや復元不能な場合のみ実行してください。よろしいですか？',
    )
    if (!confirmed) {
      return
    }

    const enteredReservationId = window.prompt('確認のため、予約IDを入力してください。', '')?.trim() ?? ''
    if (!enteredReservationId) {
      setState((current) => ({
        ...current,
        actionErrorMessage: '予約IDが入力されなかったため、リセットを中止しました。',
      }))
      return
    }

    if (enteredReservationId !== reservationId) {
      setState((current) => ({
        ...current,
        actionErrorMessage: '予約IDが一致しないため、リセットを中止しました。',
      }))
      return
    }

    setState((current) => ({
      ...current,
      actionErrorMessage: '',
      isActionLoading: true,
    }))

    try {
      await resetFixedFareRun(reservationId, {
        reason: 'missing_active_trip_snapshot',
        confirmReservationId: reservationId,
        resetBy: 'meter_driver',
      })
      clearReservationTripContext()
      await loadReservation(reservationId)
    } catch (error) {
      setState((current) => ({
        ...current,
        actionErrorMessage:
          error instanceof Error
            ? error.message
            : '事前確定Mの運行中状態リセットに失敗しました。',
      }))
    } finally {
      setState((current) => ({
        ...current,
        isActionLoading: false,
      }))
    }
  }

  const reservation = state.reservation
  const isTestReservation = reservation ? resolveReservationIsTest(reservation) : false
  const meterRunStatus = reservation?.meterRunStatus ?? ''
  const activeTripRestoreState =
    meterRunStatus === 'in_progress' && reservationId
      ? resolveActiveTripRestoreState(reservationId)
      : { canRestore: false, needsReset: false, message: '' }
  const showMeterRunResetAction =
    meterRunStatus === 'in_progress' && activeTripRestoreState.needsReset
  const isPassengerChangeCompletion = reservation
    ? isPreFixedFarePassengerChangeReservation(reservation)
    : false
  const showPassengerChangePanel = Boolean(reservation?.preFixedFareException)
  const quoteServiceFeePartitions = reservation
    ? partitionQuoteServiceFees(reservation.quoteSnapshot.serviceFees)
    : { includedInConfirmedFare: [], excludedFromConfirmedFare: [] }
  const confirmedFareBreakdownTotalYen = reservation
    ? reservation.fixedFare.fixedFareTotalYen +
      quoteServiceFeePartitions.includedInConfirmedFare.reduce(
        (total, fee) => total + Math.max(Math.round(fee.amount) || 0, 0),
        0,
      )
    : 0

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
            {isTestReservation ? (
              <p className="reservation-detail-test-badge" role="status">
                <span className="pre-fixed-reservation-badge pre-fixed-reservation-badge--test">
                  テスト予約
                </span>
              </p>
            ) : null}
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
                      disabled={state.isActionLoading}
                      onClick={handleReturnToActiveMeter}
                    >
                      運行中のメーターへ戻る
                    </button>
                    {showMeterRunResetAction ? (
                      <div className="reservation-meter-reset-panel">
                        <p className="case-error" role="alert">
                          {activeTripRestoreState.message}
                        </p>
                        <p className="reservation-meter-reset-note">
                          復元不能な場合のみ、以下から運行中状態を開始前に戻せます。精算・売上は作成されません。
                        </p>
                        <button
                          className="case-detail-danger-button"
                          type="button"
                          disabled={state.isActionLoading}
                          onClick={handleResetMeterRunStatus}
                        >
                          {state.isActionLoading ? 'リセット処理中…' : '運行中状態をリセットする'}
                        </button>
                      </div>
                    ) : null}
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
              {isTestReservation ? (
                <p className="save-note">テスト予約のため、スナップショット検証は対象外です。</p>
              ) : (
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
                  title="確定運賃 = 運賃本体 + 確定運賃に含むサービス料金（特殊車両使用料は除く）"
                >
                  料金整合: {formatVerificationBadge(reservation.fareMatch)}
                </span>
                <span
                  className={`reservation-verification-badge reservation-verification-badge--${
                    reservation.integrity.consentSnapshotHashMatches ? 'ok' : 'warn'
                  }`}
                >
                  同意スナップショット: {formatVerificationBadge(Boolean(reservation.integrity.consentSnapshotHashMatches))}
                </span>
              </div>
              )}
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
                <div>
                  <dt>確定運賃（予約時同意額）</dt>
                  <dd>{formatFareYen(reservation.fixedFare.confirmedFareYen)}円</dd>
                </div>
                <div><dt>運賃種別</dt><dd>{formatOptionalText(reservation.fixedFare.fareType)}</dd></div>
                <div><dt>高速利用</dt><dd>{reservation.fixedFare.useToll ? 'あり' : 'なし'}</dd></div>
                <div><dt>ルートID</dt><dd>{formatOptionalText(reservation.fixedFare.selectedRouteId)}</dd></div>
                <div><dt>料金確定日時</dt><dd>{reservation.fixedFare.fareLockedAt ? formatCaseDateTime(reservation.fixedFare.fareLockedAt) : '未設定'}</dd></div>
              </dl>

              {!isTestReservation ? (
              <>
              <div className="reservation-fare-breakdown">
                <h3>確定運賃の内訳</h3>
                <p className="reservation-fare-breakdown-note">
                  メーター画面・領収書の「事前確定運賃」は、この確定運賃（予約時同意額）を本体として表示します。
                </p>
                <dl className="reservation-detail-dl">
                  <div>
                    <dt>運賃本体</dt>
                    <dd>{formatFareYen(reservation.fixedFare.fixedFareTotalYen)}円</dd>
                  </div>
                  {quoteServiceFeePartitions.includedInConfirmedFare.map((fee) => (
                    <div key={fee.key}>
                      <dt>{fee.label}</dt>
                      <dd>{formatFareYen(fee.amount)}円</dd>
                    </div>
                  ))}
                  <div>
                    <dt>内訳合計</dt>
                    <dd>{formatFareYen(confirmedFareBreakdownTotalYen)}円</dd>
                  </div>
                </dl>
              </div>

              {quoteServiceFeePartitions.excludedFromConfirmedFare.length > 0 ? (
                <div className="reservation-fare-breakdown reservation-fare-breakdown--excluded">
                  <h3>確定運賃に含まない項目</h3>
                  <p className="reservation-fare-breakdown-note">
                    運行時にメーター画面で別途加算します。確定運賃・料金整合の計算には含めません。
                  </p>
                  <dl className="reservation-detail-dl">
                    {quoteServiceFeePartitions.excludedFromConfirmedFare.map((fee) => (
                      <div key={fee.key}>
                        <dt>{fee.label}</dt>
                        <dd>{formatFareYen(fee.amount)}円</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              <dl className="reservation-detail-dl">
                <div><dt>見積距離</dt><dd>{(reservation.quoteSnapshot.distanceMeters / 1000).toFixed(1)} km</dd></div>
                <div><dt>見積時間</dt><dd>{formatElapsedTime(reservation.quoteSnapshot.durationSeconds)}</dd></div>
                <div><dt>見積モード</dt><dd>{formatOptionalText(reservation.quoteSnapshot.fareMode)}</dd></div>
              </dl>
              </>
              ) : (
                <p className="save-note">テスト予約のため、確定運賃の内訳は表示されません。</p>
              )}
            </section>

            {!isTestReservation ? (
            <section className="reservation-detail-section" aria-label="同意証跡">
              <h2>同意証跡</h2>
              <dl className="reservation-detail-dl">
                <div><dt>同意日時</dt><dd>{reservation.consent.consentAt ? formatCaseDateTime(reservation.consent.consentAt) : '未設定'}</dd></div>
                <div><dt>同意文バージョン</dt><dd>{formatOptionalText(reservation.consent.consentTextVersion)}</dd></div>
                <div><dt>見積運賃</dt><dd>{formatFareYen(reservation.consent.quotedFareYen)}円</dd></div>
                <div><dt>ソース</dt><dd>{formatOptionalText(reservation.consent.source)}</dd></div>
                <div><dt>スナップショットハッシュ</dt><dd className="reservation-hash">{formatOptionalText(reservation.consent.snapshotHash)}</dd></div>
              </dl>
            </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
