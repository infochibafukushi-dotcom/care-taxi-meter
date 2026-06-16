import type { ObdIndicatorState } from '../../hooks/useObdMeterTelemetry'

type ObdConnectionIndicatorProps = {
  indicator: ObdIndicatorState
}

export function ObdConnectionIndicator({ indicator }: ObdConnectionIndicatorProps) {
  if (!indicator.visible) {
    return null
  }

  return (
    <span
      className={`obd-connection-indicator obd-connection-indicator--${indicator.variant}`}
      role="status"
    >
      <span className="obd-connection-indicator__dot" aria-hidden="true" />
      {indicator.label}
    </span>
  )
}
