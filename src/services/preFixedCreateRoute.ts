import type { RoutePoint, PreFixedTripType } from '../types/preFixedMeterSession'
import { createRoutePoint } from './preFixedMeterSession'
import { isRoutePointResolved } from './resolveRoutePoint'

export type PreFixedCreateTripTypeChoice = 'one_way' | 'round_or_via'

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

export const resolveTripTypeForCreateSession = ({
  tripTypeChoice,
  destinationLinkedToPickup,
  viaCount,
}: {
  tripTypeChoice: PreFixedCreateTripTypeChoice
  destinationLinkedToPickup: boolean
  viaCount: number
}): PreFixedTripType => {
  if (tripTypeChoice === 'one_way') {
    return viaCount > 0 ? 'with_stops' : 'one_way'
  }
  if (destinationLinkedToPickup) {
    return 'round_trip'
  }
  return viaCount > 0 ? 'with_stops' : 'one_way'
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
