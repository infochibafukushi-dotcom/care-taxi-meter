import { useEffect, useLayoutEffect, useRef } from 'react'
import { useCurrentPosition } from './useCurrentPosition'
import {
  useObdMeterTelemetry,
  type InitialObdMeterState,
  type ObdConnectOptions,
  type ObdIndicatorState,
  type ObdSeedMetrics,
} from './useObdMeterTelemetry'
import type { MeterMode } from '../types/case'

type UseMeterTelemetryOptions = {
  initialObdState?: InitialObdMeterState
  isActive: boolean
  isDistanceAccumulating?: boolean
  lowSpeedThresholdKmh: number
  meterMode: MeterMode
  meterResetKey?: number
  sessionResetKey?: number
}

type DistanceMetrics = ObdSeedMetrics

type FallbackBridge = {
  authoritative: DistanceMetrics
  gpsSnapshot: DistanceMetrics
}

const emptyDistanceMetrics = (): DistanceMetrics => ({
  businessDistanceKm: 0,
  chargeableDistanceKm: 0,
  lowSpeedSeconds: 0,
})

const toDistanceMetrics = (source: {
  businessDistanceKm: number
  chargeableDistanceKm: number
  lowSpeedSeconds: number
}): DistanceMetrics => ({
  businessDistanceKm: source.businessDistanceKm,
  chargeableDistanceKm: source.chargeableDistanceKm,
  lowSpeedSeconds: source.lowSpeedSeconds,
})

const computeBridgedMetrics = (
  authoritative: DistanceMetrics,
  gpsSnapshot: DistanceMetrics,
  gpsCurrent: DistanceMetrics,
): DistanceMetrics => ({
  businessDistanceKm:
    authoritative.businessDistanceKm +
    (gpsCurrent.businessDistanceKm - gpsSnapshot.businessDistanceKm),
  chargeableDistanceKm:
    authoritative.chargeableDistanceKm +
    (gpsCurrent.chargeableDistanceKm - gpsSnapshot.chargeableDistanceKm),
  lowSpeedSeconds:
    authoritative.lowSpeedSeconds +
    (gpsCurrent.lowSpeedSeconds - gpsSnapshot.lowSpeedSeconds),
})

export function useMeterTelemetry({
  initialObdState,
  isActive,
  isDistanceAccumulating = true,
  lowSpeedThresholdKmh,
  meterMode,
  meterResetKey = 0,
  sessionResetKey = 0,
}: UseMeterTelemetryOptions) {
  const isObdMode = meterMode === 'obd'

  const gpsRaw = useCurrentPosition(
    isActive,
    lowSpeedThresholdKmh,
    isDistanceAccumulating,
    isDistanceAccumulating,
    {},
    sessionResetKey,
  )

  const obd = useObdMeterTelemetry({
    initialState: initialObdState,
    isDistanceAccumulating,
    isEnabled: isObdMode,
    isTripActive: isActive && isObdMode,
    lowSpeedThresholdKmh,
    resetKey: meterResetKey,
    sessionResetKey,
  })
  const disconnectObdTelemetry = obd.disconnect
  const seedObdMetrics = obd.seedMetrics

  const fallbackBridgeRef = useRef<FallbackBridge | null>(null)
  const displayMetricsRef = useRef<DistanceMetrics>(
    initialObdState
      ? {
          businessDistanceKm: initialObdState.businessDistanceKm ?? 0,
          chargeableDistanceKm: initialObdState.chargeableDistanceKm ?? 0,
          lowSpeedSeconds: initialObdState.lowSpeedSeconds ?? 0,
        }
      : emptyDistanceMetrics(),
  )
  const prevIsObdStableRef = useRef(false)

  useEffect(() => {
    if (meterMode !== 'obd') {
      void disconnectObdTelemetry()
    }
  }, [disconnectObdTelemetry, meterMode])

  useEffect(() => {
    fallbackBridgeRef.current = null
  }, [meterResetKey, sessionResetKey])

  useEffect(() => {
    if (!isObdMode) {
      fallbackBridgeRef.current = null
      prevIsObdStableRef.current = false
    }
  }, [isObdMode])

  const isObdStableForTelemetry = isObdMode && obd.isStableForTelemetry
  const isUsingObdTelemetry = isObdStableForTelemetry

  const gpsMetrics = toDistanceMetrics(gpsRaw)

  if (
    isObdMode &&
    prevIsObdStableRef.current &&
    !isObdStableForTelemetry &&
    !fallbackBridgeRef.current
  ) {
    fallbackBridgeRef.current = {
      authoritative: { ...displayMetricsRef.current },
      gpsSnapshot: gpsMetrics,
    }
  }

  const bridgedMetrics =
    isObdMode && fallbackBridgeRef.current
      ? computeBridgedMetrics(
          fallbackBridgeRef.current.authoritative,
          fallbackBridgeRef.current.gpsSnapshot,
          gpsMetrics,
        )
      : null

  if (isObdStableForTelemetry) {
    displayMetricsRef.current = toDistanceMetrics(obd)
  } else if (bridgedMetrics) {
    displayMetricsRef.current = bridgedMetrics
  }

  prevIsObdStableRef.current = isObdStableForTelemetry

  useLayoutEffect(() => {
    if (!isObdMode || !isObdStableForTelemetry || !fallbackBridgeRef.current) {
      return
    }

    const bridge = fallbackBridgeRef.current
    const seedMetrics = computeBridgedMetrics(
      bridge.authoritative,
      bridge.gpsSnapshot,
      toDistanceMetrics(gpsRaw),
    )

    seedObdMetrics(seedMetrics)
    displayMetricsRef.current = seedMetrics
    fallbackBridgeRef.current = null
  }, [
    gpsRaw.businessDistanceKm,
    gpsRaw.chargeableDistanceKm,
    gpsRaw.lowSpeedSeconds,
    isObdMode,
    isObdStableForTelemetry,
    seedObdMetrics,
  ])

  const merged = !isObdMode
    ? gpsRaw
    : bridgedMetrics
      ? {
          ...gpsRaw,
          businessDistanceKm: bridgedMetrics.businessDistanceKm,
          chargeableDistanceKm: bridgedMetrics.chargeableDistanceKm,
          lowSpeedSeconds: bridgedMetrics.lowSpeedSeconds,
          totalDistanceKm: bridgedMetrics.businessDistanceKm,
        }
      : isUsingObdTelemetry
        ? {
            ...gpsRaw,
            businessDistanceKm: obd.businessDistanceKm,
            chargeableDistanceKm: obd.chargeableDistanceKm,
            currentSpeedKmh: obd.currentSpeedKmh,
            lowSpeedSeconds: obd.lowSpeedSeconds,
            movementState: obd.movementState,
            speedSource: obd.speedSource,
            totalDistanceKm: obd.businessDistanceKm,
          }
        : gpsRaw

  const connectObd = (options?: ObdConnectOptions) => obd.connect(options)

  const obdIndicator: ObdIndicatorState = isObdMode && obd.indicator.visible
    ? obd.indicator
    : { label: '', variant: 'disconnected', visible: false }

  const isObdBleConnected = isObdMode && obd.isBleConnected
  const isObdConnectedForStart = isObdMode && obd.isConnectedForStart

  return {
    ...merged,
    connectObd,
    disconnectObd: obd.disconnect,
    gpsRaw,
    isObdBleConnected,
    isObdConnected: isObdStableForTelemetry,
    isObdConnectedForStart,
    isObdStableForTelemetry,
    isUsingObdTelemetry,
    obdConnectionPhase: obd.connectionPhase,
    obdErrorMessage: obd.errorMessage,
    obdIndicator,
    obdMeterStatus: obd.obdMeterStatus,
  }
}
