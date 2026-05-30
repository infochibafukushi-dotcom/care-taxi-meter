export type BasicFareSettings = {
  initialDistanceKm: number
  initialFareYen: number
  additionalDistanceKm: number
  additionalFareYen: number
}

export const DEFAULT_BASIC_FARE_SETTINGS: BasicFareSettings = {
  initialDistanceKm: 1.096,
  initialFareYen: 500,
  additionalDistanceKm: 0.255,
  additionalFareYen: 100,
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

export function formatFareYen(fareYen: number) {
  return fareYen.toLocaleString('ja-JP')
}
