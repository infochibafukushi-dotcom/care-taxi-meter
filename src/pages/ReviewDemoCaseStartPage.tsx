import { useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ReviewDemoPageShell } from '../components/reviewDemo/ReviewDemoPageShell'
import { readReviewDemoReservationTripContext } from '../services/reviewDemoStorage'
import {
  isPreFixedFareReviewDemoScenario,
  isReviewDemoQueryActive,
  REVIEW_DEMO_RESERVATION_ID,
  REVIEW_DEMO_VEHICLE_ID,
  withReviewDemoSearch,
} from '../utils/reviewDemo'

export function ReviewDemoCaseStartPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const reservationId = searchParams.get('reservationId')?.trim() ?? REVIEW_DEMO_RESERVATION_ID

  useEffect(() => {
    if (!isReviewDemoQueryActive(`?${searchParams.toString()}`)) {
      return
    }

    if (!isPreFixedFareReviewDemoScenario(`?${searchParams.toString()}`)) {
      return
    }

    if (!readReviewDemoReservationTripContext(reservationId)) {
      return
    }

    const query = new URLSearchParams({
      reviewDemo: '1',
      scenario: 'pre-fixed-fare-demo',
      vehicleId: REVIEW_DEMO_VEHICLE_ID,
      meterMode: 'fixed',
      reservationId,
    })

    navigate(`/review-demo/case?${query.toString()}`, { replace: true })
  }, [navigate, reservationId, searchParams])

  if (!isReviewDemoQueryActive(`?${searchParams.toString()}`)) {
    return <Navigate to={withReviewDemoSearch('/review-demo/reservations')} replace />
  }

  if (!readReviewDemoReservationTripContext(reservationId)) {
    return (
      <ReviewDemoPageShell backTo={withReviewDemoSearch(`/review-demo/reservations/${reservationId}`)}>
        <section className="content-card">
          <p className="case-error" role="alert">
            予約連携情報が見つかりません。予約詳細から再度「事前確定Mで開始」してください。
          </p>
        </section>
      </ReviewDemoPageShell>
    )
  }

  return (
    <ReviewDemoPageShell>
      <section className="content-card">
        <p className="empty-note">審査用デモ運行を開始しています…</p>
      </section>
    </ReviewDemoPageShell>
  )
}
