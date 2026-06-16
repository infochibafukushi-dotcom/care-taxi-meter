import { useCallback, useEffect, useRef, useState } from 'react'
import type { MeterMovementState } from '../types/case'
import type { SpeedSource } from '../services/gpsSpeed'
import {
  ObdConnection,
  type ObdLogEntry,
} from '../services/obdConnection'

const POLL_INTERVAL_MS = 1000
const STABLE_POLLS_REQUIRED = 5
const RECOVERED_FLASH_MS = 3000

export type ObdConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'stabilizing'
  | 'connected'
  | 'disconnected'

export type ObdIndicatorVariant =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'recovered'

export type ObdIndicatorState = {
  label: string
  variant: ObdIndicatorVariant
  visible: boolean
}

export type InitialObdMeterState = Partial<{
  businessDistanceKm: number
  chargeableDistanceKm: number
  currentSpeedKmh: number | null
  lowSpeedSeconds: number
  movementState: MeterMovementState
}>

export type ObdConnectOptions = {
  interactive?: boolean
  isInitialTripConnect?: boolean
  isReconnect?: boolean
}

type UseObdMeterTelemetryOptions = {
  enableLogging?: boolean
  initialState?: InitialObdMeterState
  isEnabled: boolean
  isTripActive: boolean
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
  isEnabled,
  isTripActive,
  lowSpeedThresholdKmh,
  resetKey = 0,
}: UseObdMeterTelemetryOptions) {
  const connectionRef = useRef<ObdConnection | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const isInitialResetRenderRef = useRef(true)
  const stablePollCountRef = useRef(0)
  const recoveredFlashTimerRef = useRef<number | null>(null)

  const [connectionPhase, setConnectionPhase] = useState<ObdConnectionPhase>('idle')
  const [isBleConnected, setIsBleConnected] = useState(false)
  const [requiresStabilization, setRequiresStabilization] = useState(false)
  const [isStableForTelemetry, setIsStableForTelemetry] = useState(false)
  const [showRecoveredFlash, setShowRecoveredFlash] = useState(false)
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

  const clearRecoveredFlashTimer = useCallback(() => {
    if (recoveredFlashTimerRef.current !== null) {
      window.clearTimeout(recoveredFlashTimerRef.current)
      recoveredFlashTimerRef.current = null
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const markDisconnected = useCallback((message?: string) => {
    stopPolling()
    connectionRef.current = null
    stablePollCountRef.current = 0
    setIsBleConnected(false)
    setIsStableForTelemetry(false)
    setCurrentSpeedKmh(null)
    setMovementState('unknown')
    setConnectionPhase('disconnected')
    if (message) {
      setErrorMessage(message)
    }
    if (isTripActive) {
      setRequiresStabilization(true)
    }
  }, [isTripActive, stopPolling])

  const resetTelemetry = useCallback(() => {
    stopPolling()
    clearRecoveredFlashTimer()
    connectionRef.current?.setDisconnectedHandler(null)
    connectionRef.current = null
    setRequiresStabilization(false)
    stablePollCountRef.current = 0
    setConnectionPhase('idle')
    setIsBleConnected(false)
    setIsStableForTelemetry(false)
    setShowRecoveredFlash(false)
    setCurrentSpeedKmh(null)
    setBusinessDistanceKm(0)
    setChargeableDistanceKm(0)
    setLowSpeedSeconds(0)
    setMovementState('unknown')
    setErrorMessage(null)
    if (enableLogging) {
      setLogs([])
    }
  }, [clearRecoveredFlashTimer, enableLogging, stopPolling])

  const handleStableConnection = useCallback(() => {
    setIsStableForTelemetry(true)
    setConnectionPhase('connected')

    if (requiresStabilization) {
      setRequiresStabilization(false)
      setShowRecoveredFlash(true)
      clearRecoveredFlashTimer()
      recoveredFlashTimerRef.current = window.setTimeout(() => {
        setShowRecoveredFlash(false)
        recoveredFlashTimerRef.current = null
      }, RECOVERED_FLASH_MS)
    }
  }, [clearRecoveredFlashTimer, requiresStabilization])

  const registerStablePoll = useCallback(() => {
    if (!requiresStabilization) {
      handleStableConnection()
      return
    }

    stablePollCountRef.current += 1
    if (stablePollCountRef.current >= STABLE_POLLS_REQUIRED) {
      handleStableConnection()
    }
  }, [handleStableConnection, requiresStabilization])

  const pollTelemetry = useCallback(async () => {
    const connection = connectionRef.current
    if (!connection?.isConnected()) {
      return
    }

    try {
      const nextSpeedKmh = await connection.readVehicleSpeed()
      setCurrentSpeedKmh(nextSpeedKmh)
      setMovementState(deriveMovementState(nextSpeedKmh, lowSpeedThresholdKmh))
      registerStablePoll()

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
      markDisconnected(message)
    }
  }, [lowSpeedThresholdKmh, markDisconnected, pushLog, registerStablePoll])

  const startPolling = useCallback(() => {
    stopPolling()
    pollTimerRef.current = window.setInterval(() => {
      void pollTelemetry()
    }, POLL_INTERVAL_MS)
  }, [pollTelemetry, stopPolling])

  const disconnect = useCallback(async () => {
    stopPolling()
    clearRecoveredFlashTimer()

    const connection = connectionRef.current
    connectionRef.current = null
    setRequiresStabilization(false)
    stablePollCountRef.current = 0

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

    setConnectionPhase('idle')
    setIsBleConnected(false)
    setIsStableForTelemetry(false)
    setShowRecoveredFlash(false)
    setCurrentSpeedKmh(null)
    setMovementState('unknown')
    setErrorMessage(null)
  }, [clearRecoveredFlashTimer, pushLog, stopPolling])

  const connect = useCallback(async (options?: ObdConnectOptions): Promise<boolean> => {
    const interactive = options?.interactive ?? true
    const isInitialTripConnect = options?.isInitialTripConnect ?? false
    const isReconnect = options?.isReconnect ?? false

    if (!isEnabled) {
      return false
    }

    if (
      connectionPhase === 'connecting' ||
      connectionPhase === 'reconnecting' ||
      connectionPhase === 'stabilizing'
    ) {
      return false
    }

    if (connectionRef.current?.isConnected()) {
      return isStableForTelemetry
    }

    if (!navigator.bluetooth) {
      setErrorMessage('このブラウザは Web Bluetooth に対応していません')
      setConnectionPhase('disconnected')
      return false
    }

    const shouldStabilize = !isInitialTripConnect && (isReconnect || isTripActive)

    if (isInitialTripConnect) {
      setRequiresStabilization(false)
    } else if (shouldStabilize) {
      setRequiresStabilization(true)
    }

    stablePollCountRef.current = 0
    setIsStableForTelemetry(false)
    setShowRecoveredFlash(false)
    setConnectionPhase(isReconnect ? 'reconnecting' : 'connecting')
    setErrorMessage(null)

    const connection = new ObdConnection()
    connection.setLogHandler((entry) => {
      pushLog(entry)
    })
    connection.setDisconnectedHandler(() => {
      pushLog({
        message: 'BLE接続が切断されました',
        timestamp: Date.now(),
        type: 'info',
      })
      markDisconnected()
    })
    connectionRef.current = connection

    try {
      const reconnected = await connection.connectPermittedDevice()
      if (!reconnected) {
        if (!interactive) {
          markDisconnected()
          connectionRef.current = null
          return false
        }

        await connection.connect()
      }

      await connection.initialize()

      setIsBleConnected(true)

      if (shouldStabilize) {
        setConnectionPhase('stabilizing')
      } else {
        handleStableConnection()
      }

      if (isTripActive) {
        startPolling()
        void pollTelemetry()
      }

      return !shouldStabilize
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBD 接続に失敗しました'
      pushLog({
        message,
        timestamp: Date.now(),
        type: 'error',
      })
      markDisconnected(message)
      connectionRef.current = null

      try {
        await connection.disconnect()
      } catch {
        // Ignore cleanup errors after a failed connect.
      }

      return false
    }
  }, [
    connectionPhase,
    handleStableConnection,
    isEnabled,
    isStableForTelemetry,
    isTripActive,
    markDisconnected,
    pollTelemetry,
    pushLog,
    startPolling,
  ])

  useEffect(() => {
    if (!isTripActive || !connectionRef.current?.isConnected()) {
      return undefined
    }

    startPolling()
    void pollTelemetry()

    return () => {
      stopPolling()
    }
  }, [isTripActive, pollTelemetry, startPolling, stopPolling])

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
    clearRecoveredFlashTimer()
    const connection = connectionRef.current
    connectionRef.current = null
    if (connection) {
      connection.setDisconnectedHandler(null)
      void connection.disconnect()
    }
  }, [clearRecoveredFlashTimer, stopPolling])

  const isConnected =
    isBleConnected ||
    connectionPhase === 'connected' ||
    connectionPhase === 'stabilizing'
  const speedSource: SpeedSource = isStableForTelemetry ? 'obd' : 'unavailable'

  const indicator = ((): ObdIndicatorState => {
    if (!isEnabled) {
      return { label: '', variant: 'disconnected', visible: false }
    }

    if (showRecoveredFlash) {
      return { label: 'OBD復帰', variant: 'recovered', visible: true }
    }

    if (connectionPhase === 'connecting') {
      return { label: 'OBD接続中…', variant: 'connecting', visible: true }
    }

    if (connectionPhase === 'reconnecting' || connectionPhase === 'stabilizing') {
      return { label: 'OBD再接続中', variant: 'reconnecting', visible: true }
    }

    if (isStableForTelemetry) {
      return { label: 'OBD接続中', variant: 'connected', visible: true }
    }

    if (connectionPhase === 'disconnected' && (isTripActive || requiresStabilization)) {
      return { label: 'OBD切断（GPS補正中）', variant: 'disconnected', visible: true }
    }

    return { label: '', variant: 'disconnected', visible: false }
  })()

  return {
    businessDistanceKm,
    chargeableDistanceKm,
    connect,
    connectionPhase,
    currentSpeedKmh,
    disconnect,
    errorMessage,
    indicator,
    isConnected,
    isStableForTelemetry,
    logs,
    lowSpeedSeconds,
    movementState,
    speedSource,
  }
}
