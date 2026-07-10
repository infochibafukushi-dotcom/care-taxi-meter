import { basicFareSettings, calculateBasicFareYen, type AssistItem, type BasicFareSettings } from './fare'
import {
  calculatePreFixedDirectionsRouteSources,
  type PreFixedDirectionsRouteSource,
} from './preFixedFareRoute'
import type { RoutePoint, PreFixedRouteCandidate, PreFixedRouteCandidateId } from '../types/preFixedMeterSession'
import { preFixedRouteCandidateLabels } from '../types/preFixedMeterSession'

const ROUTE_IDS: PreFixedRouteCandidateId[] = ['A', 'B', 'C', 'D']

const buildCandidateFromSource = (
  source: PreFixedDirectionsRouteSource,
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
}: {
  pickup: RoutePoint
  stops: RoutePoint[]
  destination: RoutePoint
  serviceItems: AssistItem[]
  basicFare?: BasicFareSettings
  includeServiceFees?: boolean
}): Promise<PreFixedRouteCandidate[]> {
  const origin = toWaypointInput(pickup)
  const waypoints = stops.map(toWaypointInput)
  const dest = toWaypointInput(destination)
  const serviceFeesYen = includeServiceFees ? calculateSelectedServiceFeesYen(serviceItems) : 0

  const sources = await calculatePreFixedDirectionsRouteSources({
    origin,
    waypoints,
    destination: dest,
  })

  if (sources.length === 0) {
    return []
  }

  return sources.map((source, index) => {
    const id = ROUTE_IDS[index] ?? ROUTE_IDS[ROUTE_IDS.length - 1]
    return buildCandidateFromSource(source, id, basicFare, serviceFeesYen)
  })
}

export const formatRouteDurationLabel = (durationSeconds: number) => {
  const minutes = Math.max(Math.round(durationSeconds / 60), 1)
  return `約${minutes}分`
}

export const formatRouteDistanceLabel = (distanceMeters: number) =>
  `${(Math.max(distanceMeters, 0) / 1000).toFixed(1)}km`

const ROUTE_ID_ORDER: PreFixedRouteCandidateId[] = ['A', 'B', 'C', 'D']

export const sortRouteCandidatesById = (candidates: PreFixedRouteCandidate[]) =>
  [...candidates].sort(
    (left, right) => ROUTE_ID_ORDER.indexOf(left.id) - ROUTE_ID_ORDER.indexOf(right.id),
  )
