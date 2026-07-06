import { basicFareSettings, calculateBasicFareYen, type AssistItem } from './fare'
import { calculateAdditionalRouteCandidates } from './preFixedFareRoute'
import type { RoutePoint, PreFixedRouteCandidate, PreFixedRouteCandidateId } from '../types/preFixedMeterSession'
import { preFixedRouteCandidateLabels } from '../types/preFixedMeterSession'

const ROUTE_IDS: PreFixedRouteCandidateId[] = ['A', 'B', 'C', 'D']

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
}: {
  pickup: RoutePoint
  stops: RoutePoint[]
  destination: RoutePoint
  serviceItems: AssistItem[]
}): Promise<PreFixedRouteCandidate[]> {
  const origin = toWaypointInput(pickup)
  const waypoints = stops.map(toWaypointInput)
  const dest = toWaypointInput(destination)
  const serviceFeesYen = calculateSelectedServiceFeesYen(serviceItems)

  const rawCandidates = await calculateAdditionalRouteCandidates({
    origin,
    waypoints,
    destination: dest,
    fareSettings: basicFareSettings,
  })

  const sortedByDistance = [...rawCandidates].sort((a, b) => a.distanceKm - b.distanceKm)
  const sortedByDuration = [...rawCandidates].sort((a, b) => a.durationSeconds - b.durationSeconds)

  const pickUnique = (primary: typeof rawCandidates[0] | undefined, ...fallbacks: Array<typeof rawCandidates[0] | undefined>) => {
    for (const candidate of [primary, ...fallbacks]) {
      if (candidate) {
        return candidate
      }
    }
    return rawCandidates[0]
  }

  const recommended = rawCandidates[0]
  const shortest = sortedByDistance[0]
  const fastest = sortedByDuration[0]
  const alternative =
    rawCandidates.find((item) => item.id !== recommended?.id && item.id !== shortest?.id) ??
    rawCandidates[rawCandidates.length - 1]

  const sourceMap: Array<typeof rawCandidates[0] | undefined> = [
    pickUnique(recommended, shortest, fastest, alternative),
    pickUnique(shortest, recommended, fastest, alternative),
    pickUnique(fastest, recommended, shortest, alternative),
    pickUnique(alternative, recommended, shortest, fastest),
  ]

  return ROUTE_IDS.map((id, index) => {
    const source = sourceMap[index] ?? rawCandidates[0]
    const distanceMeters = Math.round(Math.max(source.distanceKm, 0.1) * 1000)
    const durationSeconds = Math.max(source.durationSeconds, 60)
    const fixedFareYen = calculateBasicFareYen(source.distanceKm, basicFareSettings)

    return {
      id,
      label: preFixedRouteCandidateLabels[id],
      distanceMeters,
      durationSeconds,
      fixedFareYen,
      serviceFeesYen,
      totalYen: fixedFareYen + serviceFeesYen,
      tollIncluded: source.useToll,
    } satisfies PreFixedRouteCandidate
  })
}

export const formatRouteDurationLabel = (durationSeconds: number) => {
  const minutes = Math.max(Math.round(durationSeconds / 60), 1)
  return `約${minutes}分`
}
