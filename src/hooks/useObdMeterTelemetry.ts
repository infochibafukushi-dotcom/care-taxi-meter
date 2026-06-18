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

export type ObdSeedMetrics = {
  businessDistanceKm: number
  chargeableDistanceKm: number
  lowSpeedSeconds: number
}

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

const resolveConnectIntent = (options: ObdConnectOptions) => {
  if (options.isInitialTripConnect) {
    return 'initial-trip'
  }

  if (options.interactive) {
    return 'interactive'
  }

  return 'silent-reconnect'
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
  const isInitialResetRenderRef = useRef(true)
  const isInitialSessionResetRenderRef = useRef(true)
  const stablePollCountRef = useRef(0)
  const recoveredFlashTimerRef = useRef<number | null>(null)
  const isDistanceAccumulatingRef = useRef(isDistanceAccumulating)
  const connectRef = useRef<(options?: ObdConnectOptions) => Promise<boolean>>(async () => false)
  const connectInFlightRef = useRef<{ intent: string; promise: Promise<boolean> } | null>(null)
  const connectionPhaseRef = useRef<ObdConnectionPhase>('idle')
  const isBleConnectedRef = useRef(false)
  const isStableForTelemetryRef = useRef(false)

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
  const [needsInteractiveReconnect, setNeedsInteractiveReconnect] = useState(false)
  const [interactiveReconnectFailed, setInteractiveReconnectFailed] = useState(false)

  useEffect(() => {
    connectionPhaseRef.current = connectionPhase
  }, [connectionPhase])

  useEffect(() => {
    isBleConnectedRef.current = isBleConnected
  }, [isBleConnected])

  useEffect(() => {
    isStableForTelemetryRef.current = isStableForTelemetry
  }, [isStableForTelemetry])

  const isConnectedForStartFromRefs = () =>
    isObdConnectedForStartState(
      connectionPhaseRef.current,
      isBleConnectedRef.current,
      connectionRef.current,
    )

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

  const resetSessionMetrics = useCallback(() => {
    setBusinessDistanceKm(0)
    setChargeableDistanceKm(0)
    setLowSpeedSeconds(0)
  }, [])

  const seedMetrics = useCallback((metrics: ObdSeedMetrics) => {
    setBusinessDistanceKm(metrics.businessDistanceKm)
    setChargeableDistanceKm(metrics.chargeableDistanceKm)
    setLowSpeedSeconds(metrics.lowSpeedSeconds)
  }, [])

  const clearManualReconnectState = useCallback(() => {
    setNeedsInteractiveReconnect(false)
    setInteractiveReconnectFailed(false)
  }, [])

  const markDisconnected = useCallback((message?: string) => {
    stopPolling()
    connectionRef.current = null
    connectInFlightRef.current = null
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
      setNeedsInteractiveReconnect(true)
      setInteractiveReconnectFailed(false)
    }
  }, [isTripActive, stopPolling])

  const resetTelemetry = useCallback(() => {
    stopPolling()
    clearRecoveredFlashTimer()
    connectInFlightRef.current = null
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
    setNeedsInteractiveReconnect(false)
    setInteractiveReconnectFailed(false)
    if (enableLogging) {
      setLogs([])
    }
  }, [clearRecoveredFlashTimer, enableLogging, stopPolling])

  const handleStableConnection = useCallback(() => {
    setIsStableForTelemetry(true)
    setConnectionPhase('connected')
    clearManualReconnectState()

    if (requiresStabilization) {
      setRequiresStabilization(false)
      setShowRecoveredFlash(true)
      clearRecoveredFlashTimer()
      recoveredFlashTimerRef.current = window.setTimeout(() => {
        setShowRecoveredFlash(false)
        recoveredFlashTimerRef.current = null
      }, RECOVERED_FLASH_MS)
    }
  }, [clearManualReconnectState, clearRecoveredFlashTimer, requiresStabilization])

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
    clearRecoveredFlashTimer()
    connectInFlightRef.current = null

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

  const executeObdConnect = useCallback(async (options: ObdConnectOptions): Promise<boolean> => {
    const interactive = options.interactive ?? true
    const isInitialTripConnect = options.isInitialTripConnect ?? false
    const isReconnect = options.isReconnect ?? false

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
        const shouldRequestDevice = interactive || isInitialTripConnect
        if (!shouldRequestDevice) {
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

      clearManualReconnectState()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBD 接続に失敗しました'
      pushLog({
        message,
        timestamp: Date.now(),
        type: 'error',
      })
      if (interactive && isTripActive) {
        markDisconnected(message)
        setInteractiveReconnectFailed(true)
      } else {
        markDisconnected(message)
      }
      connectionRef.current = null

      try {
        await connection.disconnect()
      } catch {
        // Ignore cleanup errors after a failed connect.
      }

      return false
    }
  }, [
    clearManualReconnectState,
    handleStableConnection,
    isTripActive,
    markDisconnected,
    pollTelemetry,
    pushLog,
    startPolling,
  ])

  const awaitConnectAttempt = useCallback(
    async (attemptOptions: ObdConnectOptions): Promise<boolean> => {
      if (isConnectedForStartFromRefs()) {
        return true
      }

      const intent = resolveConnectIntent(attemptOptions)
      const inFlight = connectInFlightRef.current

      if (!inFlight || inFlight.intent !== intent) {
        const connectPromise = executeObdConnect(attemptOptions)
        connectInFlightRef.current = { intent, promise: connectPromise }
        connectPromise.finally(() => {
          if (connectInFlightRef.current?.promise === connectPromise) {
            connectInFlightRef.current = null
          }
        })
      }

      const result = await connectInFlightRef.current!.promise
      return result || isConnectedForStartFromRefs()
    },
    [executeObdConnect],
  )

  const connect = useCallback(async (options?: ObdConnectOptions): Promise<boolean> => {
    const connectOptions: ObdConnectOptions = options ?? {}
    const isInitialTripConnect = connectOptions.isInitialTripConnect ?? false

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

      const phase = snapshot?.connectionPhase ?? connectionPhaseRef.current
      const bleConnected = snapshot?.isBleConnected ?? isBleConnectedRef.current
      const stableForTelemetry = snapshot?.isStableForTelemetry ?? isStableForTelemetryRef.current

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

    if (isConnectedForStartFromRefs()) {
      logConnectResult(true)
      return true
    }

    const connected = await awaitConnectAttempt(connectOptions)
    if (connected) {
      logConnectResult(true)
      return true
    }

    if (!connectInFlightRef.current) {
      const retryConnected = await awaitConnectAttempt(connectOptions)
      if (retryConnected) {
        logConnectResult(true)
        return true
      }
    }

    logConnectResult(false)
    return false
  }, [awaitConnectAttempt, isEnabled])

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
      connectionPhase === 'stabilizing'
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

    if (connectionPhase === 'connecting' || connectionPhase === 'reconnecting') {
      return { label: 'OBD状態：接続中', variant: 'connecting', visible: true }
    }

    if (connectionPhase === 'stabilizing') {
      return { label: 'OBD状態：安定化中', variant: 'reconnecting', visible: true }
    }

    if (isTripActive && isConnectedForStart && !isStableForTelemetry) {
      return { label: 'OBD計測未安定（GPS補正中）', variant: 'reconnecting', visible: true }
    }

    if (isConnectedForStart) {
      return { label: 'OBD状態：接続済み', variant: 'connected', visible: true }
    }

    if (connectionPhase === 'disconnected' && isTripActive) {
      if (interactiveReconnectFailed) {
        return { label: 'OBD未接続（GPSで計測中）', variant: 'disconnected', visible: true }
      }

      return { label: 'OBD切断中（GPS補正中）', variant: 'disconnected', visible: true }
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
    interactiveReconnectFailed,
    isBleConnected,
    isConnected,
    isConnectedForStart,
    isStableForTelemetry,
    logs,
    lowSpeedSeconds,
    movementState,
    needsInteractiveReconnect,
    obdMeterStatus,
    seedMetrics,
    speedSource,
  }
}
