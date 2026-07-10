import type { RoutePoint, PreFixedTripType } from '../types/preFixedMeterSession'
import { createRoutePoint } from './preFixedMeterSession'

export const buildSegmentsFromOrderedPoints = (
  _pickup: RoutePoint,
  orderedDestinations: RoutePoint[],
): { stops: RoutePoint[]; destination: RoutePoint } | null => {
  const destinations = orderedDestinations
    .map((point) => ({
      ...point,
      address: point.address.trim(),
      label: point.label.trim() || point.address.trim(),
    }))
    .filter((point) => point.address.length > 0)

  if (destinations.length === 0) {
    return null
  }

  if (destinations.length === 1) {
    return { stops: [], destination: destinations[0] }
  }

  return {
    stops: destinations.slice(0, -1),
    destination: destinations[destinations.length - 1],
  }
}

export const buildStopOrderLabels = (
  pickup: RoutePoint,
  orderedDestinations: RoutePoint[],
): string[] => {
  const pickupLabel = pickup.label.trim() || pickup.address.trim() || '出発地'
  const destLabels = orderedDestinations
    .filter((point) => point.address.trim())
    .map((point, index, list) => {
      const name = point.label.trim() || point.address.trim()
      if (index === list.length - 1 && list.length > 0) {
        return `最終目的地: ${name}`
      }
      return `目的地${index + 1}: ${name}`
    })

  return [`出発地: ${pickupLabel}`, ...destLabels]
}

export const clonePickupAsDestination = (savedPickup: RoutePoint): RoutePoint =>
  createRoutePoint({
    label: savedPickup.label.trim() || savedPickup.address.trim() || '出発地',
    address: savedPickup.address.trim(),
    facilityName: savedPickup.facilityName,
    lat: savedPickup.lat,
    lng: savedPickup.lng,
    source: savedPickup.source,
  })

export const resolveTripTypeFromPoints = (
  originPickup: RoutePoint,
  orderedDestinations: RoutePoint[],
): PreFixedTripType => {
  if (orderedDestinations.length <= 1) {
    const only = orderedDestinations[0]
    if (
      only &&
      originPickup.lat != null &&
      originPickup.lng != null &&
      only.lat != null &&
      only.lng != null &&
      Math.abs(originPickup.lat - only.lat) < 0.0001 &&
      Math.abs(originPickup.lng - only.lng) < 0.0001
    ) {
      return 'round_trip'
    }
    return 'one_way'
  }

  const last = orderedDestinations[orderedDestinations.length - 1]
  if (
    originPickup.lat != null &&
    originPickup.lng != null &&
    last.lat != null &&
    last.lng != null &&
    Math.abs(originPickup.lat - last.lat) < 0.0001 &&
    Math.abs(originPickup.lng - last.lng) < 0.0001
  ) {
    return 'round_trip'
  }

  return orderedDestinations.length > 1 ? 'with_stops' : 'one_way'
}

export const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}
