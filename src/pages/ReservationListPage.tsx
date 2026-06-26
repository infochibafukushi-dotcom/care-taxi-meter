import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchDriverReservations } from '../services/reservationApi'
import type { DriverReservationSummary } from '../types/reservation'
import {
  formatMeterRunStatus,
  formatReservationStatus,
} from '../types/reservation'
import { formatFareYen } from '../services/fare'
import { getDatePartsInJapan } from '../utils/japanDate'
import { formatCaseDateTime } from '../utils/caseRecords'
import { logDiagnostic } from '../utils/diagnostics'

const formatJapanDateInputValue = (date = new Date()) => {
  const { year, month, day } = getDatePartsInJapan(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const formatAddress = (address: string) =>
  address.trim() ? address : '住所未取得'

const formatOptionalText = (value: string) =>
  value.trim() ? value : '未設定'

type ReservationListState = {
  date: string
  errorMessage: string
  isLoading: boolean
  reservations: DriverReservationSummary[]
}

export function ReservationListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialDate = searchParams.get('date') || formatJapanDateInputValue()
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [state, setState] = useState<ReservationListState>({
    date: selectedDate,
    errorMessage: '',
    isLoading: true,
    reservations: [],
  })

  useEffect(() => {
    logDiagnostic('ReservationListPage mount')
    return () => logDiagnostic('ReservationListPage unmount')
  }, [])

  useEffect(() => {
    const queryDate = searchParams.get('date')
    if (queryDate && queryDate !== selectedDate) {
      setSelectedDate(queryDate)
    }
  }, [searchParams, selectedDate])

  const handleDateChange = (nextDate: string) => {
    setSelectedDate(nextDate)
    setSearchParams(nextDate ? { date: nextDate } : {}, { replace: true })
  }

  useEffect(() => {
    let isMounted = true

    setState((currentState) => ({
      ...currentState,
      date: selectedDate,
      errorMessage: '',
      isLoading: true,
    }))

    fetchDriverReservations(selectedDate)
      .then((result) => {
        if (!isMounted) {
          return
        }

        setState({
          date: result.date,
          errorMessage: '',
          isLoading: false,
          reservations: result.reservations,
        })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState({
          date: selectedDate,
          errorMessage:
            error instanceof Error
              ? error.message
              : '運行予約一覧の取得に失敗しました。',
          isLoading: false,
          reservations: [],
        })
      })

    return () => {
      isMounted = false
    }
  }, [selectedDate])

  const reservationCountLabel = useMemo(
    () => `${state.reservations.length}件`,
    [state.reservations.length],
  )

  return (
    <main className="page reservation-list-page" aria-labelledby="reservation-list-title">
      <section className="content-card reservation-list-card">
        <div className="reservation-list-header">
          <div>
            <Link className="text-link" to="/">
              ← TOPへ戻る
            </Link>
            <p className="eyebrow">Reservations</p>
            <h1 id="reservation-list-title">運行予約一覧</h1>
          </div>
        </div>

        <div className="reservation-list-controls">
          <label>
            予約日
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => handleDateChange(event.target.value)}
            />
          </label>
          <p className="reservation-list-count" aria-live="polite">
            {state.isLoading ? '取得中...' : reservationCountLabel}
          </p>
        </div>

        {state.isLoading ? (
          <p className="empty-note">予約一覧を取得中です。</p>
        ) : null}

        {state.errorMessage ? (
          <p className="case-error" role="alert">
            {state.errorMessage}
          </p>
        ) : null}

        {!state.isLoading && !state.errorMessage && state.reservations.length === 0 ? (
          <p className="empty-note">表示対象の予約はありません。</p>
        ) : null}

        <div className="reservation-record-list" aria-label="運行予約一覧">
          {state.reservations.map((reservation) => (
            <Link
              className="reservation-record-row"
              key={reservation.reservationId}
              to={`/reservations/${reservation.reservationId}`}
              state={{ listDate: selectedDate }}
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
              <span>
                <small>電話</small>
                <strong>{formatOptionalText(reservation.customerPhone)}</strong>
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
                <small>事前確定運賃</small>
                <strong>{formatFareYen(reservation.fixedFareTotalYen)}円</strong>
              </span>
              <span>
                <small>事前確定M</small>
                <strong>{reservation.preFixedFareConfirmable ? '対象' : '対象外'}</strong>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
