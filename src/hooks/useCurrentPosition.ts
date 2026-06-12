import { useEffect, useMemo, useState } from 'react'
import { gpsVehicleSpeedProvider } from '../services/gpsSpeed'
import type { SpeedSource } from '../services/gpsSpeed'
import type { GpsLogEntry, GpsPosition, MeterMovementState } from '../types/case'
import { calculateDistanceMeters } from '../utils/distance'

type GpsStatus = 'idle' | 'locating' | 'ready' | 'error' | 'unsupported'

type GpsLogState = {
  businessDistanceMeters: number
  chargeableDistanceMeters: number
  currentSpeedKmh: number | null
  logs: GpsLogEntry[]
  lowSpeedSeconds: number
  movementState: MeterMovementState
  speedSource: SpeedSource
}

type InitialGpsState = Partial<{
  businessDistanceKm: number
  chargeableDistanceKm: number
  currentSpeedKmh: number | null
  lowSpeedSeconds: number
  movementState: MeterMovementState
  position: GpsPosition | null
  speedSource: SpeedSource
}>

const GPS_INTERVAL_MS = 5000
export const MAX_DISTANCE_ACCURACY_METERS = 30
const MIN_SEGMENT_DISTANCE_METERS = 5
const MAX_DISTANCE_PER_INTERVAL_METERS = 500
const GPS_INTERVAL_SECONDS = GPS_INTERVAL_MS / 1000
const UNSUPPORTED_GPS_MESSAGE = 'この端末ではGPS取得を利用できません'

const shouldIncludeGpsSegment = (
  previousLog: GpsLogEntry | undefined,
  currentLog: GpsLogEntry,
) => {
  if (!previousLog) {
    return false
  }

  if (
    previousLog.accuracy > MAX_DISTANCE_ACCURACY_METERS ||
    currentLog.accuracy > MAX_DISTANCE_ACCURACY_METERS
  ) {
    return false
  }

  const distanceMeters = calculateDistanceMeters(previousLog, currentLog)
  const elapsedSeconds = Math.max(
    (currentLog.capturedAt - previousLog.capturedAt) / 1000,
    1,
  )
  const isTooShortSegment = distanceMeters < MIN_SEGMENT_DISTANCE_METERS
  const isAbnormalMovement =
    elapsedSeconds <= GPS_INTERVAL_SECONDS &&
    distanceMeters >= MAX_DISTANCE_PER_INTERVAL_METERS

  return !isTooShortSegment && !isAbnormalMovement
}

const shouldIncludeChargeableDistance = (
  previousLog: GpsLogEntry | undefined,
  currentLog: GpsLogEntry,
  currentSpeedKmh: number | null,
  lowSpeedThresholdKmh: number,
) => {
  if (currentSpeedKmh == null || currentSpeedKmh <= lowSpeedThresholdKmh) {
    return false
  }

  return shouldIncludeGpsSegment(previousLog, currentLog)
}

const shouldIncludeBusinessDistance = (
  previousLog: GpsLogEntry | undefined,
  currentLog: GpsLogEntry,
) => shouldIncludeGpsSegment(previousLog, currentLog)

export function useCurrentPosition(
  isActive: boolean,
  lowSpeedThresholdKmh = 10,
  isFareMeterActive = isActive,
  isBusinessDistanceActive = isActive,
  initialGpsState: InitialGpsState = {},
) {
  const [position, setPosition] = useState<GpsPosition | null>(initialGpsState.position ?? null)
  const [status, setStatus] = useState<GpsStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [gpsLogState, setGpsLogState] = useState<GpsLogState>({
    businessDistanceMeters: Math.max(initialGpsState.businessDistanceKm ?? 0, 0) * 1000,
    chargeableDistanceMeters: Math.max(initialGpsState.chargeableDistanceKm ?? 0, 0) * 1000,
    currentSpeedKmh: initialGpsState.currentSpeedKmh ?? null,
    logs: [],
    lowSpeedSeconds: Math.max(initialGpsState.lowSpeedSeconds ?? 0, 0),
    movementState: initialGpsState.movementState ?? 'unknown',
    speedSource: initialGpsState.speedSource ?? 'unavailable',
  })
  const isUnsupported = !('geolocation' in navigator)

  useEffect(() => {
    if (!isActive || isUnsupported) {
      return undefined
    }

    let isMounted = true

    const fetchCurrentPosition = () => {
      navigator.geolocation.getCurrentPosition(
        (geolocationPosition) => {
          if (!isMounted) {
            return
          }

          const currentPosition: GpsPosition = {
            latitude: geolocationPosition.coords.latitude,
            longitude: geolocationPosition.coords.longitude,
            accuracy: geolocationPosition.coords.accuracy,
            speed: geolocationPosition.coords.speed,
            updatedAt: geolocationPosition.timestamp,
          }
          const currentLog: GpsLogEntry = {
            capturedAt: currentPosition.updatedAt,
            latitude: currentPosition.latitude,
            longitude: currentPosition.longitude,
            speed: currentPosition.speed,
            accuracy: currentPosition.accuracy,
          }

          setPosition(currentPosition)
          setGpsLogState((currentState) => {
            const previousLog = currentState.logs.at(-1)
            const elapsedSeconds = previousLog
              ? Math.max((currentLog.capturedAt - previousLog.capturedAt) / 1000, 0)
              : 0
            const speedReading = gpsVehicleSpeedProvider.getSpeedReading(
              currentPosition,
              previousLog,
            )
            const movementState =
              speedReading.speedKmh == null
                ? 'unknown'
                : speedReading.speedKmh <= lowSpeedThresholdKmh
                  ? 'low-speed'
                  : 'normal'
            const segmentDistanceMeters = previousLog
              ? calculateDistanceMeters(previousLog, currentLog)
              : 0
            const shouldAddChargeableDistance = isFareMeterActive && shouldIncludeChargeableDistance(
              previousLog,
              currentLog,
              speedReading.speedKmh,
              lowSpeedThresholdKmh,
            )
            const shouldAddBusinessDistance = isBusinessDistanceActive && shouldIncludeBusinessDistance(
              previousLog,
              currentLog,
            )
            const chargeableAdditionalDistanceMeters = shouldAddChargeableDistance
              ? segmentDistanceMeters
              : 0
            const businessAdditionalDistanceMeters = shouldAddBusinessDistance
              ? segmentDistanceMeters
              : 0
            const chargeableDistanceMeters =
              currentState.chargeableDistanceMeters + chargeableAdditionalDistanceMeters
            const businessDistanceMeters =
              currentState.businessDistanceMeters + businessAdditionalDistanceMeters
            const lowSpeedSeconds =
              isFareMeterActive && movementState === 'low-speed'
                ? currentState.lowSpeedSeconds + elapsedSeconds
                : currentState.lowSpeedSeconds

            return {
              businessDistanceMeters,
              chargeableDistanceMeters,
              currentSpeedKmh: speedReading.speedKmh,
              logs: [...currentState.logs, currentLog],
              lowSpeedSeconds,
              movementState,
              speedSource: speedReading.source,
            }
          })
          setStatus('ready')
          setErrorMessage(null)
        },
        (geolocationError) => {
          if (!isMounted) {
            return
          }

          setStatus('error')
          setErrorMessage(geolocationError.message)
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        },
      )
    }

    fetchCurrentPosition()
    const intervalId = window.setInterval(fetchCurrentPosition, GPS_INTERVAL_MS)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [isActive, isBusinessDistanceActive, isFareMeterActive, isUnsupported, lowSpeedThresholdKmh])

  const derivedStatus = useMemo<GpsStatus>(() => {
    if (!isActive) {
      return 'idle'
    }

    if (isUnsupported) {
      return 'unsupported'
    }

    return status === 'idle' ? 'locating' : status
  }, [isActive, isUnsupported, status])

  const businessDistanceKm = gpsLogState.businessDistanceMeters / 1000

  return {
    businessDistanceKm,
    chargeableDistanceKm: gpsLogState.chargeableDistanceMeters / 1000,
    currentSpeedKmh: gpsLogState.currentSpeedKmh,
    errorMessage: isActive && isUnsupported
      ? UNSUPPORTED_GPS_MESSAGE
      : errorMessage,
    gpsLogCount: gpsLogState.logs.length,
    isActive,
    lowSpeedSeconds: gpsLogState.lowSpeedSeconds,
    movementState: gpsLogState.movementState,
    position,
    speedSource: gpsLogState.speedSource,
    status: derivedStatus,
    totalDistanceKm: businessDistanceKm,
  }
}
