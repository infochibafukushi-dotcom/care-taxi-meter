import { useEffect, useMemo } from 'react'
import { useCurrentPosition } from './useCurrentPosition'
import {
  useObdMeterTelemetry,
  type InitialObdMeterState,
} from './useObdMeterTelemetry'
import type { MeterMode } from '../types/case'

type UseMeterTelemetryOptions = {
  initialObdState?: InitialObdMeterState
  isActive: boolean
  lowSpeedThresholdKmh: number
  meterMode: MeterMode
  meterResetKey?: number
}

export function useMeterTelemetry({
  initialObdState,
  isActive,
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
    isActive: isActive && isObdMode,
    lowSpeedThresholdKmh,
    resetKey: meterResetKey,
  })
  const disconnectObdTelemetry = obd.disconnect

  useEffect(() => {
    if (!isActive || !isObdMode) {
      void disconnectObdTelemetry()
    }
  }, [disconnectObdTelemetry, isActive, isObdMode])

  useEffect(() => {
    if (meterMode !== 'obd') {
      void disconnectObdTelemetry()
    }
  }, [disconnectObdTelemetry, meterMode])

  const isUsingObdTelemetry = isObdMode && obd.isConnected

  const merged = useMemo(() => {
    if (!isUsingObdTelemetry) {
      return gpsRaw
    }

    return {
      ...gpsRaw,
      businessDistanceKm: obd.businessDistanceKm,
      chargeableDistanceKm: obd.chargeableDistanceKm,
      currentSpeedKmh: obd.currentSpeedKmh,
      lowSpeedSeconds: obd.lowSpeedSeconds,
      movementState: obd.movementState,
      speedSource: obd.speedSource,
      totalDistanceKm: obd.businessDistanceKm,
    }
  }, [gpsRaw, isUsingObdTelemetry, obd])

  return {
    ...merged,
    connectObd: obd.connect,
    disconnectObd: obd.disconnect,
    gpsRaw,
    isObdConnected: obd.isConnected,
    isUsingObdTelemetry,
    obdConnectionStatus: obd.connectionStatus,
    obdErrorMessage: obd.errorMessage,
  }
}
