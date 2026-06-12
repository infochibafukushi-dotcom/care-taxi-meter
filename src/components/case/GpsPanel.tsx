import type { GpsPosition } from '../../types/case'
import type { SpeedSource } from '../../services/gpsSpeed'

type GpsPanelProps = {
  errorMessage: string | null
  gpsLogCount: number
  isActive: boolean
  position: GpsPosition | null
  speedSource: SpeedSource
  status: 'idle' | 'locating' | 'ready' | 'error' | 'unsupported'
  totalDistanceKm: number
}

const formatCoordinate = (value: number | undefined) =>
  value === undefined ? '未取得' : value.toFixed(6)

const formatAccuracy = (value: number | undefined) =>
  value === undefined ? '未取得' : `±${Math.round(value)}m`

const formatSpeed = (value: number | null | undefined) =>
  value == null ? '未取得' : `${(value * 3.6).toFixed(1)}km/h`

export function GpsPanel({
  errorMessage,
  gpsLogCount,
  isActive,
  position,
  speedSource,
  status,
  totalDistanceKm,
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
        <div>
          <span>速度</span>
          <strong>{formatSpeed(position?.speed)}</strong>
        </div>
        <div>
          <span>速度取得方式</span>
          <strong>{speedSource === 'gps' ? 'GPS speed' : speedSource === 'fallback' ? '距離÷時間' : '未取得'}</strong>
        </div>
        <div>
          <span>GPSログ件数</span>
          <strong>{gpsLogCount}件</strong>
        </div>
        <div>
          <span>運賃距離</span>
          <strong>{totalDistanceKm.toFixed(3)}km</strong>
        </div>
      </div>
      {errorMessage ? <p className="gps-error">{errorMessage}</p> : null}
      <p className="gps-note">
        運行開始で5秒ごとに取得し、案件終了で停止します。GPS精度30m超と5秒500m以上の移動は距離計算から除外します。
      </p>
    </section>
  )
}
