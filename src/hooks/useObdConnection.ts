import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ObdConnection,
  type ObdLogEntry,
} from '../services/obdConnection'

const POLL_INTERVAL_MS = 1000
const LOW_SPEED_THRESHOLD_KMH = 10
const MAX_LOG_ENTRIES = 200

export type ObdConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type UseObdConnectionState = {
  connectionStatus: ObdConnectionStatus
  distanceKm: number
  errorMessage: string | null
  logs: ObdLogEntry[]
  lowSpeedSeconds: number
  rpm: number | null
  speedKmh: number | null
}

export type UseObdConnectionActions = {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

const appendLog = (logs: ObdLogEntry[], entry: ObdLogEntry) =>
  [...logs, entry].slice(-MAX_LOG_ENTRIES)

export function useObdConnection(): UseObdConnectionState & UseObdConnectionActions {
  const connectionRef = useRef<ObdConnection | null>(null)
  const pollTimerRef = useRef<number | null>(null)

  const [connectionStatus, setConnectionStatus] = useState<ObdConnectionStatus>('disconnected')
  const [speedKmh, setSpeedKmh] = useState<number | null>(null)
  const [rpm, setRpm] = useState<number | null>(null)
  const [distanceKm, setDistanceKm] = useState(0)
  const [lowSpeedSeconds, setLowSpeedSeconds] = useState(0)
  const [logs, setLogs] = useState<ObdLogEntry[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const pushLog = useCallback((entry: ObdLogEntry) => {
    setLogs((currentLogs) => appendLog(currentLogs, entry))
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const pollTelemetry = useCallback(async () => {
    const connection = connectionRef.current
    if (!connection?.isConnected()) {
      return
    }

    try {
      const nextSpeedKmh = await connection.readVehicleSpeed()
      const nextRpm = await connection.readEngineRpm()

      setSpeedKmh(nextSpeedKmh)
      setRpm(nextRpm)

      if (nextSpeedKmh != null) {
        setDistanceKm((currentDistanceKm) => currentDistanceKm + (nextSpeedKmh / 3600))

        if (nextSpeedKmh <= LOW_SPEED_THRESHOLD_KMH) {
          setLowSpeedSeconds((currentLowSpeedSeconds) => currentLowSpeedSeconds + 1)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PID 取得に失敗しました'
      pushLog({
        message,
        timestamp: Date.now(),
        type: 'error',
      })
      setConnectionStatus('error')
      setErrorMessage(message)
      stopPolling()
    }
  }, [pushLog, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    pollTimerRef.current = window.setInterval(() => {
      void pollTelemetry()
    }, POLL_INTERVAL_MS)
  }, [pollTelemetry, stopPolling])

  const disconnect = useCallback(async () => {
    stopPolling()

    const connection = connectionRef.current
    connectionRef.current = null

    if (connection) {
      try {
        await connection.disconnect()
      } catch (error) {
        const message = error instanceof Error ? error.message : '切断に失敗しました'
        pushLog({
          message,
          timestamp: Date.now(),
          type: 'error',
        })
      }
    }

    setConnectionStatus('disconnected')
    setSpeedKmh(null)
    setRpm(null)
    setDistanceKm(0)
    setLowSpeedSeconds(0)
    setErrorMessage(null)
  }, [pushLog, stopPolling])

  const connect = useCallback(async () => {
    if (connectionStatus === 'connecting' || connectionStatus === 'connected') {
      return
    }

    setConnectionStatus('connecting')
    setErrorMessage(null)
    setSpeedKmh(null)
    setRpm(null)
    setDistanceKm(0)
    setLowSpeedSeconds(0)

    const connection = new ObdConnection()
    connection.setLogHandler((entry) => {
      pushLog(entry)
    })
    connectionRef.current = connection

    try {
      await connection.connect()
      await connection.initialize()
      setConnectionStatus('connected')
      startPolling()
      void pollTelemetry()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBD 接続に失敗しました'
      pushLog({
        message,
        timestamp: Date.now(),
        type: 'error',
      })
      setConnectionStatus('error')
      setErrorMessage(message)
      connectionRef.current = null

      try {
        await connection.disconnect()
      } catch {
        // Ignore cleanup errors after a failed connect.
      }
    }
  }, [connectionStatus, pollTelemetry, pushLog, startPolling])

  useEffect(() => () => {
    stopPolling()

    const connection = connectionRef.current
    connectionRef.current = null

    if (connection) {
      void connection.disconnect()
    }
  }, [stopPolling])

  return {
    connect,
    connectionStatus,
    disconnect,
    distanceKm,
    errorMessage,
    logs,
    lowSpeedSeconds,
    rpm,
    speedKmh,
  }
}
