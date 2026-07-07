import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { UnifiedReservationCard } from '../components/preFixed/UnifiedReservationCard'
import { fetchDriverReservations } from '../services/reservationApi'
import type { DriverReservationSummary } from '../types/reservation'
import { getDatePartsInJapan } from '../utils/japanDate'
import { logDiagnostic } from '../utils/diagnostics'
import { resolveReservationCategory } from '../utils/reservationCategory'

const formatJapanDateInputValue = (date = new Date()) => {
  const { year, month, day } = getDatePartsInJapan(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

type ReservationListState = {
  date: string
  errorMessage: string
  isLoading: boolean
  reservations: DriverReservationSummary[]
}

export function ReservationListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const fromPreFixed = searchParams.get('from') === 'pre-fixed'
  const vehicleId = searchParams.get('vehicleId')?.trim() ?? ''
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
    const nextParams: Record<string, string> = {}
    if (nextDate) {
      nextParams.date = nextDate
    }
    if (vehicleId) {
      nextParams.vehicleId = vehicleId
    }
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    if (fromPreFixed) {
      return undefined
    }

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
  }, [fromPreFixed, selectedDate])

  const handleSelectReservation = useCallback(
    (reservationId: string) => {
      const summary = state.reservations.find((item) => item.reservationId === reservationId)
      const query = new URLSearchParams()
      if (vehicleId) {
        query.set('vehicleId', vehicleId)
      }

      if (summary && resolveReservationCategory(summary) === 'pre_fixed') {
        query.set('reservationId', reservationId)
        query.set('autoOpen', '1')
        if (selectedDate) {
          query.set('date', selectedDate)
        }
        navigate(`/case/pre-fixed/reservations?${query.toString()}`)
        return
      }

      navigate(
        `/reservations/${encodeURIComponent(reservationId)}${query.toString() ? `?${query.toString()}` : ''}`,
        { state: { listDate: selectedDate } },
      )
    },
    [navigate, selectedDate, state.reservations, vehicleId],
  )

  const reservationCountLabel = useMemo(
    () => `${state.reservations.length}件`,
    [state.reservations.length],
  )

  if (fromPreFixed) {
    const redirectQuery = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''
    return <Navigate to={`/case/pre-fixed/reservations${redirectQuery}`} replace />
  }

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
            <p className="save-note">通常予約・電話予約・事前確定予約をまとめて表示しています。</p>
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

        <div className="pre-fixed-reservation-list" aria-label="運行予約一覧">
          {state.reservations.map((reservation) => (
            <UnifiedReservationCard
              key={reservation.reservationId}
              reservation={reservation}
              onSelect={handleSelectReservation}
            />
          ))}
        </div>
      </section>
    </main>
  )
}
