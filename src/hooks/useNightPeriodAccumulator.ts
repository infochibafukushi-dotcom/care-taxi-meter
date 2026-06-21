import { useEffect, useRef, useState } from 'react'
import {
  isInMidnightPeriod,
  type MidnightEarlyMorningSettings,
} from '../utils/nightSurcharge'

type NightPeriodMetrics = {
  isNightPeriod: boolean
  nightChargeableDistanceKm: number
  nightDrivingSeconds: number
}

const emptyNightPeriodMetrics = (): NightPeriodMetrics => ({
  isNightPeriod: false,
  nightChargeableDistanceKm: 0,
  nightDrivingSeconds: 0,
})

export function useNightPeriodAccumulator({
  chargeableDistanceKm,
  drivingSeconds,
  isActive,
  isDrivingActive,
  midnightSettings,
  resetKey = 0,
}: {
  chargeableDistanceKm: number
  drivingSeconds: number
  isActive: boolean
  isDrivingActive: boolean
  midnightSettings: MidnightEarlyMorningSettings | null | undefined
  resetKey?: number
}) {
  const [metrics, setMetrics] = useState<NightPeriodMetrics>(emptyNightPeriodMetrics)
  const prevDistanceRef = useRef(0)
  const prevDrivingSecondsRef = useRef(0)
  const nightDistanceRef = useRef(0)
  const nightDrivingSecondsRef = useRef(0)

  useEffect(() => {
    prevDistanceRef.current = 0
    prevDrivingSecondsRef.current = 0
    nightDistanceRef.current = 0
    nightDrivingSecondsRef.current = 0
    setMetrics(emptyNightPeriodMetrics())
  }, [resetKey])

  useEffect(() => {
    if (!isActive || !midnightSettings?.enabled) {
      setMetrics((current) => ({
        ...current,
        isNightPeriod: midnightSettings?.enabled
          ? isInMidnightPeriod(
              new Date(),
              midnightSettings.startTime,
              midnightSettings.endTime,
            )
          : false,
      }))
      return
    }

    const now = new Date()
    const isNightPeriod = isInMidnightPeriod(
      now,
      midnightSettings.startTime,
      midnightSettings.endTime,
    )

    const distanceDelta = Math.max(chargeableDistanceKm - prevDistanceRef.current, 0)
    if (distanceDelta > 0 && isNightPeriod) {
      nightDistanceRef.current += distanceDelta
    }
    prevDistanceRef.current = chargeableDistanceKm

    if (isDrivingActive) {
      const drivingDelta = Math.max(drivingSeconds - prevDrivingSecondsRef.current, 0)
      if (drivingDelta > 0 && isNightPeriod) {
        nightDrivingSecondsRef.current += drivingDelta
      }
      prevDrivingSecondsRef.current = drivingSeconds
    }

    setMetrics({
      isNightPeriod,
      nightChargeableDistanceKm: nightDistanceRef.current,
      nightDrivingSeconds: nightDrivingSecondsRef.current,
    })
  }, [
    chargeableDistanceKm,
    drivingSeconds,
    isActive,
    isDrivingActive,
    midnightSettings,
  ])

  useEffect(() => {
    if (!isActive || !midnightSettings?.enabled) {
      return
    }

    const intervalId = window.setInterval(() => {
      const isNightPeriod = isInMidnightPeriod(
        new Date(),
        midnightSettings.startTime,
        midnightSettings.endTime,
      )

      setMetrics((current) =>
        current.isNightPeriod === isNightPeriod
          ? current
          : {
              ...current,
              isNightPeriod,
            },
      )
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [isActive, midnightSettings])

  return metrics
}
