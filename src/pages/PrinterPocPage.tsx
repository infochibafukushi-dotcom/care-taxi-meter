import { useCallback, useMemo, useRef, useState } from 'react'
import {
  BleEscPosPrinterConnection,
  SerialEscPosPrinterConnection,
  type EscPosPrinterLogEntry,
  type EscPosPrinterLogType,
} from '../services/escPosPrinterConnection'
import {
  detectBluetoothPrinterCapabilities,
  type PrinterConnectionMethod,
} from '../utils/bluetoothPrinterCapabilities'

const MAX_LOG_ENTRIES = 200

const connectionMethodLabels: Record<PrinterConnectionMethod, string> = {
  'ble-web-bluetooth': 'Web Bluetooth (BLE)',
  'classic-web-serial': 'Web Serial (Bluetooth Classic SPP)',
  none: '利用不可',
}

const logTypeLabels: Record<EscPosPrinterLogType, string> = {
  data: '送信',
  error: 'エラー',
  info: '情報',
}

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const appendLog = (logs: EscPosPrinterLogEntry[], entry: EscPosPrinterLogEntry) =>
  [...logs, entry].slice(-MAX_LOG_ENTRIES)

export function PrinterPocPage() {
  const capabilities = useMemo(() => detectBluetoothPrinterCapabilities(), [])
  const bleConnectionRef = useRef(new BleEscPosPrinterConnection())
  const serialConnectionRef = useRef(new SerialEscPosPrinterConnection())

  const [activeMethod, setActiveMethod] = useState<PrinterConnectionMethod>(
    capabilities.recommendedMethod === 'none' ? 'classic-web-serial' : capabilities.recommendedMethod,
  )
  const [isConnected, setIsConnected] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [logs, setLogs] = useState<EscPosPrinterLogEntry[]>([])

  const pushLog = useCallback((entry: EscPosPrinterLogEntry) => {
    setLogs((currentLogs) => appendLog(currentLogs, entry))
  }, [])

  const getActiveConnection = useCallback(() => {
    return activeMethod === 'ble-web-bluetooth'
      ? bleConnectionRef.current
      : serialConnectionRef.current
  }, [activeMethod])

  const connect = useCallback(async () => {
    setIsBusy(true)
    setErrorMessage(null)

    try {
      const connection = getActiveConnection()
      connection.setLogHandler(pushLog)
      await connection.connect()
      setIsConnected(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      pushLog({ message, timestamp: Date.now(), type: 'error' })
    } finally {
      setIsBusy(false)
    }
  }, [getActiveConnection, pushLog])

  const printTest = useCallback(async () => {
    setIsBusy(true)
    setErrorMessage(null)

    try {
      await getActiveConnection().printTestReceipt()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      pushLog({ message, timestamp: Date.now(), type: 'error' })
    } finally {
      setIsBusy(false)
    }
  }, [getActiveConnection, pushLog])

  const disconnect = useCallback(async () => {
    setIsBusy(true)
    setErrorMessage(null)

    try {
      await getActiveConnection().disconnect()
      setIsConnected(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      pushLog({ message, timestamp: Date.now(), type: 'error' })
    } finally {
      setIsBusy(false)
    }
  }, [getActiveConnection, pushLog])

  return (
    <main className="page">
      <section className="content-card obd-poc-page" aria-label="Bluetooth プリンター PoC">
        <p className="eyebrow">Printer PoC</p>
        <h1>ESC/POS Bluetooth プリンター接続調査</h1>
        <p className="lead">
          現在の PWA 環境で Web Bluetooth / Web Serial の利用可否を確認し、テスト印字を行います。
        </p>

        <div className="obd-poc-status" role="status">
          <span>接続方式</span>
          <strong>{connectionMethodLabels[activeMethod]}</strong>
        </div>

        <div className="obd-poc-metrics" aria-label="API 対応状況">
          <div>
            <span>Secure Context</span>
            <strong>{capabilities.isSecureContext ? 'OK' : 'NG'}</strong>
          </div>
          <div>
            <span>navigator.bluetooth</span>
            <strong>{capabilities.hasWebBluetooth ? '利用可' : '不可'}</strong>
          </div>
          <div>
            <span>navigator.serial</span>
            <strong>{capabilities.hasWebSerial ? '利用可' : '不可'}</strong>
          </div>
          <div>
            <span>推奨方式</span>
            <strong>{connectionMethodLabels[capabilities.recommendedMethod]}</strong>
          </div>
        </div>

        <fieldset className="obd-poc-actions">
          <legend>接続方式を選択</legend>
          <label>
            <input
              type="radio"
              name="printer-method"
              value="classic-web-serial"
              checked={activeMethod === 'classic-web-serial'}
              disabled={isConnected || isBusy || !capabilities.hasWebSerial}
              onChange={() => setActiveMethod('classic-web-serial')}
            />
            Web Serial（Classic SPP・一般的な ESC/POS プリンター）
          </label>
          <label>
            <input
              type="radio"
              name="printer-method"
              value="ble-web-bluetooth"
              checked={activeMethod === 'ble-web-bluetooth'}
              disabled={isConnected || isBusy || !capabilities.hasWebBluetooth}
              onChange={() => setActiveMethod('ble-web-bluetooth')}
            />
            Web Bluetooth（BLE 対応プリンター専用）
          </label>
        </fieldset>

        {errorMessage ? <p className="obd-poc-error">{errorMessage}</p> : null}

        <div className="obd-poc-actions">
          <button
            type="button"
            className="primary-action"
            disabled={isBusy || isConnected}
            onClick={() => {
              void connect()
            }}
          >
            接続
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={isBusy || !isConnected}
            onClick={() => {
              void printTest()
            }}
          >
            テスト印字
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={isBusy || !isConnected}
            onClick={() => {
              void disconnect()
            }}
          >
            切断
          </button>
        </div>

        <section aria-label="調査メモ">
          <h2>調査メモ</h2>
          <ul>
            {capabilities.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p>
            <small>
              UA: {capabilities.userAgent}
              <br />
              Platform: {capabilities.platform}
            </small>
          </p>
        </section>

        <section aria-label="接続ログ">
          <h2>ログ</h2>
          <ol className="obd-poc-log">
            {logs.length === 0 ? (
              <li className="obd-poc-log__empty">ログはまだありません</li>
            ) : (
              logs.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`}>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                  <span>{logTypeLabels[entry.type]}</span>
                  <span>{entry.message}</span>
                </li>
              ))
            )}
          </ol>
        </section>
      </section>
    </main>
  )
}
