import { useObdConnection } from '../hooks/useObdConnection'
import type { ObdConnectionStatus } from '../hooks/useObdConnection'
import type { ObdLogType } from '../services/obdConnection'

const connectionStatusLabels: Record<ObdConnectionStatus, string> = {
  connected: '接続済み',
  connecting: '接続中',
  disconnected: '未接続',
  error: 'エラー',
}

const logTypeLabels: Record<ObdLogType, string> = {
  command: 'AT/PID送信',
  error: 'エラー',
  info: '情報',
  response: '応答',
}

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const formatRpm = (value: number | null) =>
  value == null ? '未取得' : `${Math.round(value)} rpm`

const formatSpeed = (value: number | null) =>
  value == null ? '未取得' : `${value} km/h`

export function ObdPocPage() {
  const {
    connect,
    connectionStatus,
    disconnect,
    distanceKm,
    errorMessage,
    logs,
    lowSpeedSeconds,
    rpm,
    speedKmh,
  } = useObdConnection()

  const isConnecting = connectionStatus === 'connecting'
  const isConnected = connectionStatus === 'connected'

  return (
    <main className="page">
      <section className="content-card obd-poc-page" aria-label="OBD PoC">
        <p className="eyebrow">OBDM PoC</p>
        <h1>OBD 接続テスト</h1>
        <p className="lead">
          Android Chrome PWA 上で Web Bluetooth を使い、VEEPEAK OBD アダプターから車速と RPM を取得します。
        </p>

        <div className="obd-poc-status" role="status">
          <span>接続状態</span>
          <strong className={`obd-poc-status__value obd-poc-status__value--${connectionStatus}`}>
            {connectionStatusLabels[connectionStatus]}
          </strong>
        </div>

        {errorMessage ? <p className="obd-poc-error">{errorMessage}</p> : null}

        <div className="obd-poc-actions">
          <button
            type="button"
            className="primary-action"
            disabled={isConnecting || isConnected}
            onClick={() => {
              void connect()
            }}
          >
            接続
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={!isConnected && !isConnecting}
            onClick={() => {
              void disconnect()
            }}
          >
            切断
          </button>
        </div>

        <div className="obd-poc-metrics" aria-label="OBD計測値">
          <div>
            <span>車速</span>
            <strong>{formatSpeed(speedKmh)}</strong>
          </div>
          <div>
            <span>RPM</span>
            <strong>{formatRpm(rpm)}</strong>
          </div>
          <div>
            <span>積算距離</span>
            <strong>{distanceKm.toFixed(3)} km</strong>
          </div>
          <div>
            <span>低速時間</span>
            <strong>{lowSpeedSeconds} 秒</strong>
          </div>
        </div>

        <section className="obd-poc-log" aria-label="OBDログ">
          <div className="obd-poc-log__header">
            <h2>受信ログ</h2>
            <span>{logs.length} 件</span>
          </div>
          <div className="obd-poc-log__list">
            {logs.length === 0 ? (
              <p className="obd-poc-log__empty">ログはまだありません。</p>
            ) : (
              logs.map((entry, index) => (
                <article key={`${entry.timestamp}-${index}`} className={`obd-poc-log__item obd-poc-log__item--${entry.type}`}>
                  <time dateTime={new Date(entry.timestamp).toISOString()}>
                    {formatTimestamp(entry.timestamp)}
                  </time>
                  <span>{logTypeLabels[entry.type]}</span>
                  <p>{entry.message}</p>
                </article>
              ))
            )}
          </div>
        </section>

        <style>{`
          .obd-poc-page {
            width: min(100%, 960px);
          }

          .obd-poc-status {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-top: 28px;
            padding: 16px 20px;
            border-radius: 16px;
            background: rgb(15 23 42 / 4%);
          }

          .obd-poc-status__value--connected {
            color: #047857;
          }

          .obd-poc-status__value--connecting {
            color: #0369a1;
          }

          .obd-poc-status__value--error {
            color: #b91c1c;
          }

          .obd-poc-error {
            margin: 16px 0 0;
            color: #b91c1c;
            font-weight: 700;
          }

          .obd-poc-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin-top: 24px;
          }

          .obd-poc-metrics {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin-top: 28px;
          }

          .obd-poc-metrics div {
            display: grid;
            gap: 8px;
            padding: 16px;
            border: 1px solid rgb(15 23 42 / 10%);
            border-radius: 16px;
            background: rgb(255 255 255 / 72%);
          }

          .obd-poc-metrics span {
            color: #64748b;
            font-size: 0.92rem;
          }

          .obd-poc-metrics strong {
            font-size: 1.35rem;
          }

          .obd-poc-log {
            margin-top: 32px;
          }

          .obd-poc-log__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
          }

          .obd-poc-log__header h2 {
            margin: 0;
            font-size: 1.1rem;
          }

          .obd-poc-log__list {
            display: grid;
            gap: 10px;
            max-height: 320px;
            overflow: auto;
            padding: 12px;
            border: 1px solid rgb(15 23 42 / 10%);
            border-radius: 16px;
            background: rgb(248 250 252 / 90%);
          }

          .obd-poc-log__empty {
            margin: 0;
            color: #64748b;
          }

          .obd-poc-log__item {
            display: grid;
            gap: 4px;
            padding: 10px 12px;
            border-radius: 12px;
            background: #fff;
          }

          .obd-poc-log__item time,
          .obd-poc-log__item span {
            color: #64748b;
            font-size: 0.82rem;
          }

          .obd-poc-log__item p {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 0.88rem;
          }

          .obd-poc-log__item--error {
            background: rgb(254 242 242);
          }
        `}</style>
      </section>
    </main>
  )
}
