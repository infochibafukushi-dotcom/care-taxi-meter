import { basicFareSettings, calculateBasicFareYen, type AssistItem, type BasicFareSettings } from './fare'
import { calculateAdditionalRouteCandidates } from './preFixedFareRoute'
import type { RoutePoint, PreFixedRouteCandidate, PreFixedRouteCandidateId } from '../types/preFixedMeterSession'
import { preFixedRouteCandidateLabels } from '../types/preFixedMeterSession'

const ROUTE_IDS: PreFixedRouteCandidateId[] = ['A', 'B', 'C', 'D']
const MANUAL_FLOW_ROUTE_IDS: PreFixedRouteCandidateId[] = ['A', 'B']

const buildCandidateFromSource = (
  source: Awaited<ReturnType<typeof calculateAdditionalRouteCandidates>>[number],
  id: PreFixedRouteCandidateId,
  basicFare: BasicFareSettings,
  serviceFeesYen: number,
): PreFixedRouteCandidate => {
  const distanceMeters = Math.round(Math.max(source.distanceKm, 0.1) * 1000)
  const durationSeconds = Math.max(source.durationSeconds, 60)
  const fixedFareYen = calculateBasicFareYen(source.distanceKm, basicFare)

  return {
    id,
    label: preFixedRouteCandidateLabels[id],
    distanceMeters,
    durationSeconds,
    fixedFareYen,
    serviceFeesYen,
    totalYen: fixedFareYen + serviceFeesYen,
    tollIncluded: source.useToll,
    polyline: source.encodedPolyline,
  }
}

export const ensureMinimumRouteCandidates = (
  candidates: PreFixedRouteCandidate[],
  minimum = 2,
): PreFixedRouteCandidate[] => {
  if (candidates.length === 0) {
    return []
  }

  const result = [...candidates]
  while (result.length < minimum) {
    const source = result[0]
    const nextId = MANUAL_FLOW_ROUTE_IDS[result.length] ?? 'B'
    result.push({
      ...source,
      id: nextId,
      label: preFixedRouteCandidateLabels[nextId],
    })
  }

  return result
}

export const calculateSelectedServiceFeesYen = (items: AssistItem[]) =>
  items
    .filter((item) => item.enabled)
    .reduce((sum, item) => sum + Math.max(item.amount, 0), 0)

const toWaypointInput = (point: RoutePoint) => ({
  address: point.address.trim() || point.label.trim(),
  latitude: point.lat ?? null,
  longitude: point.lng ?? null,
})

export const buildOverallStopsFromSessionPoints = (
  pickup: RoutePoint,
  stops: RoutePoint[],
  destination: RoutePoint,
): RoutePoint[] => [pickup, ...stops, destination]

export async function calculatePreFixedRouteCandidates({
  pickup,
  stops,
  destination,
  serviceItems,
  basicFare = basicFareSettings,
  includeServiceFees = true,
  minCandidates = 1,
  maxCandidates = 4,
}: {
  pickup: RoutePoint
  stops: RoutePoint[]
  destination: RoutePoint
  serviceItems: AssistItem[]
  basicFare?: BasicFareSettings
  includeServiceFees?: boolean
  minCandidates?: number
  maxCandidates?: number
}): Promise<PreFixedRouteCandidate[]> {
  const origin = toWaypointInput(pickup)
  const waypoints = stops.map(toWaypointInput)
  const dest = toWaypointInput(destination)
  const serviceFeesYen = includeServiceFees ? calculateSelectedServiceFeesYen(serviceItems) : 0

  const rawCandidates = await calculateAdditionalRouteCandidates({
    origin,
    waypoints,
    destination: dest,
    fareSettings: basicFare,
  })

  if (rawCandidates.length === 0) {
    return []
  }

  const uniqueCandidates: typeof rawCandidates = []
  const seen = new Set<string>()
  for (const candidate of rawCandidates) {
    const key = `${candidate.id}:${candidate.encodedPolyline ?? ''}:${candidate.distanceKm}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    uniqueCandidates.push(candidate)
  }

  const sortedByDistance = [...uniqueCandidates].sort((a, b) => a.distanceKm - b.distanceKm)
  const sortedByDuration = [...uniqueCandidates].sort((a, b) => a.durationSeconds - b.durationSeconds)

  const pickUnique = (primary: typeof rawCandidates[0] | undefined, ...fallbacks: Array<typeof rawCandidates[0] | undefined>) => {
    for (const candidate of [primary, ...fallbacks]) {
      if (candidate) {
        return candidate
      }
    }
    return uniqueCandidates[0]
  }

  const recommended = uniqueCandidates[0]
  const shortest = sortedByDistance[0]
  const fastest = sortedByDuration[0]
  const alternative =
    uniqueCandidates.find((item) => item.id !== recommended?.id && item.id !== shortest?.id) ??
    uniqueCandidates[uniqueCandidates.length - 1]

  const sourceMap: Array<typeof rawCandidates[0] | undefined> = [
    pickUnique(recommended, shortest, fastest, alternative),
    pickUnique(shortest, recommended, fastest, alternative),
    pickUnique(fastest, recommended, shortest, alternative),
    pickUnique(alternative, recommended, shortest, fastest),
  ]

  const usedSources: typeof rawCandidates = []
  const usedKeys = new Set<string>()
  for (const source of sourceMap) {
    if (!source) {
      continue
    }
    const key = `${source.id}:${source.encodedPolyline ?? ''}:${source.distanceKm}`
    if (usedKeys.has(key)) {
      continue
    }
    usedKeys.add(key)
    usedSources.push(source)
  }

  if (usedSources.length === 0 && uniqueCandidates[0]) {
    usedSources.push(uniqueCandidates[0])
  }

  const mapped = usedSources.map((source, index) => {
    const id = ROUTE_IDS[index] ?? ROUTE_IDS[ROUTE_IDS.length - 1]
    return buildCandidateFromSource(source, id, basicFare, serviceFeesYen)
  })

  const withMinimum = ensureMinimumRouteCandidates(mapped, minCandidates)
  return withMinimum.slice(0, maxCandidates)
}

export const formatRouteDurationLabel = (durationSeconds: number) => {
  const minutes = Math.max(Math.round(durationSeconds / 60), 1)
  return `約${minutes}分`
}

export const formatRouteDistanceLabel = (distanceMeters: number) =>
  `${(Math.max(distanceMeters, 0) / 1000).toFixed(1)}km`
