import type { GpsPosition } from '../../types/case'

type GpsPanelProps = {
  errorMessage: string | null
  isActive: boolean
  position: GpsPosition | null
  status: 'idle' | 'locating' | 'ready' | 'error' | 'unsupported'
}

const formatCoordinate = (value: number | undefined) =>
  value === undefined ? '未取得' : value.toFixed(6)

const formatAccuracy = (value: number | undefined) =>
  value === undefined ? '未取得' : `±${Math.round(value)}m`

export function GpsPanel({
  errorMessage,
  isActive,
  position,
  status,
}: GpsPanelProps) {
  const statusText = isActive
    ? status === 'ready'
      ? 'GPS取得中'
      : status === 'locating'
        ? 'GPS取得準備中'
        : 'GPS取得エラー'
    : 'GPS停止中'

  return (
    <section className="gps-panel" aria-label="GPS現在地">
      <div className="gps-panel__header">
        <span className="metric-label">GPS現在地</span>
        <strong className={`gps-status gps-status--${status}`}>
          {statusText}
        </strong>
      </div>
      <div className="gps-grid">
        <div>
          <span>現在の緯度</span>
          <strong>{formatCoordinate(position?.latitude)}</strong>
        </div>
        <div>
          <span>現在の経度</span>
          <strong>{formatCoordinate(position?.longitude)}</strong>
        </div>
        <div>
          <span>GPS精度</span>
          <strong>{formatAccuracy(position?.accuracy)}</strong>
        </div>
      </div>
      {errorMessage ? <p className="gps-error">{errorMessage}</p> : null}
      <p className="gps-note">運行開始で5秒ごとに取得し、案件終了で停止します。</p>
    </section>
  )
}
