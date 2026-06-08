import { useEffect, useMemo, useState } from 'react'
import { gpsVehicleSpeedProvider } from '../services/gpsSpeed'
import type { SpeedSource } from '../services/gpsSpeed'
import type { GpsLogEntry, GpsPosition, MeterMovementState } from '../types/case'
import { calculateDistanceMeters } from '../utils/distance'

type GpsStatus = 'idle' | 'locating' | 'ready' | 'error' | 'unsupported'

type GpsLogState = {
  chargeableDistanceMeters: number
  currentSpeedKmh: number | null
  logs: GpsLogEntry[]
  lowSpeedSeconds: number
  movementState: MeterMovementState
  speedSource: SpeedSource
  totalDistanceMeters: number
}

const GPS_INTERVAL_MS = 5000
const MAX_DISTANCE_ACCURACY_METERS = 30
const MIN_CHARGEABLE_SEGMENT_DISTANCE_METERS = 5
const MAX_DISTANCE_PER_INTERVAL_METERS = 500
const GPS_INTERVAL_SECONDS = GPS_INTERVAL_MS / 1000
const UNSUPPORTED_GPS_MESSAGE = 'この端末ではGPS取得を利用できません'

const shouldIncludeDistance = (
  previousLog: GpsLogEntry | undefined,
  currentLog: GpsLogEntry,
  currentSpeedKmh: number | null,
  lowSpeedThresholdKmh: number,
) => {
  if (!previousLog || currentSpeedKmh == null || currentSpeedKmh <= lowSpeedThresholdKmh) {
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
  const isTooShortSegment = distanceMeters < MIN_CHARGEABLE_SEGMENT_DISTANCE_METERS
  const isAbnormalMovement =
    elapsedSeconds <= GPS_INTERVAL_SECONDS &&
    distanceMeters >= MAX_DISTANCE_PER_INTERVAL_METERS

  return !isTooShortSegment && !isAbnormalMovement
}

export function useCurrentPosition(
  isActive: boolean,
  lowSpeedThresholdKmh = 10,
  isFareMeterActive = isActive,
) {
  const [position, setPosition] = useState<GpsPosition | null>(null)
  const [status, setStatus] = useState<GpsStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [gpsLogState, setGpsLogState] = useState<GpsLogState>({
    chargeableDistanceMeters: 0,
    currentSpeedKmh: null,
    logs: [],
    lowSpeedSeconds: 0,
    movementState: 'unknown',
    speedSource: 'unavailable',
    totalDistanceMeters: 0,
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
            const shouldAddDistance = isFareMeterActive && shouldIncludeDistance(
              previousLog,
              currentLog,
              speedReading.speedKmh,
              lowSpeedThresholdKmh,
            )
            const additionalDistanceMeters =
              previousLog && shouldAddDistance
                ? calculateDistanceMeters(previousLog, currentLog)
                : 0
            const chargeableDistanceMeters =
              currentState.chargeableDistanceMeters + additionalDistanceMeters
            const lowSpeedSeconds =
              isFareMeterActive && movementState === 'low-speed'
                ? currentState.lowSpeedSeconds + elapsedSeconds
                : currentState.lowSpeedSeconds

            return {
              chargeableDistanceMeters,
              currentSpeedKmh: speedReading.speedKmh,
              logs: [...currentState.logs, currentLog],
              lowSpeedSeconds,
              movementState,
              speedSource: speedReading.source,
              totalDistanceMeters:
                currentState.totalDistanceMeters + additionalDistanceMeters,
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
  }, [isActive, isFareMeterActive, isUnsupported, lowSpeedThresholdKmh])

  const derivedStatus = useMemo<GpsStatus>(() => {
    if (!isActive) {
      return 'idle'
    }

    if (isUnsupported) {
      return 'unsupported'
    }

    return status === 'idle' ? 'locating' : status
  }, [isActive, isUnsupported, status])

  return {
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
    totalDistanceKm: gpsLogState.totalDistanceMeters / 1000,
  }
}
