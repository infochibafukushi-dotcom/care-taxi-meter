type WaitingMovementAlertProps = {
  isOpen: boolean
  onContinueWaiting: () => void
  onResumeTrip: () => void
}

export function WaitingMovementAlert({
  isOpen,
  onContinueWaiting,
  onResumeTrip,
}: WaitingMovementAlertProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        aria-labelledby="waiting-movement-alert-title"
        aria-modal="true"
        className="settings-modal r9-operation-modal waiting-movement-alert"
        role="alertdialog"
      >
        <header className="settings-header">
          <div>
            <p className="eyebrow">待機中</p>
            <h2 id="waiting-movement-alert-title">⚠️ 待機中に車両移動を検知しました</h2>
          </div>
        </header>

        <div className="settings-modal__body">
          <p className="waiting-movement-alert__message">待機を終了しますか？</p>
        </div>

        <footer className="waiting-movement-alert__actions">
          <button type="button" className="primary-action" onClick={onResumeTrip}>
            送迎再開
          </button>
          <button type="button" className="secondary-action" onClick={onContinueWaiting}>
            待機継続
          </button>
        </footer>
      </section>
    </div>
  )
}
