import type { ObdMeterStatus } from '../../hooks/useObdMeterTelemetry'

const statusLabels: Record<ObdMeterStatus, string> = {
  connected: '🟢 OBD計測中',
  disconnected: '🔴 OBD未接続（GPSで計測中）',
  reconnecting: '🟡 OBD接続中',
}

type ObdMeterStatusBadgeProps = {
  onReconnect?: () => void
  showReconnectButton?: boolean
  status: ObdMeterStatus
  statusLabel?: string
  visible: boolean
}

export function ObdMeterStatusBadge({
  onReconnect,
  showReconnectButton = false,
  status,
  statusLabel,
  visible,
}: ObdMeterStatusBadgeProps) {
  if (!visible) {
    return null
  }

  return (
    <div className="obd-meter-status-stack">
      <div className="obd-meter-status-badge" role="status">
        {statusLabel ?? statusLabels[status]}
      </div>
      {showReconnectButton && onReconnect ? (
        <button
          className="obd-reconnect-button"
          type="button"
          onClick={() => {
            console.log('OBD reconnect clicked')
            onReconnect()
          }}
        >
          OBD再接続
        </button>
      ) : null}
    </div>
  )
}
