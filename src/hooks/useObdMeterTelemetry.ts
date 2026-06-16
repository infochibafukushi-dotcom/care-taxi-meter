import { useCallback, useEffect, useRef, useState } from 'react'
import type { MeterMovementState } from '../types/case'
import type { SpeedSource } from '../services/gpsSpeed'
import {
  ObdConnection,
  type ObdLogEntry,
} from '../services/obdConnection'

const POLL_INTERVAL_MS = 1000

export type ObdMeterConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type InitialObdMeterState = Partial<{
  businessDistanceKm: number
  chargeableDistanceKm: number
  currentSpeedKmh: number | null
  lowSpeedSeconds: number
  movementState: MeterMovementState
}>

type UseObdMeterTelemetryOptions = {
  enableLogging?: boolean
  initialState?: InitialObdMeterState
  isActive: boolean
  lowSpeedThresholdKmh: number
  resetKey?: number
}

const deriveMovementState = (
  speedKmh: number | null,
  lowSpeedThresholdKmh: number,
): MeterMovementState => {
  if (speedKmh == null) {
    return 'unknown'
  }

  return speedKmh <= lowSpeedThresholdKmh ? 'low-speed' : 'normal'
}

export function useObdMeterTelemetry({
  enableLogging = false,
  initialState = {},
  isActive,
  lowSpeedThresholdKmh,
  resetKey = 0,
}: UseObdMeterTelemetryOptions) {
  const connectionRef = useRef<ObdConnection | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const isInitialResetRenderRef = useRef(true)

  const [connectionStatus, setConnectionStatus] = useState<ObdMeterConnectionStatus>('disconnected')
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState<number | null>(initialState.currentSpeedKmh ?? null)
  const [businessDistanceKm, setBusinessDistanceKm] = useState(initialState.businessDistanceKm ?? 0)
  const [chargeableDistanceKm, setChargeableDistanceKm] = useState(initialState.chargeableDistanceKm ?? 0)
  const [lowSpeedSeconds, setLowSpeedSeconds] = useState(initialState.lowSpeedSeconds ?? 0)
  const [movementState, setMovementState] = useState<MeterMovementState>(
    initialState.movementState ?? 'unknown',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [logs, setLogs] = useState<ObdLogEntry[]>([])

  const pushLog = useCallback((entry: ObdLogEntry) => {
    if (!enableLogging) {
      return
    }

    setLogs((currentLogs) => [...currentLogs, entry].slice(-200))
  }, [enableLogging])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const resetTelemetry = useCallback(() => {
    stopPolling()
    connectionRef.current?.setDisconnectedHandler(null)
    connectionRef.current = null
    setConnectionStatus('disconnected')
    setCurrentSpeedKmh(null)
    setBusinessDistanceKm(0)
    setChargeableDistanceKm(0)
    setLowSpeedSeconds(0)
    setMovementState('unknown')
    setErrorMessage(null)
    if (enableLogging) {
      setLogs([])
    }
  }, [enableLogging, stopPolling])

  const pollTelemetry = useCallback(async () => {
    const connection = connectionRef.current
    if (!connection?.isConnected()) {
      return
    }

    try {
      const nextSpeedKmh = await connection.readVehicleSpeed()
      setCurrentSpeedKmh(nextSpeedKmh)
      setMovementState(deriveMovementState(nextSpeedKmh, lowSpeedThresholdKmh))

      if (nextSpeedKmh == null) {
        return
      }

      const distanceDeltaKm = nextSpeedKmh / 3600
      setBusinessDistanceKm((currentDistanceKm) => currentDistanceKm + distanceDeltaKm)

      if (nextSpeedKmh > lowSpeedThresholdKmh) {
        setChargeableDistanceKm((currentDistanceKm) => currentDistanceKm + distanceDeltaKm)
      } else {
        setLowSpeedSeconds((currentLowSpeedSeconds) => currentLowSpeedSeconds + 1)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBD データ取得に失敗しました'
      pushLog({
        message,
        timestamp: Date.now(),
        type: 'error',
      })
      setConnectionStatus('error')
      setErrorMessage(message)
      stopPolling()
    }
  }, [lowSpeedThresholdKmh, pushLog, stopPolling])

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
      connection.setDisconnectedHandler(null)
      try {
        await connection.disconnect()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OBD 切断に失敗しました'
        pushLog({
          message,
          timestamp: Date.now(),
          type: 'error',
        })
        setErrorMessage(message)
      }
    }

    setConnectionStatus('disconnected')
    setCurrentSpeedKmh(null)
    setMovementState('unknown')
    setErrorMessage(null)
  }, [pushLog, stopPolling])

  const connect = useCallback(async (options?: { interactive?: boolean }) => {
    const interactive = options?.interactive ?? true

    if (!isActive || connectionStatus === 'connecting' || connectionStatus === 'connected') {
      return
    }

    if (!navigator.bluetooth) {
      setConnectionStatus('error')
      setErrorMessage('このブラウザは Web Bluetooth に対応していません')
      return
    }

    setConnectionStatus('connecting')
    setErrorMessage(null)

    const connection = new ObdConnection()
    connection.setLogHandler((entry) => {
      pushLog(entry)
    })
    connection.setDisconnectedHandler(() => {
      stopPolling()
      connectionRef.current = null
      setConnectionStatus('disconnected')
      setCurrentSpeedKmh(null)
      setMovementState('unknown')
      pushLog({
        message: 'BLE接続が切断されました',
        timestamp: Date.now(),
        type: 'info',
      })
    })
    connectionRef.current = connection

    try {
      const reconnected = await connection.connectPermittedDevice()
      if (!reconnected) {
        if (!interactive) {
          setConnectionStatus('disconnected')
          connectionRef.current = null
          return
        }

        await connection.connect()
      }

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
      setConnectionStatus('disconnected')
      setErrorMessage(message)
      connectionRef.current = null

      try {
        await connection.disconnect()
      } catch {
        // Ignore cleanup errors after a failed connect.
      }
    }
  }, [connectionStatus, isActive, pollTelemetry, pushLog, startPolling, stopPolling])

  useEffect(() => {
    if (isInitialResetRenderRef.current) {
      isInitialResetRenderRef.current = false
      return undefined
    }

    const resetTimerId = window.setTimeout(() => {
      resetTelemetry()
    }, 0)

    return () => window.clearTimeout(resetTimerId)
  }, [resetKey, resetTelemetry])

  useEffect(() => () => {
    stopPolling()
    const connection = connectionRef.current
    connectionRef.current = null
    if (connection) {
      connection.setDisconnectedHandler(null)
      void connection.disconnect()
    }
  }, [stopPolling])

  const isConnected = connectionStatus === 'connected'
  const speedSource: SpeedSource = isConnected ? 'obd' : 'unavailable'

  return {
    businessDistanceKm,
    chargeableDistanceKm,
    connect,
    connectionStatus,
    currentSpeedKmh,
    disconnect,
    errorMessage,
    isConnected,
    logs,
    lowSpeedSeconds,
    movementState,
    speedSource,
  }
}
