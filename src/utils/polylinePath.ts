import { decodePolyline, type DecodedLatLng } from './decodePolyline'

export type PolylineLatLng = DecodedLatLng

const encodeSigned = (value: number): string => {
  let number = value < 0 ? ~(value << 1) : value << 1
  let result = ''
  while (number >= 0x20) {
    result += String.fromCharCode((0x20 | (number & 0x1f)) + 63)
    number >>= 5
  }
  result += String.fromCharCode(number + 63)
  return result
}

/** Google encoded polyline 形式へエンコードする（lp-site test encode と同ロジック）。 */
export const encodePolyline = (points: PolylineLatLng[]): string => {
  let lastLat = 0
  let lastLng = 0
  let result = ''
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5)
    const lng = Math.round(point.lng * 1e5)
    result += encodeSigned(lat - lastLat)
    result += encodeSigned(lng - lastLng)
    lastLat = lat
    lastLng = lng
  }
  return result
}

/**
 * 複数 leg の座標列を連結する（接点の重複1点を除去）。
 * lp-site shared/estimate-route-map-display.js concatLegPaths と同等。
 */
export const concatLegPaths = (paths: PolylineLatLng[][]): PolylineLatLng[] => {
  if (!Array.isArray(paths) || paths.length === 0) {
    return []
  }

  const combined = paths[0].slice()
  for (let index = 1; index < paths.length; index += 1) {
    const nextPath = paths[index]
    if (!Array.isArray(nextPath) || nextPath.length < 2) {
      continue
    }
    const startIndex =
      combined.length > 0 &&
      combined[combined.length - 1].lat === nextPath[0].lat &&
      combined[combined.length - 1].lng === nextPath[0].lng
        ? 1
        : 0
    combined.push(...nextPath.slice(startIndex))
  }

  return combined.length >= 2 ? combined : []
}

export type RouteLegPolyline = {
  encodedPolyline?: string
}

/** routeLegs があれば結合、なければ overview encoded を使う（lp-site pathFromRoute）。 */
export const pathFromRouteLegs = (
  routeLegs: RouteLegPolyline[] | undefined,
  encodedPolyline?: string,
): PolylineLatLng[] => {
  const legs = Array.isArray(routeLegs) ? routeLegs : []
  if (legs.length >= 2) {
    const legPaths = legs
      .map((leg) => decodePolyline(String(leg.encodedPolyline || '').trim()))
      .filter((path) => path.length >= 2)
    const combined = concatLegPaths(legPaths)
    if (combined.length >= 2) {
      return combined
    }
  }
  if (legs.length === 1) {
    const single = decodePolyline(String(legs[0]?.encodedPolyline || '').trim())
    if (single.length >= 2) {
      return single
    }
  }
  return decodePolyline(String(encodedPolyline || '').trim())
}

export const buildCombinedEncodedPolyline = (
  routeLegs: RouteLegPolyline[] | undefined,
  fallbackEncoded?: string,
): string | undefined => {
  const path = pathFromRouteLegs(routeLegs, fallbackEncoded)
  if (path.length < 2) {
    const fallback = String(fallbackEncoded || '').trim()
    return fallback || undefined
  }
  return encodePolyline(path)
}
