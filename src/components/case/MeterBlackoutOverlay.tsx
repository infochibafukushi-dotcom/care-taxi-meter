import { formatTimerClock } from '../../utils/time'

type MeterBlackoutOverlayProps = {
  elapsedSeconds: number
  isActive: boolean
  onDismiss: () => void
  statusLabel: string
}

export function MeterBlackoutOverlay({
  elapsedSeconds,
  isActive,
  onDismiss,
  statusLabel,
}: MeterBlackoutOverlayProps) {
  if (!isActive) {
    return null
  }

  return (
    <button
      aria-label={`${statusLabel}。タップで復帰`}
      className="meter-blackout-overlay"
      type="button"
      onClick={onDismiss}
    >
      <span className="meter-blackout-overlay__status">{statusLabel}</span>
      <strong className="meter-blackout-overlay__elapsed">
        {formatTimerClock(elapsedSeconds, true)}
      </strong>
      <small className="meter-blackout-overlay__hint">タップで復帰</small>
    </button>
  )
}
