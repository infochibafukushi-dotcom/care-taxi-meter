import { useEffect, useRef, useState } from 'react'
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
  const movementSecondsRef = useRef(0)
  const waitingStartPositionRef = useRef<{
    latitude: number
    longitude: number
  } | null>(null)

  useEffect(() => {
    alertStateRef.current = alertState
  }, [alertState])

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

  const openAlert = () => {
    resetDetection()
    setAlertState((current) => ({
      ...current,
      isOpen: true,
    }))
  }

  useEffect(() => {
    if (!isEnabled) {
      resetDetection()
      setAlertState({ isOpen: false, snoozedUntil: null })
      return undefined
    }

    waitingStartPositionRef.current = gpsPosition
      ? { latitude: gpsPosition.latitude, longitude: gpsPosition.longitude }
      : null

    const intervalId = window.setInterval(() => {
      const currentAlertState = alertStateRef.current
      if (currentAlertState.snoozedUntil && Date.now() < currentAlertState.snoozedUntil) {
        return
      }

      if (currentAlertState.isOpen) {
        return
      }

      let isMoving = false

      if (isUsingObdTelemetry) {
        isMoving = currentSpeedKmh != null && currentSpeedKmh >= OBD_SPEED_THRESHOLD_KMH
        if (isMoving) {
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
        gpsPosition != null && gpsPosition.accuracy <= MAX_DISTANCE_ACCURACY_METERS
      const gpsSpeedMoving =
        hasReliableGps &&
        currentSpeedKmh != null &&
        currentSpeedKmh >= GPS_SPEED_THRESHOLD_KMH

      let gpsDistanceMoving = false
      if (hasReliableGps && waitingStartPositionRef.current) {
        const movedMeters = calculateDistanceMeters(
          waitingStartPositionRef.current,
          {
            latitude: gpsPosition.latitude,
            longitude: gpsPosition.longitude,
          },
        )
        gpsDistanceMoving = movedMeters >= GPS_DISTANCE_THRESHOLD_METERS
      }

      isMoving = gpsSpeedMoving || gpsDistanceMoving
      if (isMoving) {
        movementSecondsRef.current += 1
        if (movementSecondsRef.current >= GPS_DURATION_SECONDS) {
          openAlert()
        }
      } else {
        movementSecondsRef.current = 0
        if (hasReliableGps && gpsPosition) {
          waitingStartPositionRef.current = {
            latitude: gpsPosition.latitude,
            longitude: gpsPosition.longitude,
          }
        }
      }
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [currentSpeedKmh, gpsPosition, isEnabled, isUsingObdTelemetry])

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
