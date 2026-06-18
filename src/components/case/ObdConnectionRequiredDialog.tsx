type ObdConnectionRequiredDialogProps = {
  isOpen: boolean
  onCancel: () => void
  onReconnect: () => void
  onSwitchToGps?: () => void
  onSwitchToTime?: () => void
  variant?: 'mid-trip' | 'pre-trip'
}

export function ObdConnectionRequiredDialog({
  isOpen,
  onCancel,
  onReconnect,
  onSwitchToGps,
  onSwitchToTime,
  variant = 'pre-trip',
}: ObdConnectionRequiredDialogProps) {
  if (!isOpen) {
    return null
  }

  const isMidTrip = variant === 'mid-trip'

  return (
    <div className="settings-modal-backdrop">
      <section
        aria-labelledby="obd-connection-required-title"
        aria-modal="true"
        className="settings-modal r9-operation-modal obd-connection-dialog"
        role="dialog"
      >
        <header className="settings-modal__header">
          <div>
            <p className="eyebrow">OBDM</p>
            <h2 id="obd-connection-required-title">
              {isMidTrip ? 'OBD接続が切断されました' : 'OBD接続が必要です'}
            </h2>
          </div>
          <button type="button" onClick={onCancel}>
            閉じる
          </button>
        </header>

        <div className="settings-modal__body">
          {isMidTrip ? (
            <>
              <p className="obd-connection-dialog__message">
                OBDアダプターの接続を確認し、再接続してください。
              </p>
              <ul className="obd-connection-dialog__list">
                <li>アダプターの差し直し</li>
                <li>Car Scanner など他アプリの Bluetooth 接続を終了</li>
              </ul>
            </>
          ) : (
            <>
              <p className="obd-connection-dialog__message">
                OBDM利用にはOBD接続が必要です。
              </p>
              <ul className="obd-connection-dialog__list">
                <li>OBDアダプターの接続確認</li>
                <li>Bluetooth設定確認</li>
              </ul>
              <p className="obd-connection-dialog__hint">
                またはGPSM/時間Mへ変更してください。
              </p>
            </>
          )}
        </div>

        <footer className="obd-connection-dialog__actions">
          <button type="button" className="primary-action" onClick={onReconnect}>
            再接続
          </button>
          {!isMidTrip && onSwitchToGps && onSwitchToTime ? (
            <>
              <button type="button" className="secondary-action" onClick={onSwitchToGps}>
                GPSMへ変更
              </button>
              <button type="button" className="secondary-action" onClick={onSwitchToTime}>
                時間Mへ変更
              </button>
            </>
          ) : null}
          <button type="button" className="text-link" onClick={onCancel}>
            キャンセル
          </button>
        </footer>
      </section>
    </div>
  )
}
