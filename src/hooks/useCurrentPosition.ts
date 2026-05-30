import { useEffect, useMemo, useState } from 'react'
import type { GpsPosition } from '../types/case'

type GpsStatus = 'idle' | 'locating' | 'ready' | 'error' | 'unsupported'

const GPS_INTERVAL_MS = 5000
const UNSUPPORTED_GPS_MESSAGE = 'この端末ではGPS取得を利用できません'

export function useCurrentPosition(isActive: boolean) {
  const [position, setPosition] = useState<GpsPosition | null>(null)
  const [status, setStatus] = useState<GpsStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
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

          setPosition({
            latitude: geolocationPosition.coords.latitude,
            longitude: geolocationPosition.coords.longitude,
            accuracy: geolocationPosition.coords.accuracy,
            updatedAt: geolocationPosition.timestamp,
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
    isActive,
    position,
    status: derivedStatus,
  }
}
