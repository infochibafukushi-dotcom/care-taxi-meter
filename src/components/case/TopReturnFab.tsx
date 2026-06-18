type TopReturnFabProps = {
  onClick: () => void
  visible: boolean
}

export function TopReturnFab({ onClick, visible }: TopReturnFabProps) {
  if (!visible) {
    return null
  }

  return (
    <button
      aria-label="TOPへ戻る"
      className="r9-fab-stack__button r9-top-return-fab"
      type="button"
      onClick={onClick}
    >
      TOPへ戻る
    </button>
  )
}
