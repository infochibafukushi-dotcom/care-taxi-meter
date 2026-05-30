import { useEffect, useMemo, useState } from 'react'
import type { GpsLogEntry, GpsPosition } from '../types/case'
import { calculateDistanceMeters } from '../utils/distance'

type GpsStatus = 'idle' | 'locating' | 'ready' | 'error' | 'unsupported'

type GpsLogState = {
  logs: GpsLogEntry[]
  totalDistanceMeters: number
}

const GPS_INTERVAL_MS = 5000
const MAX_DISTANCE_ACCURACY_METERS = 50
const MAX_DISTANCE_PER_INTERVAL_METERS = 500
const GPS_INTERVAL_SECONDS = GPS_INTERVAL_MS / 1000
const UNSUPPORTED_GPS_MESSAGE = 'この端末ではGPS取得を利用できません'

const shouldIncludeDistance = (
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
  const isAbnormalMovement =
    elapsedSeconds <= GPS_INTERVAL_SECONDS &&
    distanceMeters >= MAX_DISTANCE_PER_INTERVAL_METERS

  return !isAbnormalMovement
}

export function useCurrentPosition(isActive: boolean) {
  const [position, setPosition] = useState<GpsPosition | null>(null)
  const [status, setStatus] = useState<GpsStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [gpsLogState, setGpsLogState] = useState<GpsLogState>({
    logs: [],
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
            const additionalDistanceMeters =
              previousLog && shouldIncludeDistance(previousLog, currentLog)
                ? calculateDistanceMeters(previousLog, currentLog)
                : 0

            return {
              logs: [...currentState.logs, currentLog],
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
  }, [isActive, isUnsupported])

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
    errorMessage: isActive && isUnsupported
      ? UNSUPPORTED_GPS_MESSAGE
      : errorMessage,
    gpsLogCount: gpsLogState.logs.length,
    isActive,
    position,
    status: derivedStatus,
    totalDistanceKm: gpsLogState.totalDistanceMeters / 1000,
  }
}
