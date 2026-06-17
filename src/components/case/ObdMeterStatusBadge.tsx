import type { ObdMeterStatus } from '../../hooks/useObdMeterTelemetry'

const statusLabels: Record<ObdMeterStatus, string> = {
  connected: '🟢 OBD接続中',
  disconnected: '🔴 OBD未接続',
  reconnecting: '🟡 OBD再接続中',
}

type ObdMeterStatusBadgeProps = {
  status: ObdMeterStatus
  visible: boolean
}

export function ObdMeterStatusBadge({ status, visible }: ObdMeterStatusBadgeProps) {
  if (!visible) {
    return null
  }

  return (
    <div className="obd-meter-status-badge" role="status">
      {statusLabels[status]}
    </div>
  )
}
