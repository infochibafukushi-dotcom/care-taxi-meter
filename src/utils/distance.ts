const EARTH_RADIUS_METERS = 6_371_000
const DEGREES_TO_RADIANS = Math.PI / 180

export type Coordinates = {
  latitude: number
  longitude: number
}

export function calculateDistanceMeters(from: Coordinates, to: Coordinates) {
  const fromLatitude = from.latitude * DEGREES_TO_RADIANS
  const toLatitude = to.latitude * DEGREES_TO_RADIANS
  const latitudeDelta = (to.latitude - from.latitude) * DEGREES_TO_RADIANS
  const longitudeDelta = (to.longitude - from.longitude) * DEGREES_TO_RADIANS

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  )
}
