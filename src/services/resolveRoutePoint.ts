import type { RoutePoint, RoutePointSource } from '../types/preFixedMeterSession'
import { createRoutePoint } from './preFixedMeterSession'
import { ensureGoogleMapsApiLoaded } from '../utils/googleMapsLoader'
import {
  formatRoutePointDisplayLines,
  GPS_LOCATION_LABEL,
  isCoordinatePairText,
} from '../utils/routePointDisplay'

export { formatRoutePointDisplayLines }
export const LOCATION_RESOLVE_ERROR_MESSAGE =
  '施設または住所を特定できませんでした。検索候補から選択してください。'
export const PLACE_SELECTION_REQUIRED_MESSAGE =
  '検索候補から施設または住所を選択してください。'

type GoogleGeocoderResult = {
  formatted_address?: string
  place_id?: string
  geometry?: {
    location?: {
      lat: () => number
      lng: () => number
    }
  }
  address_components?: Array<{
    long_name?: string
    short_name?: string
    types?: string[]
  }>
  types?: string[]
  name?: string
}

type GoogleGeocoder = {
  geocode: (
    request: {
      address?: string
      location?: { lat: number; lng: number }
      language?: string
      region?: string
    },
    callback?: (results: GoogleGeocoderResult[] | null, status: string) => void,
  ) => Promise<{ results?: GoogleGeocoderResult[] }> | void
}

type GooglePlacesService = {
  findPlaceFromQuery: (
    request: {
      query: string
      fields: string[]
      language?: string
    },
    callback: (
      results: Array<{
        place_id?: string
        name?: string
        formatted_address?: string
        geometry?: { location?: { lat: () => number; lng: () => number } }
      }> | null,
      status: string,
    ) => void,
  ) => void
  textSearch: (
    request: { query: string; language?: string; region?: string },
    callback: (
      results: Array<{
        place_id?: string
        name?: string
        formatted_address?: string
        geometry?: { location?: { lat: () => number; lng: () => number } }
      }> | null,
      status: string,
    ) => void,
  ) => void
}

const getApiKey = () => import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''

export const isRoutePointResolved = (point: RoutePoint | null | undefined): boolean =>
  getRoutePointUnresolvedReason(point) === null

/** resolved でない理由（開発診断・テスト用）。秘密値は含まない */
export const getRoutePointUnresolvedReason = (
  point: RoutePoint | null | undefined,
): string | null => {
  if (!point) {
    return 'point-missing'
  }
  if (typeof point.lat !== 'number' || !Number.isFinite(point.lat)) {
    return 'lat-invalid'
  }
  if (typeof point.lng !== 'number' || !Number.isFinite(point.lng)) {
    return 'lng-invalid'
  }

  const address = (point.formattedAddress || point.address).trim()
  if (!address) {
    return 'address-empty'
  }
  if (isCoordinatePairText(address)) {
    return 'address-is-coordinates'
  }

  // Places 候補由来のみ placeId 必須。GPS / ジオコード確定は placeId 不要
  if (
    (point.source === 'facility_search' || point.source === 'facility_block') &&
    !point.placeId?.trim()
  ) {
    return 'placeId-required-for-places'
  }

  return null
}

export const cloneRoutePoint = (point: RoutePoint): RoutePoint =>
  createRoutePoint({
    address: point.address,
    label: point.label,
    facilityName: point.facilityName,
    lat: point.lat,
    lng: point.lng,
    placeId: point.placeId,
    formattedAddress: point.formattedAddress,
    source: point.source,
  })

export const GPS_ADDRESS_FETCH_ERROR_MESSAGE =
  '現在地の住所を取得できませんでした。'

export const GPS_POSITION_FETCH_ERROR_MESSAGE = '現在地の取得に失敗しました。'

const readLatLng = (location: { lat: () => number; lng: () => number } | undefined) => {
  if (!location) {
    return null
  }
  const lat = location.lat()
  const lng = location.lng()
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }
  return { lat, lng }
}

/** Places / Geocoder 共通ローダー経由の逆ジオコーディング（施設解決など用。GPSは reverseGeocode.ts を使用） */
export async function reverseGeocodeLatLng(
  latitude: number,
  longitude: number,
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('VITE_GOOGLE_MAPS_API_KEY is not set.')
  }

  await ensureGoogleMapsApiLoaded(apiKey)
  const maps = (
    window as Window & {
      google?: {
        maps?: {
          Geocoder?: new () => GoogleGeocoder
          importLibrary?: (
            name: string,
          ) => Promise<{ Geocoder?: new () => GoogleGeocoder }>
        }
      }
    }
  ).google?.maps

  const geocodingLibrary = await maps?.importLibrary?.('geocoding')
  const Geocoder = geocodingLibrary?.Geocoder || maps?.Geocoder
  if (!Geocoder) {
    throw new Error('Google Maps Geocoder is unavailable.')
  }

  const geocoder = new Geocoder()
  const request = {
    location: { lat: latitude, lng: longitude },
    language: 'ja',
    region: 'jp',
  }

  const { results, status } = await new Promise<{
    results: GoogleGeocoderResult[]
    status: string
  }>((resolve, reject) => {
    let settled = false
    const settleOk = (nextResults: GoogleGeocoderResult[] | null | undefined, nextStatus: string) => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        results: Array.isArray(nextResults) ? nextResults : [],
        status: nextStatus,
      })
    }
    const settleError = (nextStatus: string) => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error(`Geocoder failed: ${nextStatus}`))
    }

    const extractStatus = (error: unknown): string => {
      const message = error instanceof Error ? error.message : String(error)
      const fromMessage = message.match(
        /REQUEST_DENIED|ZERO_RESULTS|INVALID_REQUEST|OVER_QUERY_LIMIT|UNKNOWN_ERROR/i,
      )?.[0]
      if (fromMessage) {
        return fromMessage.toUpperCase()
      }
      return 'ERROR'
    }

    try {
      geocoder.geocode(request, (response, callbackStatus) => {
        const normalized = String(callbackStatus || 'ERROR').toUpperCase()
        if (normalized === 'OK' || normalized === 'ZERO_RESULTS') {
          settleOk(response, normalized)
          return
        }
        settleError(normalized)
      })
    } catch (error) {
      try {
        const geocodePromise = geocoder.geocode(request)
        if (geocodePromise && typeof (geocodePromise as Promise<unknown>).then === 'function') {
          void (geocodePromise as Promise<{ results?: GoogleGeocoderResult[] }>)
            .then((response) => {
              const nextResults = response?.results ?? []
              settleOk(nextResults, nextResults.length > 0 ? 'OK' : 'ZERO_RESULTS')
            })
            .catch((promiseError: unknown) => {
              settleError(extractStatus(promiseError))
            })
          return
        }
      } catch (promiseCallError) {
        settleError(extractStatus(promiseCallError))
        return
      }
      settleError(extractStatus(error))
    }
  })

  if (status !== 'OK' || results.length === 0) {
    return ''
  }

  const raw = results[0]?.formatted_address?.trim() || ''
  return raw
    .replace(/^日本[、,\s]*/, '')
    .replace(/〒\s*\d{3}-?\d{4}\s*/, '')
    .trim()
}

export const buildGpsRoutePoint = ({
  latitude,
  longitude,
  address,
}: {
  latitude: number
  longitude: number
  address?: string
}): RoutePoint => {
  const safeAddress = address?.trim() && !isCoordinatePairText(address) ? address.trim() : ''
  return createRoutePoint({
    address: safeAddress,
    formattedAddress: safeAddress || undefined,
    label: GPS_LOCATION_LABEL,
    facilityName: safeAddress ? GPS_LOCATION_LABEL : undefined,
    lat: latitude,
    lng: longitude,
    source: 'gps',
  })
}

const pickDisplayName = (query: string, result: GoogleGeocoderResult) => {
  const premise = result.address_components?.find((component) =>
    component.types?.includes('premise') || component.types?.includes('establishment'),
  )?.long_name
  return (result.name || premise || query).trim()
}

const toResolvedPoint = ({
  query,
  formattedAddress,
  placeId,
  lat,
  lng,
  source,
  displayName,
}: {
  query: string
  formattedAddress: string
  placeId?: string
  lat: number
  lng: number
  source: RoutePointSource
  displayName?: string
}): RoutePoint => {
  const label = (displayName || query).trim()
  const address = formattedAddress.trim() || label
  return createRoutePoint({
    address,
    label,
    facilityName: label !== address ? label : undefined,
    formattedAddress: address,
    placeId,
    lat,
    lng,
    source,
  })
}

const geocodeAddressQuery = async (query: string): Promise<RoutePoint | null> => {
  const apiKey = getApiKey()
  if (!apiKey) {
    return null
  }

  await ensureGoogleMapsApiLoaded(apiKey)
  const maps = (
    window as Window & {
      google?: {
        maps?: {
          Geocoder?: new () => GoogleGeocoder
          importLibrary?: (name: string) => Promise<{ Geocoder?: new () => GoogleGeocoder }>
        }
      }
    }
  ).google?.maps

  const geocodingLibrary = await maps?.importLibrary?.('geocoding')
  const Geocoder = geocodingLibrary?.Geocoder || maps?.Geocoder
  if (!Geocoder) {
    return null
  }

  const geocoder = new Geocoder()
  const results = await new Promise<GoogleGeocoderResult[] | null>((resolve) => {
    const maybePromise = geocoder.geocode(
      { address: query, language: 'ja', region: 'jp' },
      (response, status) => {
        if (status === 'OK' && response?.length) {
          resolve(response)
          return
        }
        resolve(null)
      },
    )

    if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
      void (maybePromise as Promise<{ results?: GoogleGeocoderResult[] }>)
        .then((response) => {
          resolve(response.results?.length ? response.results : null)
        })
        .catch(() => resolve(null))
    }
  })

  const best = results?.[0]
  const latLng = readLatLng(best?.geometry?.location)
  const formattedAddress = best?.formatted_address?.trim()
  if (!best || !latLng || !formattedAddress) {
    return null
  }

  return toResolvedPoint({
    query,
    formattedAddress,
    placeId: best.place_id,
    lat: latLng.lat,
    lng: latLng.lng,
    source: 'facility_search',
    displayName: pickDisplayName(query, best),
  })
}

const placesTextSearch = async (query: string): Promise<RoutePoint | null> => {
  const apiKey = getApiKey()
  if (!apiKey) {
    return null
  }

  await ensureGoogleMapsApiLoaded(apiKey)
  const maps = (
    window as Window & {
      google?: {
        maps?: {
          places?: {
            PlacesService?: new (attribution: HTMLElement) => GooglePlacesService
            PlacesServiceStatus?: { OK: string }
          }
          importLibrary?: (name: string) => Promise<{
            PlacesService?: new (attribution: HTMLElement) => GooglePlacesService
            PlacesServiceStatus?: { OK: string }
          }>
        }
      }
    }
  ).google?.maps

  const placesLibrary = await maps?.importLibrary?.('places')
  const PlacesService = placesLibrary?.PlacesService || maps?.places?.PlacesService
  const okStatus = placesLibrary?.PlacesServiceStatus?.OK || maps?.places?.PlacesServiceStatus?.OK || 'OK'
  if (!PlacesService) {
    return null
  }

  const attribution = document.createElement('div')
  const service = new PlacesService(attribution)

  const results = await new Promise<
    Array<{
      place_id?: string
      name?: string
      formatted_address?: string
      geometry?: { location?: { lat: () => number; lng: () => number } }
    }> | null
  >((resolve) => {
    service.textSearch({ query, language: 'ja', region: 'jp' }, (response, status) => {
      if (status === okStatus && response?.length) {
        resolve(response)
        return
      }
      resolve(null)
    })
  })

  if (!results || results.length !== 1) {
    // 一意に確定できない場合は失敗扱い（候補選択 UI は別途）
    if (!results?.length) {
      return null
    }
    // 先頭がクエリと十分一致する場合のみ採用
    const normalizedQuery = query.replace(/\s+/g, '')
    const exact = results.find((item) => {
      const name = (item.name || '').replace(/\s+/g, '')
      const address = (item.formatted_address || '').replace(/\s+/g, '')
      return name === normalizedQuery || address.includes(normalizedQuery) || name.includes(normalizedQuery)
    })
    if (!exact) {
      return null
    }
    const latLng = readLatLng(exact.geometry?.location)
    const formattedAddress = exact.formatted_address?.trim()
    if (!latLng || !formattedAddress) {
      return null
    }
    return toResolvedPoint({
      query,
      formattedAddress,
      placeId: exact.place_id,
      lat: latLng.lat,
      lng: latLng.lng,
      source: 'facility_search',
      displayName: exact.name || query,
    })
  }

  const only = results[0]
  const latLng = readLatLng(only.geometry?.location)
  const formattedAddress = only.formatted_address?.trim()
  if (!latLng || !formattedAddress) {
    return null
  }

  return toResolvedPoint({
    query,
    formattedAddress,
    placeId: only.place_id,
    lat: latLng.lat,
    lng: latLng.lng,
    source: 'facility_search',
    displayName: only.name || query,
  })
}

/** 施設名・住所文字列を placeId / 正式住所 / 座標へ確定する。 */
export async function resolveRoutePointQuery(
  query: string,
  options?: { preferredSource?: RoutePointSource },
): Promise<RoutePoint> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error(LOCATION_RESOLVE_ERROR_MESSAGE)
  }

  const fromPlaces = await placesTextSearch(trimmed)
  if (fromPlaces) {
    return options?.preferredSource
      ? { ...fromPlaces, source: options.preferredSource }
      : fromPlaces
  }

  const fromGeocode = await geocodeAddressQuery(trimmed)
  if (fromGeocode) {
    return options?.preferredSource
      ? { ...fromGeocode, source: options.preferredSource }
      : fromGeocode
  }

  throw new Error(LOCATION_RESOLVE_ERROR_MESSAGE)
}

/** 未確定の RoutePoint を解決する。既に座標がある場合はそのまま返す。 */
export async function ensureRoutePointResolved(point: RoutePoint): Promise<RoutePoint> {
  if (isRoutePointResolved(point)) {
    const address = (point.formattedAddress || point.address).trim()
    return {
      ...point,
      address,
      formattedAddress: point.formattedAddress?.trim() || address,
    }
  }

  const query = point.address.trim() || point.label.trim() || point.facilityName?.trim() || ''
  if (!query || isCoordinatePairText(query)) {
    throw new Error(LOCATION_RESOLVE_ERROR_MESSAGE)
  }

  const resolved = await resolveRoutePointQuery(query, {
    preferredSource: point.source === 'manual' ? 'facility_search' : point.source,
  })

  // 入力時の施設名表示を残す
  const originalLabel = point.facilityName?.trim() || point.label.trim()
  if (originalLabel && !isCoordinatePairText(originalLabel) && originalLabel !== resolved.address) {
    return {
      ...resolved,
      label: originalLabel,
      facilityName: originalLabel,
    }
  }

  return resolved
}

export async function ensureRoutePointsResolved(
  points: RoutePoint[],
): Promise<{ resolved: RoutePoint[]; failedIndex: number | null }> {
  const resolved: RoutePoint[] = []
  for (let index = 0; index < points.length; index += 1) {
    try {
      resolved.push(await ensureRoutePointResolved(points[index]))
    } catch {
      return { resolved, failedIndex: index }
    }
  }
  return { resolved, failedIndex: null }
}
