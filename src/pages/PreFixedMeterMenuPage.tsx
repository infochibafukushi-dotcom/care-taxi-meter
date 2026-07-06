import { Link, useSearchParams } from 'react-router-dom'

export function PreFixedMeterMenuPage() {
  const [searchParams] = useSearchParams()
  const vehicleId = searchParams.get('vehicleId')?.trim() ?? ''
  const querySuffix = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''

  return (
    <main className="page pre-fixed-flow-page" aria-labelledby="pre-fixed-menu-title">
      <section className="hero-card pre-fixed-flow-card">
        <Link className="text-link" to={vehicleId ? `/case/start` : '/'}>
          ← 戻る
        </Link>
        <p className="eyebrow">Pre-Fixed Fare</p>
        <h1 id="pre-fixed-menu-title">事前確定運賃</h1>
        <p className="lead">開始方法を選択してください。</p>

        <div className="pre-fixed-menu-actions">
          <Link
            className="primary-action pre-fixed-menu-action"
            to={`/case/pre-fixed/reservations${querySuffix}`}
          >
            事前確定予約から開始
          </Link>
          <Link
            className="primary-action pre-fixed-menu-action"
            to={`/case/pre-fixed/create${querySuffix}`}
          >
            通常予約・電話予約から作成
          </Link>
          <Link
            className="secondary-action pre-fixed-menu-action"
            to={`/reservations${vehicleId ? `?from=pre-fixed&vehicleId=${encodeURIComponent(vehicleId)}` : ''}`}
          >
            予約一覧
          </Link>
        </div>
      </section>
    </main>
  )
}
