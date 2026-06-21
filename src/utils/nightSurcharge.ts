import { calculateBasicFareYen, type BasicFareSettings } from '../services/fare'
import { calculateTimeMeterFare } from '../services/timeMeterFare'
import type { TimeMeterSettings } from '../services/meterSettings'

export type MidnightEarlyMorningSettings = {
  enabled: boolean
  startTime: string
  endTime: string
  surchargeRate: number
}

export const defaultMidnightEarlyMorningSettings: MidnightEarlyMorningSettings = {
  enabled: true,
  startTime: '22:00',
  endTime: '05:00',
  surchargeRate: 20,
}

const japanTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Tokyo',
})

function parseTimeToMinutes(timeValue: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim())
  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return hour * 60 + minute
}

export function getJapanTimeMinutes(date: Date): number {
  const parts = Object.fromEntries(
    japanTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  const hour = Number(parts.hour ?? 0)
  const minute = Number(parts.minute ?? 0)
  return hour * 60 + minute
}

export function isInMidnightPeriod(
  date: Date,
  startTime: string,
  endTime: string,
): boolean {
  const startMinutes = parseTimeToMinutes(startTime)
  const endMinutes = parseTimeToMinutes(endTime)

  if (startMinutes == null || endMinutes == null) {
    return false
  }

  const currentMinutes = getJapanTimeMinutes(date)

  if (startMinutes === endMinutes) {
    return false
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes
}

export function calculateNightBasicFarePortionYen(
  totalDistanceKm: number,
  nightDistanceKm: number,
  settings: BasicFareSettings,
): number {
  const safeNightDistanceKm = Math.max(Math.min(nightDistanceKm, totalDistanceKm), 0)

  if (safeNightDistanceKm <= 0 || totalDistanceKm <= 0) {
    return 0
  }

  const totalFareYen = calculateBasicFareYen(totalDistanceKm, settings)
  const dayDistanceKm = Math.max(totalDistanceKm - safeNightDistanceKm, 0)
  const dayFareYen = calculateBasicFareYen(dayDistanceKm, settings)

  return Math.max(totalFareYen - dayFareYen, 0)
}

export function calculateNightTimeFarePortionYen(
  totalSeconds: number,
  nightSeconds: number,
  timeMeterSettings: TimeMeterSettings,
): number {
  const safeNightSeconds = Math.max(Math.min(Math.floor(nightSeconds), Math.floor(totalSeconds)), 0)

  if (safeNightSeconds <= 0 || totalSeconds <= 0) {
    return 0
  }

  const totalFare = calculateTimeMeterFare({
    discountSettings: timeMeterSettings.discount,
    elapsedSeconds: totalSeconds,
    legalSettings: timeMeterSettings.legal,
  })
  const daySeconds = Math.max(totalSeconds - safeNightSeconds, 0)
  const dayFare = calculateTimeMeterFare({
    discountSettings: timeMeterSettings.discount,
    elapsedSeconds: daySeconds,
    legalSettings: timeMeterSettings.legal,
  })

  return Math.max(totalFare.actualTimeFare - dayFare.actualTimeFare, 0)
}

export function calculateNightSurchargeYen(
  nightBasicPortionYen: number,
  surchargeRate: number,
): number {
  if (nightBasicPortionYen <= 0 || surchargeRate <= 0) {
    return 0
  }

  return Math.round((nightBasicPortionYen * surchargeRate) / 100)
}

export function resolveMidnightSurchargeYen({
  basicFareSettings,
  distanceKm,
  drivingSeconds,
  midnightSettings,
  meterMode,
  nightChargeableDistanceKm,
  nightDrivingSeconds,
  timeMeterSettings,
}: {
  basicFareSettings: BasicFareSettings
  distanceKm: number
  drivingSeconds: number
  midnightSettings: MidnightEarlyMorningSettings | null | undefined
  meterMode: 'gps' | 'time' | 'obd'
  nightChargeableDistanceKm: number
  nightDrivingSeconds: number
  timeMeterSettings?: TimeMeterSettings
}): number {
  if (!midnightSettings?.enabled) {
    return 0
  }

  const nightPortionYen =
    meterMode === 'time' && timeMeterSettings
      ? calculateNightTimeFarePortionYen(
          drivingSeconds,
          nightDrivingSeconds,
          timeMeterSettings,
        )
      : calculateNightBasicFarePortionYen(
          distanceKm,
          nightChargeableDistanceKm,
          basicFareSettings,
        )

  return calculateNightSurchargeYen(nightPortionYen, midnightSettings.surchargeRate)
}
