type PreFixedFarePassengerChangeDialogProps = {
  isOpen: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function PreFixedFarePassengerChangeDialog({
  isOpen,
  onCancel,
  onConfirm,
}: PreFixedFarePassengerChangeDialogProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        aria-labelledby="pre-fixed-passenger-change-title"
        aria-modal="true"
        className="settings-modal r9-settlement-confirm"
        role="dialog"
      >
        <header className="settings-header">
          <div>
            <span>CONFIRM</span>
            <h2 id="pre-fixed-passenger-change-title">旅客都合変更による途中終了</h2>
          </div>
          <button type="button" onClick={onCancel}>
            戻る
          </button>
        </header>
        <p className="lead" style={{ whiteSpace: 'pre-wrap' }}>
          {`旅客都合によるルート変更・立ち寄り追加として、事前確定運賃の運送をここで終了します。

当初同意済みの事前確定運賃額を収受し、この後の運送は通常メーター等の別運行として開始してください。

この操作は監査記録として保存されます。`}
        </p>
        <div className="r9-confirm-actions">
          <button className="r9-flow-primary" type="button" onClick={onConfirm}>
            事前確定運賃を途中終了する
          </button>
          <button className="secondary-action" type="button" onClick={onCancel}>
            戻る
          </button>
        </div>
      </section>
    </div>
  )
}
