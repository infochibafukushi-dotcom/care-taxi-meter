import { basicFareSettings, calculateBasicFareYen, type AssistItem, type BasicFareSettings } from './fare'
import { fetchStrategyDirectionsCandidates } from './preFixedFareRoute'
import type {
  PreFixedRouteCandidate,
  PreFixedRouteCandidateId,
  PreFixedRouteLeg,
} from '../types/preFixedMeterSession'
import {
  assembleStrategySlotRoutes,
  ensureDefaultStrategySelection,
  ensureMinimumStrategyCandidates,
  pickShorterDistanceRoute,
  STRATEGY_ROUTE_LABELS,
  STRATEGY_TO_ROUTE_ID,
  type StrategyRouteCandidate,
} from './preFixedRouteStrategySelection'
import type { RoutePoint } from '../types/preFixedMeterSession'

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

const toUiCandidate = (
  route: StrategyRouteCandidate,
  serviceFeesYen: number,
  basicFare: BasicFareSettings,
  requirePolyline: boolean,
): PreFixedRouteCandidate | null => {
  const distanceMeters = Math.max(Math.round(Number(route.distanceMeters) || 0), 0)
  const durationSeconds = Math.max(Math.round(Number(route.durationSeconds) || 0), 0)
  const distanceKm = Math.max(distanceMeters / 1000, 0.1)
  const polyline = String(route.encodedPolyline || '').trim()
  if (!(distanceMeters > 0) || !(durationSeconds > 0)) {
    return null
  }
  if (requirePolyline && !polyline) {
    return null
  }

  const id = STRATEGY_TO_ROUTE_ID[route.routeStrategy]
  const routeLegs: PreFixedRouteLeg[] = (route.routeLegs || []).map((leg) => ({
    legIndex: leg.legIndex,
    distanceMeters: leg.distanceMeters,
    durationSeconds: leg.durationSeconds,
    encodedPolyline: leg.encodedPolyline,
  }))
  const fixedFareYen = calculateBasicFareYen(distanceKm, basicFare)

  return {
    id,
    label: STRATEGY_ROUTE_LABELS[route.routeStrategy],
    distanceMeters,
    durationSeconds,
    fixedFareYen,
    serviceFeesYen,
    totalYen: fixedFareYen + serviceFeesYen,
    tollIncluded: route.usesToll === true,
    polyline,
    routeLegs,
    routeStrategy: route.routeStrategy,
  }
}

/**
 * かんたん見積 computeSegmentRouteCandidates / assembleStrategySlotRoutes 相当。
 * A=時間優先 / B=一般道優先 は必須、C=距離優先・D=有料道路優先は条件付き。
 */
const ROUTE_ID_ORDER: PreFixedRouteCandidateId[] = ['A', 'B', 'C', 'D']

export const sortRouteCandidatesById = (candidates: PreFixedRouteCandidate[]) =>
  [...candidates].sort(
    (left, right) => ROUTE_ID_ORDER.indexOf(left.id) - ROUTE_ID_ORDER.indexOf(right.id),
  )

export async function calculatePreFixedRouteCandidates({
  pickup,
  stops,
  destination,
  serviceItems,
  basicFare = basicFareSettings,
  allowFallback = false,
  requirePolyline = true,
  includeServiceFees = true,
}: {
  pickup: RoutePoint
  stops: RoutePoint[]
  destination: RoutePoint
  serviceItems: AssistItem[]
  basicFare?: BasicFareSettings
  allowFallback?: boolean
  requirePolyline?: boolean
  includeServiceFees?: boolean
}): Promise<PreFixedRouteCandidate[]> {
  const origin = toWaypointInput(pickup)
  const waypoints = stops.map(toWaypointInput)
  const dest = toWaypointInput(destination)
  const serviceFeesYen = includeServiceFees ? calculateSelectedServiceFeesYen(serviceItems) : 0
  // かんたん見積の roadType===general のとき userAvoidTolls=true。
  // care-taxi-meter ではデフォルトで有料許容（時間優先）。
  const userAvoidTolls = false

  const [timePriorityList, generalRoadList, recommendedPool, tollAllowedList] =
    await Promise.all([
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'time_priority',
        avoidTolls: userAvoidTolls,
        avoidHighways: false,
        provideRouteAlternatives: false,
        generationReason: 'time_priority_route',
      }),
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'general_road_priority',
        avoidTolls: true,
        avoidHighways: true,
        provideRouteAlternatives: false,
        generationReason: 'general_road_priority_route',
      }),
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'time_priority',
        avoidTolls: userAvoidTolls,
        avoidHighways: false,
        provideRouteAlternatives: true,
        generationReason: 'recommended_pool',
      }),
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'toll_allowed',
        avoidTolls: false,
        avoidHighways: false,
        provideRouteAlternatives: true,
        generationReason: 'toll_allowed_route',
      }),
    ])

  const timePriorityRoute = timePriorityList[0] ?? null
  const generalRoadPriorityRoute = generalRoadList[0] ?? null

  let shorterDistanceRoute = pickShorterDistanceRoute(recommendedPool, [
    ...(timePriorityRoute ? [timePriorityRoute] : []),
    ...(generalRoadPriorityRoute ? [generalRoadPriorityRoute] : []),
  ])

  if (!shorterDistanceRoute) {
    const distanceAttempts = await Promise.all([
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'shorter_distance',
        avoidTolls: userAvoidTolls,
        avoidHighways: userAvoidTolls,
        provideRouteAlternatives: waypoints.length === 0,
        routingPreference: 'TRAFFIC_UNAWARE',
        generationReason: 'shorter_distance_traffic_unaware',
      }),
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'shorter_distance',
        avoidTolls: userAvoidTolls,
        avoidHighways: false,
        provideRouteAlternatives: waypoints.length === 0,
        routingPreference: 'TRAFFIC_UNAWARE',
        generationReason: 'shorter_distance_highway_allowed',
      }),
      fetchStrategyDirectionsCandidates({
        origin,
        waypoints,
        destination: dest,
        strategy: 'shorter_distance',
        avoidTolls: true,
        avoidHighways: true,
        provideRouteAlternatives: waypoints.length === 0,
        routingPreference: 'TRAFFIC_UNAWARE',
        generationReason: 'shorter_distance_general_road',
      }),
    ])
    const distancePool = distanceAttempts.flat()
    shorterDistanceRoute = pickShorterDistanceRoute(distancePool, [
      ...(timePriorityRoute ? [timePriorityRoute] : []),
      ...(generalRoadPriorityRoute ? [generalRoadPriorityRoute] : []),
    ])
  }

  // Directions には tollInfo が無いことが多い。toll_allowed は usesToll 実測のみ採用。
  const tollAllowedRoute =
    tollAllowedList.find((route) => route.usesToll === true) ??
    tollAllowedList.find((route) => Boolean(route.tollInfo)) ??
    null

  let assembled = assembleStrategySlotRoutes({
    time_priority: timePriorityRoute,
    general_road_priority: generalRoadPriorityRoute,
    shorter_distance: shorterDistanceRoute,
    toll_allowed: tollAllowedRoute,
  })

  assembled = ensureMinimumStrategyCandidates(assembled)

  if (assembled.length === 0) {
    if (allowFallback) {
      // フォールバックは strategy 組立失敗時のみ（レガシー経路は使わない）
      return []
    }
    return []
  }

  const uiCandidates = assembled
    .map((route) => toUiCandidate(route, serviceFeesYen, basicFare, requirePolyline))
    .filter((candidate): candidate is PreFixedRouteCandidate => candidate != null)

  return uiCandidates
}

/** 選択中候補が除外されたら A（時間優先）へ戻す */
export const resolveSelectedRouteCandidate = (
  candidates: PreFixedRouteCandidate[],
  selectedRouteId: string,
): PreFixedRouteCandidate | null => {
  const resolved = ensureDefaultStrategySelection(
    candidates.map((candidate) => ({
      ...candidate,
      routeStrategy: candidate.routeStrategy,
    })),
    selectedRouteId,
  )
  return resolved
}

export const formatRouteDurationLabel = (durationSeconds: number) => {
  const minutes = Math.max(Math.round(durationSeconds / 60), 1)
  return `約${minutes}分`
}

export const formatRouteDistanceLabel = (distanceMeters: number) =>
  `${(Math.max(distanceMeters, 0) / 1000).toFixed(1)}km`

export type { PreFixedRouteCandidateId }
