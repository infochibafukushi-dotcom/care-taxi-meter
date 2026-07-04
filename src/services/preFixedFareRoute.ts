import type { ReservationTripContext } from './reservationTripContext'
import type { BasicFareSettings } from './fare'
import { calculateBasicFareYen } from './fare'
import type {
  PreFixedFareConfirmedRouteView,
  PreFixedFareRouteCandidate,
  PreFixedFareRouteStop,
} from '../types/preFixedFareRouteChange'
import { ensureGoogleMapsApiLoaded } from '../utils/googleMapsLoader'

const createStopId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`

const shortenAddress = (address: string) => {
  const trimmed = address.trim()
  if (!trimmed) {
    return '未設定'
  }

  return trimmed
    .replace(/^日本[、,\s]*/, '')
    .replace(/〒\d{3}-?\d{4}\s*/, '')
}

export const formatRouteStopLabel = (stop: PreFixedFareRouteStop) => {
  const rolePrefix =
    stop.role === 'S' ? 'S' : stop.role === 'G' ? 'G' : stop.role === 'current' ? '現在地' : '経由'
  const name = stop.label.trim() || shortenAddress(stop.address)
  return `${rolePrefix} ${name}`
}

export const formatRoutePathLabel = (stops: PreFixedFareRouteStop[]) =>
  stops.map((stop) => formatRouteStopLabel(stop)).join(' → ')

const readRoutePlanStops = (routePlan: unknown): PreFixedFareRouteStop[] => {
  if (!routePlan || typeof routePlan !== 'object') {
    return []
  }

  const source = routePlan as Record<string, unknown>
  const candidates = [source.stops, source.waypoints, source.points, source.legs]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) {
      continue
    }

    const stops = candidate
      .map((item, index): PreFixedFareRouteStop | null => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const point = item as Record<string, unknown>
        const address =
          (typeof point.address === 'string' && point.address) ||
          (typeof point.name === 'string' && point.name) ||
          (typeof point.label === 'string' && point.label) ||
          ''
        if (!address) {
          return null
        }

        const roleRaw = typeof point.role === 'string' ? point.role.toLowerCase() : ''
        const role: PreFixedFareRouteStop['role'] =
          roleRaw === 's' || roleRaw === 'start' || roleRaw === 'pickup'
            ? 'S'
            : roleRaw === 'g' || roleRaw === 'goal' || roleRaw === 'destination' || roleRaw === 'dropoff'
              ? 'G'
              : index === 0
                ? 'S'
                : index === candidate.length - 1
                  ? 'G'
                  : 'via'

        return {
          id: typeof point.id === 'string' ? point.id : createStopId('stop'),
          role,
          label:
            (typeof point.label === 'string' && point.label) ||
            (typeof point.name === 'string' && point.name) ||
            shortenAddress(address),
          address,
          latitude:
            typeof point.lat === 'number'
              ? point.lat
              : typeof point.latitude === 'number'
                ? point.latitude
                : null,
          longitude:
            typeof point.lng === 'number'
              ? point.lng
              : typeof point.longitude === 'number'
                ? point.longitude
                : null,
        }
      })
      .filter((stop): stop is PreFixedFareRouteStop => stop != null)

    if (stops.length >= 2) {
      return stops
    }
  }

  return []
}

const isLikelyRoundTrip = (context: ReservationTripContext) => {
  const usage = context.quoteSnapshot
  const summary = Array.isArray((context as { usageSummary?: string[] }).usageSummary)
    ? ((context as { usageSummary?: string[] }).usageSummary ?? [])
    : []
  const joined = summary.join(' ')
  if (joined.includes('往復') || joined.includes('帰宅')) {
    return true
  }

  // 介護タクシー予約は自宅→施設→自宅の往復が多いため、
  // ルート計画が無い場合は往復として扱う。
  void usage
  return true
}

export const buildConfirmedRouteStops = (
  context: ReservationTripContext | null,
): PreFixedFareRouteStop[] => {
  if (!context) {
    return []
  }

  const fromPlan = readRoutePlanStops(context.routePlan)
  if (fromPlan.length >= 2) {
    return fromPlan
  }

  const pickupLabel = shortenAddress(context.pickupAddress)
  const dropoffLabel = shortenAddress(context.dropoffAddress)
  const start: PreFixedFareRouteStop = {
    id: createStopId('start'),
    role: 'S',
    label: pickupLabel,
    address: context.pickupAddress,
  }
  const goal: PreFixedFareRouteStop = {
    id: createStopId('goal'),
    role: 'G',
    label: dropoffLabel,
    address: context.dropoffAddress,
  }

  if (isLikelyRoundTrip(context)) {
    return [
      start,
      goal,
      {
        id: createStopId('return'),
        role: 'S',
        label: pickupLabel,
        address: context.pickupAddress,
      },
    ]
  }

  return [start, goal]
}

export const buildConfirmedRouteView = (
  context: ReservationTripContext | null,
): PreFixedFareConfirmedRouteView | null => {
  if (!context) {
    return null
  }

  const stops = buildConfirmedRouteStops(context)
  const serviceFees = Array.isArray(context.quoteSnapshot.serviceFees)
    ? context.quoteSnapshot.serviceFees
    : []

  const viaAddresses = stops
    .slice(1, -1)
    .map((stop) => stop.address || stop.label)
    .filter(Boolean)

  return {
    overallRouteLabel: formatRoutePathLabel(stops),
    stops,
    pickupAddress: context.pickupAddress || stops[0]?.address || '',
    dropoffAddress:
      context.dropoffAddress || stops[stops.length - 1]?.address || '',
    viaAddresses,
    distanceMeters:
      typeof context.quoteSnapshot.distanceMeters === 'number'
        ? context.quoteSnapshot.distanceMeters
        : null,
    durationSeconds:
      typeof context.quoteSnapshot.durationSeconds === 'number'
        ? context.quoteSnapshot.durationSeconds
        : null,
    useToll: Boolean(context.quoteSnapshot.selectedUsesToll),
    confirmedFareYen: context.confirmedFareYen || context.fixedFareTotalYen,
    consentAt: context.consentAt,
    snapshotHash: context.snapshotHash,
    reservationId: context.reservationId,
    fareBreakdownLines: serviceFees
      .filter((fee) => typeof fee.amount === 'number' && fee.amount > 0)
      .map((fee) => ({
        label: fee.label || fee.key,
        amountYen: Math.max(Math.round(fee.amount), 0),
      })),
  }
}

export const getCurrentSegmentStops = (
  overallStops: PreFixedFareRouteStop[],
  segmentIndex: number,
): PreFixedFareRouteStop[] => {
  if (overallStops.length < 2) {
    return overallStops
  }

  const safeIndex = Math.min(Math.max(segmentIndex, 0), overallStops.length - 2)
  return [overallStops[safeIndex], overallStops[safeIndex + 1]]
}

export const openGoogleMapsNavigation = (stops: PreFixedFareRouteStop[]) => {
  const destinations = stops
    .map((stop) => {
      if (
        typeof stop.latitude === 'number' &&
        Number.isFinite(stop.latitude) &&
        typeof stop.longitude === 'number' &&
        Number.isFinite(stop.longitude)
      ) {
        return `${stop.latitude},${stop.longitude}`
      }

      return stop.address.trim()
    })
    .filter(Boolean)

  if (destinations.length === 0) {
    return false
  }

  const origin = destinations[0]
  const destination = destinations[destinations.length - 1]
  const waypoints =
    destinations.length > 2 ? destinations.slice(1, -1).join('|') : ''

  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('origin', origin)
  url.searchParams.set('destination', destination)
  url.searchParams.set('travelmode', 'driving')
  if (waypoints) {
    url.searchParams.set('waypoints', waypoints)
  }

  window.open(url.toString(), '_blank', 'noopener,noreferrer')
  return true
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const haversineDistanceKm = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) => {
  const earthRadiusKm = 6371
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const estimateDurationSeconds = (distanceKm: number) =>
  Math.max(Math.round((distanceKm / 25) * 3600), 60)

type RouteWaypointInput = {
  address: string
  latitude?: number | null
  longitude?: number | null
}

const resolveWaypointQuery = (point: RouteWaypointInput) => {
  if (
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude)
  ) {
    return `${point.latitude},${point.longitude}`
  }

  return point.address.trim()
}

type GoogleDirectionsResult = {
  routes: Array<{
    legs: Array<{
      distance?: { value: number }
      duration?: { value: number }
    }>
    summary?: string
  }>
}

type GoogleDirectionsService = {
  route: (
    request: Record<string, unknown>,
    callback: (result: GoogleDirectionsResult | null, status: string) => void,
  ) => void
}

const getDirectionsService = async (): Promise<GoogleDirectionsService | null> => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
  if (!apiKey) {
    return null
  }

  try {
    await ensureGoogleMapsApiLoaded(apiKey)
    const maps = (window as Window & {
      google?: {
        maps?: {
          DirectionsService?: new () => GoogleDirectionsService
          importLibrary?: (name: string) => Promise<unknown>
        }
      }
    }).google?.maps

    if (maps?.DirectionsService) {
      return new maps.DirectionsService()
    }

    if (maps?.importLibrary) {
      const routesLibrary = (await maps.importLibrary('routes')) as {
        DirectionsService?: new () => GoogleDirectionsService
      }
      if (routesLibrary.DirectionsService) {
        return new routesLibrary.DirectionsService()
      }
    }
  } catch (error) {
    console.warn('Failed to load Google Directions service.', error)
  }

  return null
}

const buildFallbackCandidates = (
  origin: RouteWaypointInput,
  waypoints: RouteWaypointInput[],
  destination: RouteWaypointInput,
  fareSettings: BasicFareSettings,
): PreFixedFareRouteCandidate[] => {
  const points = [origin, ...waypoints, destination]
  let totalDistanceKm = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    if (
      typeof from.latitude === 'number' &&
      typeof from.longitude === 'number' &&
      typeof to.latitude === 'number' &&
      typeof to.longitude === 'number'
    ) {
      totalDistanceKm += haversineDistanceKm(
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      )
    } else {
      totalDistanceKm += 3
    }
  }

  const roadDistanceKm = Math.max(totalDistanceKm * 1.25, 0.5)
  const altDistanceKm = Math.max(roadDistanceKm * 1.15, roadDistanceKm + 0.4)
  const summary = points
    .map((point) => point.address.trim() || '地点')
    .join(' → ')

  return [
    {
      id: 'route-a',
      label: 'ルートA',
      distanceKm: Number(roadDistanceKm.toFixed(1)),
      durationSeconds: estimateDurationSeconds(roadDistanceKm),
      additionalFareYen: calculateBasicFareYen(roadDistanceKm, fareSettings),
      summary,
      useToll: false,
    },
    {
      id: 'route-b',
      label: 'ルートB',
      distanceKm: Number(altDistanceKm.toFixed(1)),
      durationSeconds: estimateDurationSeconds(altDistanceKm),
      additionalFareYen: calculateBasicFareYen(altDistanceKm, fareSettings),
      summary,
      useToll: false,
    },
  ]
}

export async function calculateAdditionalRouteCandidates({
  origin,
  waypoints,
  destination,
  fareSettings,
}: {
  origin: RouteWaypointInput
  waypoints: RouteWaypointInput[]
  destination: RouteWaypointInput
  fareSettings: BasicFareSettings
}): Promise<PreFixedFareRouteCandidate[]> {
  const directionsService = await getDirectionsService()
  if (!directionsService) {
    return buildFallbackCandidates(origin, waypoints, destination, fareSettings)
  }

  const originQuery = resolveWaypointQuery(origin)
  const destinationQuery = resolveWaypointQuery(destination)
  if (!originQuery || !destinationQuery) {
    return buildFallbackCandidates(origin, waypoints, destination, fareSettings)
  }

  const request: Record<string, unknown> = {
    origin: originQuery,
    destination: destinationQuery,
    travelMode: 'DRIVING',
    provideRouteAlternatives: true,
    region: 'JP',
    language: 'ja',
  }

  if (waypoints.length > 0) {
    request.waypoints = waypoints
      .map((point) => resolveWaypointQuery(point))
      .filter(Boolean)
      .map((location) => ({ location, stopover: true }))
  }

  const result = await new Promise<GoogleDirectionsResult | null>((resolve) => {
    directionsService.route(request, (response, status) => {
      if (status === 'OK' && response) {
        resolve(response)
        return
      }

      resolve(null)
    })
  })

  if (!result?.routes?.length) {
    return buildFallbackCandidates(origin, waypoints, destination, fareSettings)
  }

  const candidates = result.routes.slice(0, 3).map((route, index) => {
    const distanceMeters = route.legs.reduce(
      (total, leg) => total + (leg.distance?.value ?? 0),
      0,
    )
    const durationSeconds = route.legs.reduce(
      (total, leg) => total + (leg.duration?.value ?? 0),
      0,
    )
    const distanceKm = Math.max(distanceMeters / 1000, 0.1)
    const labels = ['ルートA', 'ルートB', 'ルートC']
    const pathPoints = [origin, ...waypoints, destination]
      .map((point) => point.address.trim() || '地点')
      .join(' → ')

    return {
      id: `route-${index + 1}`,
      label: labels[index] ?? `ルート${index + 1}`,
      distanceKm: Number(distanceKm.toFixed(1)),
      durationSeconds,
      additionalFareYen: calculateBasicFareYen(distanceKm, fareSettings),
      summary: route.summary ? `${pathPoints}（${route.summary}）` : pathPoints,
      useToll: false,
    } satisfies PreFixedFareRouteCandidate
  })

  if (candidates.length === 1) {
    const only = candidates[0]
    candidates.push({
      ...only,
      id: 'route-2',
      label: 'ルートB',
      distanceKm: Number((only.distanceKm * 1.12).toFixed(1)),
      durationSeconds: Math.round(only.durationSeconds * 1.12),
      additionalFareYen: calculateBasicFareYen(only.distanceKm * 1.12, fareSettings),
    })
  }

  return candidates
}

export const formatDurationMinutes = (durationSeconds: number) =>
  `${Math.max(Math.round(durationSeconds / 60), 1)}分`
