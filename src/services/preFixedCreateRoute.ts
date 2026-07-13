import type { RoutePoint, PreFixedTripType } from '../types/preFixedMeterSession'
import { createRoutePoint } from './preFixedMeterSession'
import { isRoutePointResolved } from './resolveRoutePoint'

/** 作成フローの送迎タイプ選択。互換のためキーは維持し、意味は direct / multi_stop。 */
export type PreFixedCreateTripTypeChoice = 'one_way' | 'round_or_via'

export type PreFixedCreateRouteType = 'direct' | 'multi_stop'

export const toCreateRouteType = (
  tripTypeChoice: PreFixedCreateTripTypeChoice,
): PreFixedCreateRouteType => (tripTypeChoice === 'round_or_via' ? 'multi_stop' : 'direct')

export const buildRouteSegmentsFromPoints = ({
  pickup,
  viaStops,
  finalDestination,
}: {
  pickup: RoutePoint
  viaStops: RoutePoint[]
  finalDestination: RoutePoint
}) => {
  const pickupAddress = pickup.address.trim()
  if (!pickupAddress) {
    return null
  }

  const vias = viaStops
    .map((point) => ({
      ...point,
      address: point.address.trim(),
      label: point.label.trim() || point.address.trim(),
    }))
    .filter((point) => point.address.length > 0)

  const destinationAddress = finalDestination.address.trim()
  if (!destinationAddress) {
    return null
  }

  return {
    origin: createRoutePoint({
      ...pickup,
      address: pickupAddress,
      label: pickup.label.trim() || pickup.facilityName?.trim() || pickupAddress,
      source: pickup.source,
    }),
    stops: vias,
    destination: createRoutePoint({
      ...finalDestination,
      address: destinationAddress,
      label:
        finalDestination.label.trim() ||
        finalDestination.facilityName?.trim() ||
        destinationAddress,
      source: finalDestination.source,
    }),
  }
}

/**
 * session.tripType 解決。
 * routeType（直行/経由）と returnToOrigin（G=S）を分離する。
 * 経由あり選択だけでは round_trip にしない。
 */
export const resolveTripTypeForCreateSession = ({
  tripTypeChoice,
  destinationLinkedToPickup,
  viaCount,
}: {
  tripTypeChoice: PreFixedCreateTripTypeChoice
  destinationLinkedToPickup: boolean
  viaCount: number
}): PreFixedTripType => {
  if (destinationLinkedToPickup) {
    return 'round_trip'
  }
  if (tripTypeChoice === 'round_or_via' || viaCount > 0) {
    return 'with_stops'
  }
  return 'one_way'
}

export const areCreateRoutePointsReady = ({
  pickup,
  viaStops,
  finalDestination,
}: {
  pickup: RoutePoint
  viaStops: RoutePoint[]
  finalDestination: RoutePoint
}) => {
  if (!isRoutePointResolved(pickup) || !isRoutePointResolved(finalDestination)) {
    return false
  }
  return viaStops.every((stop) => !stop.address.trim() || isRoutePointResolved(stop))
}

export const isRenderableRouteCandidate = (candidate: {
  distanceMeters?: number
  durationSeconds?: number
  polyline?: string
  routeLegs?: Array<{ encodedPolyline?: string }>
}) => {
  const hasPolyline =
    Boolean(candidate.polyline?.trim()) ||
    (Array.isArray(candidate.routeLegs) &&
      candidate.routeLegs.some((leg) => Boolean(leg.encodedPolyline?.trim())))
  return (
    Number(candidate.distanceMeters) > 0 &&
    Number(candidate.durationSeconds) > 0 &&
    hasPolyline
  )
}
