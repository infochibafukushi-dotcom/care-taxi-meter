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
  isTripStarted: boolean
  lowSpeedThresholdKmh: number
  meterMode: MeterMode
  meterResetKey?: number
}

export function useMeterTelemetry({
  initialObdState,
  isActive,
  isTripStarted,
  lowSpeedThresholdKmh,
  meterMode,
  meterResetKey = 0,
}: UseMeterTelemetryOptions) {
  const isObdMode = meterMode === 'obd'

  const gpsRaw = useCurrentPosition(
    isActive,
    lowSpeedThresholdKmh,
    isActive,
    isActive,
    {},
    meterResetKey,
  )

  const obd = useObdMeterTelemetry({
    initialState: initialObdState,
    isEnabled: isObdMode,
    isTripActive: isActive && isObdMode,
    lowSpeedThresholdKmh,
    resetKey: meterResetKey,
  })
  const disconnectObdTelemetry = obd.disconnect

  useEffect(() => {
    if (meterMode !== 'obd') {
      void disconnectObdTelemetry()
    }
  }, [disconnectObdTelemetry, meterMode])

  const isUsingObdTelemetry = isObdMode && obd.isStableForTelemetry

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

  const obdIndicator: ObdIndicatorState = isObdMode && isTripStarted && obd.indicator.visible
    ? obd.indicator
    : { label: '', variant: 'disconnected', visible: false }

  return {
    ...merged,
    connectObd,
    disconnectObd: obd.disconnect,
    gpsRaw,
    isObdConnected: obd.isStableForTelemetry,
    isUsingObdTelemetry,
    obdConnectionPhase: obd.connectionPhase,
    obdErrorMessage: obd.errorMessage,
    obdIndicator,
  }
}
