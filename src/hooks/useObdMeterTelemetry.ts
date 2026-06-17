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
const RECONNECT_DELAYS_MS = [5000, 10000, 30000, 60000] as const

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

export type ObdMeterStatus = 'connected' | 'reconnecting' | 'disconnected'

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
  isDistanceAccumulating?: boolean
  isEnabled: boolean
  isTripActive: boolean
  lowSpeedThresholdKmh: number
  resetKey?: number
  sessionResetKey?: number
}

const START_READY_PHASES = new Set<ObdConnectionPhase>(['connected', 'stabilizing', 'reconnecting'])

export const isObdStartReadyPhase = (phase: ObdConnectionPhase) => START_READY_PHASES.has(phase)

export const isObdBleLinkUp = (connection: ObdConnection | null) => Boolean(connection?.isConnected())

export const isObdConnectedForStartState = (
  phase: ObdConnectionPhase,
  bleConnected: boolean,
  connection: ObdConnection | null,
) => bleConnected && isObdBleLinkUp(connection) && isObdStartReadyPhase(phase)

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
  isDistanceAccumulating = true,
  isEnabled,
  isTripActive,
  lowSpeedThresholdKmh,
  resetKey = 0,
  sessionResetKey = 0,
}: UseObdMeterTelemetryOptions) {
  const connectionRef = useRef<ObdConnection | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const isInitialResetRenderRef = useRef(true)
  const isInitialSessionResetRenderRef = useRef(true)
  const stablePollCountRef = useRef(0)
  const recoveredFlashTimerRef = useRef<number | null>(null)
  const isDistanceAccumulatingRef = useRef(isDistanceAccumulating)
  const connectRef = useRef<(options?: ObdConnectOptions) => Promise<boolean>>(async () => false)

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
  const [isAutoReconnectPending, setIsAutoReconnectPending] = useState(false)

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

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const resetSessionMetrics = useCallback(() => {
    setBusinessDistanceKm(0)
    setChargeableDistanceKm(0)
    setLowSpeedSeconds(0)
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

  const scheduleReconnect = useCallback(() => {
    if (!isEnabled || !isTripActive) {
      return
    }

    clearReconnectTimer()
    setIsAutoReconnectPending(true)
    const delayIndex = Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1)
    const delayMs = RECONNECT_DELAYS_MS[delayIndex]

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      reconnectAttemptRef.current += 1
      void connectRef.current({ interactive: false, isReconnect: true })
    }, delayMs)
  }, [clearReconnectTimer, isEnabled, isTripActive])

  const resetTelemetry = useCallback(() => {
    stopPolling()
    clearReconnectTimer()
    reconnectAttemptRef.current = 0
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
    setIsAutoReconnectPending(false)
    if (enableLogging) {
      setLogs([])
    }
  }, [clearRecoveredFlashTimer, clearReconnectTimer, enableLogging, stopPolling])

  const handleStableConnection = useCallback(() => {
    setIsStableForTelemetry(true)
    setConnectionPhase('connected')
    reconnectAttemptRef.current = 0
    clearReconnectTimer()
    setIsAutoReconnectPending(false)

    if (requiresStabilization) {
      setRequiresStabilization(false)
      setShowRecoveredFlash(true)
      clearRecoveredFlashTimer()
      recoveredFlashTimerRef.current = window.setTimeout(() => {
        setShowRecoveredFlash(false)
        recoveredFlashTimerRef.current = null
      }, RECOVERED_FLASH_MS)
    }
  }, [clearRecoveredFlashTimer, clearReconnectTimer, requiresStabilization])

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

      if (!isDistanceAccumulatingRef.current) {
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
    clearReconnectTimer()
    reconnectAttemptRef.current = 0
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
    setIsAutoReconnectPending(false)
  }, [clearRecoveredFlashTimer, clearReconnectTimer, pushLog, stopPolling])

  const connect = useCallback(async (options?: ObdConnectOptions): Promise<boolean> => {
    const interactive = options?.interactive ?? true
    const isInitialTripConnect = options?.isInitialTripConnect ?? false
    const isReconnect = options?.isReconnect ?? false

    const logConnectResult = (
      connected: boolean,
      snapshot?: {
        connectionPhase?: ObdConnectionPhase
        isBleConnected?: boolean
        isStableForTelemetry?: boolean
      },
    ) => {
      if (!isInitialTripConnect) {
        return
      }

      const phase = snapshot?.connectionPhase ?? connectionPhase
      const bleConnected = snapshot?.isBleConnected ?? isBleConnected
      const stableForTelemetry = snapshot?.isStableForTelemetry ?? isStableForTelemetry

      console.log('[OBDM] connect() 送迎開始接続', {
        connected,
        connectionPhase: phase,
        isBleConnected: bleConnected,
        isObdConnectedForStart: isObdConnectedForStartState(
          phase,
          bleConnected,
          connectionRef.current,
        ),
        isObdStableForTelemetry: stableForTelemetry,
      })
    }

    if (!isEnabled) {
      logConnectResult(false)
      return false
    }

    if (connectionPhase === 'connecting') {
      logConnectResult(false)
      return false
    }

    if (
      isObdConnectedForStartState(connectionPhase, isBleConnected, connectionRef.current)
    ) {
      logConnectResult(true)
      return true
    }

    if (connectionPhase === 'reconnecting' || connectionPhase === 'stabilizing') {
      logConnectResult(false)
      return false
    }

    if (!navigator.bluetooth) {
      setErrorMessage('このブラウザは Web Bluetooth に対応していません')
      setConnectionPhase('disconnected')
      logConnectResult(false)
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
      scheduleReconnect()
    })
    connectionRef.current = connection

    try {
      const reconnected = await connection.connectPermittedDevice()
      if (!reconnected) {
        if (!interactive) {
          markDisconnected()
          connectionRef.current = null
          if (isReconnect || isTripActive) {
            scheduleReconnect()
          }
          logConnectResult(false)
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

      reconnectAttemptRef.current = 0
      clearReconnectTimer()
      logConnectResult(true, {
        connectionPhase: shouldStabilize ? 'stabilizing' : 'connected',
        isBleConnected: true,
        isStableForTelemetry: !shouldStabilize,
      })
      return true
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

      if (isReconnect || isTripActive) {
        scheduleReconnect()
      }

      logConnectResult(false)
      return false
    }
  }, [
    clearReconnectTimer,
    connectionPhase,
    handleStableConnection,
    isBleConnected,
    isEnabled,
    isStableForTelemetry,
    isTripActive,
    markDisconnected,
    pollTelemetry,
    pushLog,
    scheduleReconnect,
    startPolling,
  ])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    isDistanceAccumulatingRef.current = isDistanceAccumulating
  }, [isDistanceAccumulating])

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

  useEffect(() => {
    if (isInitialSessionResetRenderRef.current) {
      isInitialSessionResetRenderRef.current = false
      return undefined
    }

    const resetTimerId = window.setTimeout(() => {
      resetSessionMetrics()
    }, 0)

    return () => window.clearTimeout(resetTimerId)
  }, [resetSessionMetrics, sessionResetKey])

  useEffect(() => {
    if (!isEnabled || !isTripActive) {
      clearReconnectTimer()
      reconnectAttemptRef.current = 0
      setIsAutoReconnectPending(false)
    }
  }, [clearReconnectTimer, isEnabled, isTripActive])

  useEffect(() => () => {
    stopPolling()
    clearReconnectTimer()
    clearRecoveredFlashTimer()
    const connection = connectionRef.current
    connectionRef.current = null
    if (connection) {
      connection.setDisconnectedHandler(null)
      void connection.disconnect()
    }
  }, [clearRecoveredFlashTimer, clearReconnectTimer, stopPolling])

  const isConnected =
    isBleConnected ||
    connectionPhase === 'connected' ||
    connectionPhase === 'stabilizing'
  const isConnectedForStart = isObdConnectedForStartState(
    connectionPhase,
    isBleConnected,
    connectionRef.current,
  )
  const speedSource: SpeedSource = isStableForTelemetry ? 'obd' : 'unavailable'

  const obdMeterStatus: ObdMeterStatus = (() => {
    if (!isEnabled) {
      return 'disconnected'
    }

    if (isStableForTelemetry) {
      return 'connected'
    }

    if (
      connectionPhase === 'connecting' ||
      connectionPhase === 'reconnecting' ||
      connectionPhase === 'stabilizing' ||
      isAutoReconnectPending
    ) {
      return 'reconnecting'
    }

    return 'disconnected'
  })()

  const indicator = ((): ObdIndicatorState => {
    if (!isEnabled) {
      return { label: '', variant: 'disconnected', visible: false }
    }

    if (showRecoveredFlash) {
      return { label: 'OBD復帰', variant: 'recovered', visible: true }
    }

    if (isStableForTelemetry && isTripActive) {
      return { label: 'OBD状態：OBD計測中', variant: 'connected', visible: true }
    }

    if (isTripActive && isConnectedForStart && !isStableForTelemetry) {
      return { label: 'OBD計測未安定（GPS補正中）', variant: 'reconnecting', visible: true }
    }

    if (connectionPhase === 'connecting' || connectionPhase === 'reconnecting') {
      return { label: 'OBD状態：接続中', variant: 'connecting', visible: true }
    }

    if (connectionPhase === 'stabilizing') {
      return { label: 'OBD状態：安定化中', variant: 'reconnecting', visible: true }
    }

    if (isConnectedForStart) {
      return { label: 'OBD状態：接続済み', variant: 'connected', visible: true }
    }

    if (connectionPhase === 'disconnected' && isTripActive) {
      return { label: 'OBD切断（GPS補正中）', variant: 'disconnected', visible: true }
    }

    return { label: 'OBD状態：未接続', variant: 'disconnected', visible: true }
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
    isBleConnected,
    isConnected,
    isConnectedForStart,
    isStableForTelemetry,
    logs,
    lowSpeedSeconds,
    movementState,
    obdMeterStatus,
    speedSource,
  }
}
