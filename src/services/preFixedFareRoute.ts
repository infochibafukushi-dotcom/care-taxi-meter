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

/** 事前確定Mの往復判定。専用フラグはなく trip.usageSummary と routePlan から推定する。 */
export const isPreFixedFareRoundTrip = (context: ReservationTripContext | null) => {
  if (!context) {
    return false
  }

  const summary = context.usageSummary ?? []
  const joined = summary.join(' ')
  if (joined.includes('片道') || joined.includes('立ち寄り')) {
    return false
  }
  if (joined.includes('往復') || joined.includes('帰宅')) {
    return true
  }

  const fromPlan = readRoutePlanStops(context.routePlan)
  if (fromPlan.length >= 3) {
    const first = fromPlan[0]
    const last = fromPlan[fromPlan.length - 1]
    if (
      first?.address?.trim() &&
      last?.address?.trim() &&
      first.address.trim() === last.address.trim()
    ) {
      return true
    }
  }
  if (fromPlan.length === 2) {
    return false
  }

  return false
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

  if (isPreFixedFareRoundTrip(context)) {
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
    overview_polyline?: { points?: string }
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

export type PreFixedDirectionsRouteSource = {
  distanceKm: number
  durationSeconds: number
  encodedPolyline?: string
  useToll: boolean
  summary?: string
}

type GoogleDirectionsRoute = GoogleDirectionsResult['routes'][number]

const toRouteSource = (route: GoogleDirectionsRoute): PreFixedDirectionsRouteSource => {
  const distanceMeters = route.legs.reduce(
    (total, leg) => total + (leg.distance?.value ?? 0),
    0,
  )
  const durationSeconds = route.legs.reduce(
    (total, leg) => total + (leg.duration?.value ?? 0),
    0,
  )
  const distanceKm = Math.max(distanceMeters / 1000, 0.1)

  return {
    distanceKm: Number(distanceKm.toFixed(1)),
    durationSeconds: Math.max(durationSeconds, 60),
    encodedPolyline: route.overview_polyline?.points,
    useToll: false,
    summary: route.summary,
  }
}

const routeSourceKey = (source: PreFixedDirectionsRouteSource) =>
  `${source.encodedPolyline ?? ''}:${source.distanceKm.toFixed(1)}:${source.durationSeconds}`

const isSameRouteSource = (
  left?: PreFixedDirectionsRouteSource,
  right?: PreFixedDirectionsRouteSource,
) => {
  if (!left || !right) {
    return false
  }
  return routeSourceKey(left) === routeSourceKey(right)
}

const pickFastestRouteSource = (
  routes: GoogleDirectionsRoute[],
): PreFixedDirectionsRouteSource | undefined => {
  if (routes.length === 0) {
    return undefined
  }

  return routes
    .map(toRouteSource)
    .sort((a, b) => a.durationSeconds - b.durationSeconds)[0]
}

const collectUniqueRouteSources = (
  routeGroups: GoogleDirectionsRoute[][],
): PreFixedDirectionsRouteSource[] => {
  const unique: PreFixedDirectionsRouteSource[] = []
  const seen = new Set<string>()

  for (const routes of routeGroups) {
    for (const route of routes) {
      const source = toRouteSource(route)
      const key = routeSourceKey(source)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      unique.push(source)
    }
  }

  return unique
}

const buildDirectionsBaseRequest = (
  origin: RouteWaypointInput,
  waypoints: RouteWaypointInput[],
  destination: RouteWaypointInput,
) => {
  const originQuery = resolveWaypointQuery(origin)
  const destinationQuery = resolveWaypointQuery(destination)
  if (!originQuery || !destinationQuery) {
    return null
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

  return request
}

const requestDirectionsRoutes = async (
  directionsService: GoogleDirectionsService,
  request: Record<string, unknown>,
): Promise<GoogleDirectionsRoute[]> => {
  const result = await new Promise<GoogleDirectionsResult | null>((resolve) => {
    directionsService.route(request, (response, status) => {
      if (status === 'OK' && response?.routes?.length) {
        resolve(response)
        return
      }
      resolve(null)
    })
  })

  return result?.routes ?? []
}

const buildFallbackRouteSources = (
  origin: RouteWaypointInput,
  waypoints: RouteWaypointInput[],
  destination: RouteWaypointInput,
): PreFixedDirectionsRouteSource[] => {
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

  return [
    {
      distanceKm: Number(roadDistanceKm.toFixed(1)),
      durationSeconds: estimateDurationSeconds(roadDistanceKm),
      useToll: false,
    },
    {
      distanceKm: Number(altDistanceKm.toFixed(1)),
      durationSeconds: estimateDurationSeconds(altDistanceKm),
      useToll: false,
    },
  ]
}

const padGeneralRoadSource = (
  timePriority: PreFixedDirectionsRouteSource,
  index: number,
): PreFixedDirectionsRouteSource => ({
  ...timePriority,
  distanceKm: Number((timePriority.distanceKm * (1 + index * 0.08)).toFixed(1)),
  durationSeconds: Math.round(timePriority.durationSeconds * (1 + index * 0.08)),
})

/**
 * かんたん見積もり / 予約なし手動フロー共通の A〜D ルート種別ソースを生成する。
 */
export async function calculatePreFixedDirectionsRouteSources({
  origin,
  waypoints,
  destination,
}: {
  origin: RouteWaypointInput
  waypoints: RouteWaypointInput[]
  destination: RouteWaypointInput
}): Promise<PreFixedDirectionsRouteSource[]> {
  const directionsService = await getDirectionsService()
  const baseRequest = buildDirectionsBaseRequest(origin, waypoints, destination)

  if (!directionsService || !baseRequest) {
    return buildFallbackRouteSources(origin, waypoints, destination)
  }

  const [standardRoutes, generalRoadRoutes, avoidTollRoutes] = await Promise.all([
    requestDirectionsRoutes(directionsService, baseRequest),
    requestDirectionsRoutes(directionsService, {
      ...baseRequest,
      avoidHighways: true,
      avoidTolls: true,
    }),
    requestDirectionsRoutes(directionsService, {
      ...baseRequest,
      avoidTolls: true,
    }),
  ])

  if (standardRoutes.length === 0) {
    return buildFallbackRouteSources(origin, waypoints, destination)
  }

  const timePriority = pickFastestRouteSource(standardRoutes)
  if (!timePriority) {
    return buildFallbackRouteSources(origin, waypoints, destination)
  }

  let generalRoad = pickFastestRouteSource(generalRoadRoutes)
  if (!generalRoad || isSameRouteSource(timePriority, generalRoad)) {
    generalRoad = padGeneralRoadSource(timePriority, 1)
  }

  const allUnique = collectUniqueRouteSources([
    standardRoutes,
    generalRoadRoutes,
    avoidTollRoutes,
  ])
  const shortestOverall = [...allUnique].sort((a, b) => a.distanceKm - b.distanceKm)[0]

  const avoidTollBest = pickFastestRouteSource(avoidTollRoutes)
  const tollCandidate = pickFastestRouteSource(standardRoutes)
  const tollUsesHighway =
    tollCandidate &&
    avoidTollBest &&
    !isSameRouteSource(tollCandidate, avoidTollBest) &&
    (tollCandidate.durationSeconds < avoidTollBest.durationSeconds ||
      tollCandidate.distanceKm < avoidTollBest.distanceKm)

  const slots: PreFixedDirectionsRouteSource[] = [timePriority, generalRoad]

  if (
    shortestOverall &&
    !isSameRouteSource(shortestOverall, timePriority) &&
    !isSameRouteSource(shortestOverall, generalRoad) &&
    shortestOverall.distanceKm <= timePriority.distanceKm &&
    shortestOverall.distanceKm <= generalRoad.distanceKm
  ) {
    slots.push({ ...shortestOverall, useToll: false })
  }

  if (tollCandidate && tollUsesHighway) {
    const tollPriority = { ...tollCandidate, useToll: true }
    const alreadyIncluded = slots.some((slot) => isSameRouteSource(slot, tollPriority))
    if (!alreadyIncluded) {
      slots.push(tollPriority)
    }
  }

  while (slots.length < 2) {
    slots.push(padGeneralRoadSource(timePriority, slots.length))
  }

  return slots.slice(0, 4)
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

  const candidates = result.routes.slice(0, 4).map((route, index) => {
    const distanceMeters = route.legs.reduce(
      (total, leg) => total + (leg.distance?.value ?? 0),
      0,
    )
    const durationSeconds = route.legs.reduce(
      (total, leg) => total + (leg.duration?.value ?? 0),
      0,
    )
    const distanceKm = Math.max(distanceMeters / 1000, 0.1)
    const labels = ['ルートA', 'ルートB', 'ルートC', 'ルートD']
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
      encodedPolyline: route.overview_polyline?.points,
    } satisfies PreFixedFareRouteCandidate
  })

  while (candidates.length < 2 && candidates[0]) {
    const baseIndex = candidates.length
    const base = candidates[0]
    candidates.push({
      ...base,
      id: `route-${baseIndex + 1}`,
      label: ['ルートA', 'ルートB', 'ルートC', 'ルートD'][baseIndex] ?? `ルート${baseIndex + 1}`,
      distanceKm: Number((base.distanceKm * (1 + baseIndex * 0.08)).toFixed(1)),
      durationSeconds: Math.round(base.durationSeconds * (1 + baseIndex * 0.08)),
      additionalFareYen: calculateBasicFareYen(base.distanceKm * (1 + baseIndex * 0.08), fareSettings),
    })
  }

  return candidates
}

export const formatDurationMinutes = (durationSeconds: number) =>
  `${Math.max(Math.round(durationSeconds / 60), 1)}分`
