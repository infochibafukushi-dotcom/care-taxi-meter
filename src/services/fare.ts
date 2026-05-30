export type BasicFareSettings = {
  initialDistanceKm: number
  initialFareYen: number
  additionalDistanceKm: number
  additionalFareYen: number
}

export type TimeFareSettings = {
  unitSeconds: number
  unitFareYen: number
}

export const DEFAULT_BASIC_FARE_SETTINGS: BasicFareSettings = {
  initialDistanceKm: 1.096,
  initialFareYen: 500,
  additionalDistanceKm: 0.255,
  additionalFareYen: 100,
}

export const DEFAULT_WAITING_FARE_SETTINGS: TimeFareSettings = {
  unitSeconds: 300,
  unitFareYen: 100,
}

export const DEFAULT_ACCOMPANIMENT_FARE_SETTINGS: TimeFareSettings = {
  unitSeconds: 300,
  unitFareYen: 300,
}

export function calculateBasicFareYen(
  distanceKm: number,
  settings: BasicFareSettings = DEFAULT_BASIC_FARE_SETTINGS,
) {
  if (distanceKm <= settings.initialDistanceKm) {
    return settings.initialFareYen
  }

  const additionalDistanceKm = distanceKm - settings.initialDistanceKm
  const additionalFareCount = Math.ceil(
    additionalDistanceKm / settings.additionalDistanceKm,
  )

  return (
    settings.initialFareYen +
    additionalFareCount * settings.additionalFareYen
  )
}

export function calculateTimeFareYen(
  elapsedSeconds: number,
  settings: TimeFareSettings,
) {
  if (elapsedSeconds <= 0) {
    return 0
  }

  return Math.ceil(elapsedSeconds / settings.unitSeconds) * settings.unitFareYen
}

export function calculateWaitingFareYen(elapsedSeconds: number) {
  return calculateTimeFareYen(elapsedSeconds, DEFAULT_WAITING_FARE_SETTINGS)
}

export function calculateAccompanimentFareYen(elapsedSeconds: number) {
  return calculateTimeFareYen(
    elapsedSeconds,
    DEFAULT_ACCOMPANIMENT_FARE_SETTINGS,
  )
}

export function formatFareYen(fareYen: number) {
  return fareYen.toLocaleString('ja-JP')
}
