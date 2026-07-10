export type LatLngLiteral = {
  lat: number
  lng: number
}

/**
 * Google encoded polyline をデコードする（geometry ライブラリ非依存のフォールバック）。
 * かんたん見積もり / PreFixedRouteMapPanel 共通。
 */
export function decodeEncodedPolyline(encoded: string): LatLngLiteral[] {
  const points: LatLngLiteral[] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1
    lat += deltaLat

    shift = 0
    result = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1
    lng += deltaLng

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }

  return points
}

export function decodePolylinePath(
  encoded: string,
  googleDecodePath?: (value: string) => LatLngLiteral[],
): LatLngLiteral[] {
  const trimmed = encoded.trim()
  if (!trimmed) {
    return []
  }

  if (googleDecodePath) {
    try {
      const decoded = googleDecodePath(trimmed)
      if (decoded.length > 0) {
        return decoded.map((point) => ({ lat: point.lat, lng: point.lng }))
      }
    } catch {
      // fall through to manual decode
    }
  }

  return decodeEncodedPolyline(trimmed)
}
