import { useCallback, useEffect, useRef, useState } from 'react'
import { calculateDistanceMeters } from '../utils/distance'
import { MAX_DISTANCE_ACCURACY_METERS } from './useCurrentPosition'

const OBD_SPEED_THRESHOLD_KMH = 5
const GPS_SPEED_THRESHOLD_KMH = 5
const GPS_DISTANCE_THRESHOLD_METERS = 30
const OBD_DURATION_SECONDS = 5
const GPS_DURATION_SECONDS = 10
const ALERT_SNOOZE_MS = 15 * 60 * 1000

export type WaitingMovementAlertState = {
  isOpen: boolean
  snoozedUntil: number | null
}

type UseWaitingMovementAlertOptions = {
  currentSpeedKmh: number | null
  gpsPosition: {
    accuracy: number
    latitude: number
    longitude: number
    updatedAt: number
  } | null
  isEnabled: boolean
  isUsingObdTelemetry: boolean
}

export function useWaitingMovementAlert({
  currentSpeedKmh,
  gpsPosition,
  isEnabled,
  isUsingObdTelemetry,
}: UseWaitingMovementAlertOptions) {
  const [alertState, setAlertState] = useState<WaitingMovementAlertState>({
    isOpen: false,
    snoozedUntil: null,
  })
  const alertStateRef = useRef(alertState)
  const currentSpeedKmhRef = useRef(currentSpeedKmh)
  const gpsPositionRef = useRef(gpsPosition)
  const movementSecondsRef = useRef(0)
  const waitingStartPositionRef = useRef<{
    latitude: number
    longitude: number
  } | null>(null)

  useEffect(() => {
    alertStateRef.current = alertState
  }, [alertState])

  useEffect(() => {
    currentSpeedKmhRef.current = currentSpeedKmh
  }, [currentSpeedKmh])

  useEffect(() => {
    gpsPositionRef.current = gpsPosition
  }, [gpsPosition])

  const resetDetection = () => {
    movementSecondsRef.current = 0
    waitingStartPositionRef.current = null
  }

  const snoozeAlert = () => {
    resetDetection()
    setAlertState({
      isOpen: false,
      snoozedUntil: Date.now() + ALERT_SNOOZE_MS,
    })
  }

  const dismissAlert = () => {
    resetDetection()
    setAlertState((current) => ({
      ...current,
      isOpen: false,
    }))
  }

  const openAlert = useCallback(() => {
    resetDetection()
    setAlertState((current) => ({
      ...current,
      isOpen: true,
    }))
  }, [])

  useEffect(() => {
    if (!isEnabled) {
      resetDetection()
      setAlertState({ isOpen: false, snoozedUntil: null })
      return undefined
    }

    const initialPosition = gpsPositionRef.current
    waitingStartPositionRef.current = initialPosition
      ? { latitude: initialPosition.latitude, longitude: initialPosition.longitude }
      : null

    const intervalId = window.setInterval(() => {
      const currentAlertState = alertStateRef.current
      if (currentAlertState.snoozedUntil && Date.now() < currentAlertState.snoozedUntil) {
        return
      }

      if (currentAlertState.isOpen) {
        return
      }

      const speedKmh = currentSpeedKmhRef.current
      const gpsPositionSnapshot = gpsPositionRef.current

      if (isUsingObdTelemetry) {
        const isObdMoving = speedKmh != null && speedKmh >= OBD_SPEED_THRESHOLD_KMH
        if (isObdMoving) {
          movementSecondsRef.current += 1
          if (movementSecondsRef.current >= OBD_DURATION_SECONDS) {
            openAlert()
          }
        } else {
          movementSecondsRef.current = 0
        }
        return
      }

      const hasReliableGps =
        gpsPositionSnapshot != null &&
        gpsPositionSnapshot.accuracy <= MAX_DISTANCE_ACCURACY_METERS
      const gpsSpeedMoving =
        hasReliableGps &&
        speedKmh != null &&
        speedKmh >= GPS_SPEED_THRESHOLD_KMH

      let gpsDistanceMoving = false
      if (hasReliableGps && waitingStartPositionRef.current) {
        const movedMeters = calculateDistanceMeters(
          waitingStartPositionRef.current,
          {
            latitude: gpsPositionSnapshot.latitude,
            longitude: gpsPositionSnapshot.longitude,
          },
        )
        gpsDistanceMoving = movedMeters >= GPS_DISTANCE_THRESHOLD_METERS
      }

      const isGpsMoving = gpsSpeedMoving || gpsDistanceMoving
      if (isGpsMoving) {
        movementSecondsRef.current += 1
        if (movementSecondsRef.current >= GPS_DURATION_SECONDS) {
          openAlert()
        }
      } else {
        movementSecondsRef.current = 0
        if (hasReliableGps && gpsPositionSnapshot) {
          waitingStartPositionRef.current = {
            latitude: gpsPositionSnapshot.latitude,
            longitude: gpsPositionSnapshot.longitude,
          }
        }
      }
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [isEnabled, isUsingObdTelemetry, openAlert])

  return {
    alertState,
    dismissAlert,
    resetAlertState: () => {
      resetDetection()
      setAlertState({ isOpen: false, snoozedUntil: null })
    },
    snoozeAlert,
  }
}
