type ObdConnectFabProps = {
  isConnecting: boolean
  onConnect: () => void
  visible: boolean
}

export function ObdConnectFab({ isConnecting, onConnect, visible }: ObdConnectFabProps) {
  if (!visible) {
    return null
  }

  return (
    <button
      aria-label="OBD接続"
      className="r9-obd-connect-button"
      disabled={isConnecting}
      type="button"
      onClick={onConnect}
    >
      {isConnecting ? '接続中...' : 'OBD接続'}
    </button>
  )
}
