import { useEffect } from 'react'
import { useCurrentPosition } from './useCurrentPosition'
import {
  useObdMeterTelemetry,
  type InitialObdMeterState,
  type ObdConnectOptions,
  type ObdIndicatorState,
} from './useObdMeterTelemetry'
import type { MeterMode } from '../types/case'

type UseMeterTelemetryOptions = {
  initialObdState?: InitialObdMeterState
  isActive: boolean
  isDistanceAccumulating?: boolean
  isTripStarted: boolean
  lowSpeedThresholdKmh: number
  meterMode: MeterMode
  meterResetKey?: number
  sessionResetKey?: number
}

export function useMeterTelemetry({
  initialObdState,
  isActive,
  isDistanceAccumulating = true,
  isTripStarted,
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

  useEffect(() => {
    if (meterMode !== 'obd') {
      void disconnectObdTelemetry()
    }
  }, [disconnectObdTelemetry, meterMode])

  const isObdStableForTelemetry = isObdMode && obd.isStableForTelemetry
  const isUsingObdTelemetry = isObdStableForTelemetry

  const merged = isUsingObdTelemetry
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
