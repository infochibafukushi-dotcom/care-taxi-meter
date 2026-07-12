/**
 * lp-site estimate/estimate-distance-api.js の候補スロット組立ロジック移植。
 * DISPLAY_STRATEGY_ORDER / canAssignStrategySlot / isDuplicateRoute を正とする。
 */

export type RouteDisplayStrategy =
  | 'time_priority'
  | 'general_road_priority'
  | 'shorter_distance'
  | 'toll_allowed'

export const DISPLAY_STRATEGY_ORDER: RouteDisplayStrategy[] = [
  'time_priority',
  'general_road_priority',
  'shorter_distance',
  'toll_allowed',
]

export const STRATEGY_TO_ROUTE_ID: Record<RouteDisplayStrategy, 'A' | 'B' | 'C' | 'D'> = {
  time_priority: 'A',
  general_road_priority: 'B',
  shorter_distance: 'C',
  toll_allowed: 'D',
}

export const ROUTE_ID_TO_STRATEGY: Record<'A' | 'B' | 'C' | 'D', RouteDisplayStrategy> = {
  A: 'time_priority',
  B: 'general_road_priority',
  C: 'shorter_distance',
  D: 'toll_allowed',
}

export const STRATEGY_ROUTE_LABELS: Record<RouteDisplayStrategy, string> = {
  time_priority: '時間優先ルート',
  general_road_priority: '一般道優先ルート',
  shorter_distance: '距離優先ルート',
  toll_allowed: '有料道路優先ルート',
}

export type StrategyRouteLeg = {
  legIndex: number
  distanceMeters: number
  durationSeconds: number
  encodedPolyline: string
}

export type StrategyRouteCandidate = {
  routeStrategy: RouteDisplayStrategy
  distanceMeters: number
  durationSeconds: number
  encodedPolyline: string
  routeLegs: StrategyRouteLeg[]
  routeSummary?: string
  avoidHighways?: boolean
  avoidTolls?: boolean
  routingPreference?: string
  intermediateWaypointId?: string
  tollInfo?: unknown
  travelAdvisory?: { tollInfo?: unknown }
  usesToll?: boolean
  isSyntheticRoute?: boolean
  generationReason?: string
}

const getRouteSummaryText = (route: StrategyRouteCandidate | null | undefined) =>
  String(route?.routeSummary || '').trim()

export const getRouteRoutingFingerprint = (
  route: Pick<
    StrategyRouteCandidate,
    'avoidHighways' | 'avoidTolls' | 'routingPreference' | 'intermediateWaypointId'
  > | null
  | undefined,
) =>
  [
    route?.avoidHighways === true ? '1' : '0',
    route?.avoidTolls === true ? '1' : '0',
    String(route?.routingPreference || 'TRAFFIC_AWARE'),
    String(route?.intermediateWaypointId || ''),
  ].join('|')

export const isSameEncodedPath = (
  left: { encodedPolyline?: string } | null | undefined,
  right: { encodedPolyline?: string } | null | undefined,
) => {
  const polyLeft = String(left?.encodedPolyline || '')
  const polyRight = String(right?.encodedPolyline || '')
  return Boolean(polyLeft && polyRight && polyLeft === polyRight)
}

/** lp-site isDuplicateRoute と同等 */
export const isDuplicateRoute = (
  left: StrategyRouteCandidate | null | undefined,
  right: StrategyRouteCandidate | null | undefined,
): boolean => {
  if (!left || !right) {
    return false
  }
  if (isSameEncodedPath(left, right)) {
    return true
  }
  if (getRouteRoutingFingerprint(left) !== getRouteRoutingFingerprint(right)) {
    return false
  }
  const distLeft = Number(left.distanceMeters) || 0
  const distRight = Number(right.distanceMeters) || 0
  const durLeft = Number(left.durationSeconds) || 0
  const durRight = Number(right.durationSeconds) || 0
  if (distLeft > 0 && distRight > 0 && distLeft === distRight && durLeft === durRight) {
    return true
  }
  if (distLeft > 0 && distRight > 0 && Math.abs(distLeft - distRight) < 100) {
    if (Math.abs(durLeft - durRight) < 60) {
      return true
    }
  }
  const summaryLeft = getRouteSummaryText(left)
  const summaryRight = getRouteSummaryText(right)
  if (summaryLeft && summaryRight && summaryLeft === summaryRight) {
    return true
  }
  return false
}

export const isDuplicateOfAny = (
  route: StrategyRouteCandidate,
  others: StrategyRouteCandidate[],
) => others.some((existing) => isDuplicateRoute(existing, route))

export const isCoreDisplayStrategy = (strategy: RouteDisplayStrategy) =>
  strategy === 'time_priority' || strategy === 'general_road_priority'

const findKeptCoreRoute = (
  kept: StrategyRouteCandidate[],
  strategy: RouteDisplayStrategy,
) => kept.find((route) => route.routeStrategy === strategy) || null

/**
 * C は raw distanceMeters で A・B 双方より厳密に短い場合のみ。
 * 表示 km や polyline 差分だけでは採用しない。
 */
export const isStrictlyShorterThanCoreRoutes = (
  route: StrategyRouteCandidate,
  kept: StrategyRouteCandidate[],
): boolean => {
  const distance = Number(route.distanceMeters) || 0
  if (!(distance > 0)) {
    return false
  }
  const timeRoute = findKeptCoreRoute(kept, 'time_priority')
  const generalRoute = findKeptCoreRoute(kept, 'general_road_priority')
  if (!timeRoute || !generalRoute) {
    return false
  }
  const timeMeters = Number(timeRoute.distanceMeters) || 0
  const generalMeters = Number(generalRoute.distanceMeters) || 0
  if (!(timeMeters > 0) || !(generalMeters > 0)) {
    return false
  }
  return distance < timeMeters && distance < generalMeters
}

/** lp-site routeUsesToll（tollInfo 実測）と同等 */
export const routeUsesToll = (route: {
  tollInfo?: unknown
  travelAdvisory?: { tollInfo?: unknown }
  usesToll?: boolean
}): boolean => {
  if (route.usesToll === true) {
    return true
  }
  const tollInfo =
    route.tollInfo ||
    (route.travelAdvisory && typeof route.travelAdvisory === 'object'
      ? route.travelAdvisory.tollInfo
      : null) ||
    null
  if (!tollInfo || typeof tollInfo !== 'object') {
    return false
  }
  const info = tollInfo as {
    estimatedPrice?: unknown
    tollInfos?: unknown[]
  }
  const estimatedPrice = info.estimatedPrice
  if (Array.isArray(estimatedPrice) && estimatedPrice.length > 0) {
    return true
  }
  if (estimatedPrice && typeof estimatedPrice === 'object' && !Array.isArray(estimatedPrice)) {
    const price = estimatedPrice as {
      units?: unknown
      nanos?: unknown
      currencyCode?: unknown
    }
    const units = Number(price.units)
    const nanos = Number(price.nanos)
    if ((Number.isFinite(units) && units !== 0) || (Number.isFinite(nanos) && nanos !== 0)) {
      return true
    }
    if (price.currencyCode) {
      return true
    }
  }
  if (Array.isArray(info.tollInfos) && info.tollInfos.length > 0) {
    return true
  }
  return false
}

/** lp-site canAssignStrategySlot と同等 */
export const canAssignStrategySlot = (
  strategy: RouteDisplayStrategy,
  route: StrategyRouteCandidate | null | undefined,
  kept: StrategyRouteCandidate[],
): boolean => {
  if (!route) {
    return false
  }
  if (strategy === 'toll_allowed' && !routeUsesToll(route)) {
    return false
  }
  if (strategy === 'shorter_distance') {
    if (!Number(route.distanceMeters) || !Number(route.durationSeconds)) {
      return false
    }
    if (isDuplicateOfAny(route, kept)) {
      return false
    }
    if (!isStrictlyShorterThanCoreRoutes(route, kept)) {
      return false
    }
    return true
  }
  if (isCoreDisplayStrategy(strategy)) {
    return true
  }
  return !isDuplicateOfAny(route, kept)
}

export type StrategyFetchMap = Partial<Record<RouteDisplayStrategy, StrategyRouteCandidate | null>>

/** 専用 fetch 結果だけをスロットへ。C/D を他候補で埋めない。 */
export const assembleStrategySlotRoutes = (
  strategyFetches: StrategyFetchMap,
): StrategyRouteCandidate[] => {
  const kept: StrategyRouteCandidate[] = []

  for (const strategy of DISPLAY_STRATEGY_ORDER) {
    const route = strategyFetches[strategy]
    if (!canAssignStrategySlot(strategy, route, kept)) {
      continue
    }
    const assigned: StrategyRouteCandidate = {
      ...route!,
      routeStrategy: strategy,
      usesToll: routeUsesToll(route!),
    }
    kept.push(assigned)
  }

  return kept
}

/** 往復ペアの合計 meter で C をゲート（lp-site filterRoundTripPairsByShorterDistance）。 */
export const filterRoundTripPairsByShorterDistance = <
  T extends { strategy: string; totalDistanceMeters: number },
>(
  pairs: T[],
): T[] => {
  const list = pairs.slice()
  const timePair = list.find((pair) => pair.strategy === 'time_priority')
  const generalPair = list.find((pair) => pair.strategy === 'general_road_priority')
  const shorterPair = list.find((pair) => pair.strategy === 'shorter_distance')
  if (!shorterPair) {
    return list
  }
  const timeMeters = Number(timePair?.totalDistanceMeters) || 0
  const generalMeters = Number(generalPair?.totalDistanceMeters) || 0
  const shorterMeters = Number(shorterPair.totalDistanceMeters) || 0
  if (
    !timePair ||
    !generalPair ||
    !(shorterMeters > 0) ||
    !(shorterMeters < timeMeters) ||
    !(shorterMeters < generalMeters)
  ) {
    return list.filter((pair) => pair.strategy !== 'shorter_distance')
  }
  return list
}

/** A が無い場合に備えた選択フォールバック（lp-site ensureDefaultRouteSelection）。 */
export const ensureDefaultStrategySelection = <T extends { routeStrategy?: string; id?: string }>(
  candidates: T[],
  selectedIdOrStrategy: string,
): T | null => {
  if (!candidates.length) {
    return null
  }
  const selected = candidates.find(
    (item) =>
      item.id === selectedIdOrStrategy || item.routeStrategy === selectedIdOrStrategy,
  )
  if (selected) {
    return selected
  }
  return (
    candidates.find((item) => item.routeStrategy === 'time_priority' || item.id === 'A') ||
    candidates[0]
  )
}

/** 最低2件保証用の B 合成（lp-site buildGeneralRoadPriorityFallbackRoute）。 */
export const buildGeneralRoadPriorityFallbackRoute = (
  primaryRoute: StrategyRouteCandidate,
): StrategyRouteCandidate => ({
  ...primaryRoute,
  routeStrategy: 'general_road_priority',
  generationReason: 'general_road_priority_fallback',
  isSyntheticRoute: true,
  avoidHighways: true,
  avoidTolls: true,
})

export const ensureMinimumStrategyCandidates = (
  routes: StrategyRouteCandidate[],
): StrategyRouteCandidate[] => {
  const initial = routes.slice(0, 4)
  if (initial.length >= 2) {
    return initial
  }
  if (!initial.length) {
    return []
  }
  const primary: StrategyRouteCandidate = {
    ...initial[0],
    routeStrategy: initial[0].routeStrategy || 'time_priority',
  }
  return [primary, buildGeneralRoadPriorityFallbackRoute(primary)]
}

export const pickShorterDistanceRoute = (
  pool: StrategyRouteCandidate[],
  excludeRoutes: StrategyRouteCandidate[],
): StrategyRouteCandidate | null => {
  if (!pool.length) {
    return null
  }
  let minDistance = Infinity
  for (const route of pool) {
    const distance = Number(route.distanceMeters) || 0
    if (distance > 0 && distance < minDistance) {
      minDistance = distance
    }
  }
  if (!Number.isFinite(minDistance)) {
    return null
  }
  const shortestCandidates = pool.filter(
    (route) => Number(route.distanceMeters) === minDistance,
  )
  for (const candidate of shortestCandidates) {
    if (!isDuplicateOfAny(candidate, excludeRoutes)) {
      return {
        ...candidate,
        routeStrategy: 'shorter_distance',
      }
    }
  }
  return null
}
