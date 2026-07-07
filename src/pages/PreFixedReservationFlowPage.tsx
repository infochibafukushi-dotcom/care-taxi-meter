import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { UnifiedReservationCard } from '../components/preFixed/UnifiedReservationCard'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import { formatFareYen } from '../services/fare'
import {
  fetchDriverReservation,
  fetchDriverReservations,
  startFixedFareRun,
} from '../services/reservationApi'
import {
  buildReservationTripContext,
  saveReservationTripContext,
} from '../services/reservationTripContext'
import type { DriverReservationDetail } from '../types/reservation'
import { formatCaseDateTime } from '../utils/caseRecords'
import { getDatePartsInJapan } from '../utils/japanDate'
import { buildConfirmedRouteView } from '../services/preFixedFareRoute'
import { preFixedRouteCandidateLabels } from '../types/preFixedMeterSession'
import type { PreFixedRouteCandidateId } from '../types/preFixedMeterSession'
import type { DriverReservationSummary } from '../types/reservation'
import {
  isPreFixedReservationReady,
  resolveReservationCategory,
} from '../utils/reservationCategory'

const formatJapanDateInputValue = (date = new Date()) => {
  const { year, month, day } = getDatePartsInJapan(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const formatAddress = (address: string) => (address.trim() ? address : '住所未取得')

const resolveRouteLabel = (routeId: string) => {
  const normalized = routeId.trim().toUpperCase()
  if (normalized === 'A' || normalized === 'B' || normalized === 'C' || normalized === 'D') {
    const id = normalized as PreFixedRouteCandidateId
    return `${id} ${preFixedRouteCandidateLabels[id]}`
  }
  return routeId || '未設定'
}

type FlowStep = 'list' | 'detail' | 'consent'

export function PreFixedReservationFlowPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const vehicleId = searchParams.get('vehicleId')?.trim() ?? ''
  const autoOpenReservationId = searchParams.get('reservationId')?.trim() ?? ''
  const menuPath = vehicleId
    ? `/case/pre-fixed?vehicleId=${encodeURIComponent(vehicleId)}`
    : '/case/pre-fixed'

  const [selectedDate, setSelectedDate] = useState(formatJapanDateInputValue())
  const [reservations, setReservations] = useState<DriverReservationSummary[]>([])
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [listError, setListError] = useState('')
  const [step, setStep] = useState<FlowStep>('list')
  const [reservationDetail, setReservationDetail] = useState<DriverReservationDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [actionError, setActionError] = useState('')
  const autoOpenHandledRef = useRef(false)

  const loadReservations = useCallback(async (date: string) => {
    setIsLoadingList(true)
    setListError('')
    try {
      const result = await fetchDriverReservations(date)
      setReservations(result.reservations)
    } catch (error) {
      setListError(error instanceof Error ? error.message : '予約一覧の取得に失敗しました。')
      setReservations([])
    } finally {
      setIsLoadingList(false)
    }
  }, [])

  useEffect(() => {
    void loadReservations(selectedDate)
  }, [loadReservations, selectedDate])

  const routeView = useMemo(() => {
    if (!reservationDetail) {
      return null
    }
    const context = buildReservationTripContext(reservationDetail)
    return buildConfirmedRouteView(context)
  }, [reservationDetail])

  const serviceFeeLines = useMemo(() => {
    if (!reservationDetail) {
      return []
    }
    return reservationDetail.quoteSnapshot.serviceFees.filter((fee) => fee.amount > 0)
  }, [reservationDetail])

  const specialVehicleFees = useMemo(
    () => serviceFeeLines.filter((fee) => fee.key === 'specialVehicleFee'),
    [serviceFeeLines],
  )

  const assistFees = useMemo(
    () => serviceFeeLines.filter((fee) => fee.key !== 'specialVehicleFee'),
    [serviceFeeLines],
  )

  const assistFeeTotal = assistFees.reduce((sum, fee) => sum + fee.amount, 0)
  const specialVehicleTotal = specialVehicleFees.reduce((sum, fee) => sum + fee.amount, 0)
  const billingTotal = reservationDetail?.fixedFare.fixedFareTotalYen ?? 0

  const consentStatusLabel = reservationDetail?.consent.consentAt ? '同意済み' : '要確認'

  const buildCreatePath = (reservationId: string) => {
    const query = new URLSearchParams({ reservationId })
    if (vehicleId) {
      query.set('vehicleId', vehicleId)
    }
    return `/case/pre-fixed/create?${query.toString()}`
  }

  const handleSelectReservation = useCallback(
    async (targetReservationId: string) => {
      setDetailError('')
      setActionError('')

      const summary = reservations.find((item) => item.reservationId === targetReservationId)
      if (summary && resolveReservationCategory(summary) !== 'pre_fixed') {
        navigate(buildCreatePath(targetReservationId))
        return
      }

      setStep('detail')
      setIsLoadingDetail(true)
      setConsentChecked(false)
      setConsentError('')

      try {
        const detail = await fetchDriverReservation(targetReservationId)
        if (!isPreFixedReservationReady(detail)) {
          navigate(buildCreatePath(targetReservationId))
          return
        }
        setReservationDetail(detail)
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : '予約詳細の取得に失敗しました。')
        setReservationDetail(null)
      } finally {
        setIsLoadingDetail(false)
      }
    },
    [navigate, reservations, vehicleId],
  )

  useEffect(() => {
    if (!autoOpenReservationId || isLoadingList || autoOpenHandledRef.current) {
      return
    }
    autoOpenHandledRef.current = true
    void handleSelectReservation(autoOpenReservationId)
  }, [autoOpenReservationId, handleSelectReservation, isLoadingList])

  const handleProceedToConsent = () => {
    if (!reservationDetail) {
      return
    }
    if (!isPreFixedReservationReady(reservationDetail)) {
      navigate(buildCreatePath(reservationDetail.reservationId))
      return
    }
    setStep('consent')
    setConsentChecked(Boolean(reservationDetail.consent.consentAt))
    setConsentError('')
  }

  const handleStartMeter = async () => {
    if (!reservationDetail || isStarting) {
      return
    }

    if (!consentChecked) {
      setConsentError('ルートと金額への同意を確認してください。')
      return
    }

    if (readActiveTripSnapshot()) {
      setActionError(
        '未終了の運行があります。開始前にメーター画面で運行を終了または復元してください。',
      )
      return
    }

    setIsStarting(true)
    setActionError('')
    setConsentError('')

    try {
      await startFixedFareRun(reservationDetail.reservationId)
      saveReservationTripContext(buildReservationTripContext(reservationDetail))

      const query = new URLSearchParams({
        reservationId: reservationDetail.reservationId,
        meterMode: 'fixed',
      })
      if (vehicleId) {
        query.set('vehicleId', vehicleId)
        navigate(`/case?${query.toString()}`)
        return
      }

      navigate(`/case/start?${query.toString()}`)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '事前確定Mの開始に失敗しました。',
      )
    } finally {
      setIsStarting(false)
    }
  }

  if (step === 'list') {
    return (
      <main className="page pre-fixed-flow-page" aria-labelledby="pre-fixed-reservation-list-title">
        <section className="content-card pre-fixed-flow-card">
          <Link className="text-link" to={menuPath}>
            ← 事前確定運賃メニューへ
          </Link>
          <p className="eyebrow">Reservations</p>
          <h1 id="pre-fixed-reservation-list-title">予約一覧</h1>
          <p className="save-note">
            通常予約・電話予約・事前確定予約をまとめて表示しています。
          </p>

          <div className="pre-fixed-flow-controls">
            <label>
              予約日
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </label>
          </div>

          {isLoadingList ? <p className="empty-note">予約一覧を取得中です。</p> : null}
          {listError ? (
            <p className="case-error" role="alert">
              {listError}
            </p>
          ) : null}

          {!isLoadingList && !listError && reservations.length === 0 ? (
            <p className="empty-note">表示対象の予約はありません。</p>
          ) : null}

          <div className="pre-fixed-reservation-list">
            {reservations.map((reservation) => (
              <UnifiedReservationCard
                key={reservation.reservationId}
                reservation={reservation}
                onSelect={(reservationId) => {
                  void handleSelectReservation(reservationId)
                }}
              />
            ))}
          </div>
        </section>
      </main>
    )
  }

  if (!reservationDetail && !isLoadingDetail) {
    return (
      <main className="page pre-fixed-flow-page">
        <section className="content-card pre-fixed-flow-card">
          <p className="case-error" role="alert">
            {detailError || '予約情報を読み込めませんでした。'}
          </p>
          <button className="secondary-action" type="button" onClick={() => setStep('list')}>
            一覧に戻る
          </button>
        </section>
      </main>
    )
  }

  if (step === 'consent' && reservationDetail) {
    return (
      <main className="page pre-fixed-flow-page" aria-labelledby="pre-fixed-consent-title">
        <section className="content-card pre-fixed-flow-card">
          <button className="text-link" type="button" onClick={() => setStep('detail')}>
            ← 予約内容に戻る
          </button>
          <p className="eyebrow">Consent</p>
          <h1 id="pre-fixed-consent-title">事前確定運賃の確認</h1>

          <dl className="pre-fixed-consent-summary">
            <div>
              <dt>お迎え地</dt>
              <dd>{formatAddress(reservationDetail.trip.pickupAddress)}</dd>
            </div>
            {routeView && routeView.viaAddresses.length > 0 ? (
              <div>
                <dt>立ち寄り</dt>
                <dd>{routeView.viaAddresses.join('\n')}</dd>
              </div>
            ) : null}
            <div>
              <dt>目的地</dt>
              <dd>{formatAddress(reservationDetail.trip.destinationAddress)}</dd>
            </div>
            <div>
              <dt>選択ルート</dt>
              <dd>{resolveRouteLabel(reservationDetail.fixedFare.selectedRouteId)}</dd>
            </div>
            <div>
              <dt>事前確定運賃</dt>
              <dd className="pre-fixed-amount">
                {formatFareYen(reservationDetail.fixedFare.confirmedFareYen)}円
              </dd>
            </div>
            <div>
              <dt>介助料金</dt>
              <dd>{formatFareYen(assistFeeTotal)}円</dd>
            </div>
            {specialVehicleTotal > 0 ? (
              <div>
                <dt>車両使用料</dt>
                <dd>{formatFareYen(specialVehicleTotal)}円</dd>
              </div>
            ) : null}
            <div className="pre-fixed-consent-summary__total">
              <dt>請求予定合計</dt>
              <dd className="pre-fixed-amount">{formatFareYen(billingTotal)}円</dd>
            </div>
          </dl>

          <label className="pre-fixed-consent-checkbox">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(event) => {
                setConsentChecked(event.target.checked)
                if (event.target.checked) {
                  setConsentError('')
                }
              }}
            />
            上記のルート・金額で同意しました
          </label>

          {consentError ? (
            <p className="case-error" role="alert">
              {consentError}
            </p>
          ) : null}
          {actionError ? (
            <p className="case-error" role="alert">
              {actionError}
            </p>
          ) : null}

          <div className="pre-fixed-flow-actions">
            <button
              className="primary-action"
              type="button"
              disabled={isStarting}
              onClick={() => {
                void handleStartMeter()
              }}
            >
              {isStarting ? '開始処理中...' : '同意してメーターへ進む'}
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="page pre-fixed-flow-page" aria-labelledby="pre-fixed-reservation-detail-title">
      <section className="content-card pre-fixed-flow-card">
        <button className="text-link" type="button" onClick={() => setStep('list')}>
          ← 予約一覧に戻る
        </button>
        <p className="eyebrow">Reservation Detail</p>
        <h1 id="pre-fixed-reservation-detail-title">予約内容の確認</h1>

        {isLoadingDetail ? <p className="empty-note">予約詳細を取得中です。</p> : null}
        {detailError ? (
          <p className="case-error" role="alert">
            {detailError}
          </p>
        ) : null}

        {reservationDetail ? (
          <>
            <dl className="pre-fixed-detail-grid">
              <div>
                <dt>予約者名</dt>
                <dd>{reservationDetail.customer.name || '未設定'}</dd>
              </div>
              <div>
                <dt>乗車予定日時</dt>
                <dd>{formatCaseDateTime(reservationDetail.scheduledAt)}</dd>
              </div>
              <div>
                <dt>お迎え地 S</dt>
                <dd>{formatAddress(reservationDetail.trip.pickupAddress)}</dd>
              </div>
              <div>
                <dt>目的地 G</dt>
                <dd>{formatAddress(reservationDetail.trip.destinationAddress)}</dd>
              </div>
              {routeView && routeView.viaAddresses.length > 0 ? (
                <div>
                  <dt>立ち寄り</dt>
                  <dd>{routeView.viaAddresses.join(' / ')}</dd>
                </div>
              ) : null}
              <div>
                <dt>選択済みルート</dt>
                <dd>{resolveRouteLabel(reservationDetail.fixedFare.selectedRouteId)}</dd>
              </div>
              <div>
                <dt>事前確定運賃</dt>
                <dd className="pre-fixed-amount">
                  {formatFareYen(reservationDetail.fixedFare.confirmedFareYen)}円
                </dd>
              </div>
              <div>
                <dt>介助料金</dt>
                <dd>{formatFareYen(assistFeeTotal)}円</dd>
              </div>
              {specialVehicleTotal > 0 ? (
                <div>
                  <dt>車両使用料</dt>
                  <dd>{formatFareYen(specialVehicleTotal)}円</dd>
                </div>
              ) : null}
              <div>
                <dt>請求予定合計</dt>
                <dd className="pre-fixed-amount">{formatFareYen(billingTotal)}円</dd>
              </div>
              <div>
                <dt>同意状態</dt>
                <dd>
                  <span
                    className={`fixed-fare-status-chip ${
                      consentStatusLabel === '同意済み'
                        ? 'fixed-fare-status-chip--agreed'
                        : 'fixed-fare-status-chip--confirmed'
                    }`}
                  >
                    {consentStatusLabel}
                  </span>
                </dd>
              </div>
            </dl>

            <div className="pre-fixed-flow-actions">
              <button className="primary-action" type="button" onClick={handleProceedToConsent}>
                同意確認へ進む
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  )
}
