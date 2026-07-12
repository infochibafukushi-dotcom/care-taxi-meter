import { describe, expect, it } from 'vitest'
import {
  assembleStrategySlotRoutes,
  canAssignStrategySlot,
  ensureDefaultStrategySelection,
  ensureMinimumStrategyCandidates,
  filterRoundTripPairsByShorterDistance,
  isDuplicateRoute,
  isStrictlyShorterThanCoreRoutes,
  type StrategyRouteCandidate,
} from './services/preFixedRouteStrategySelection'
import {
  concatLegPaths,
  encodePolyline,
  pathFromRouteLegs,
} from './utils/polylinePath'
import { decodePolyline } from './utils/decodePolyline'

const baseRoute = (
  overrides: Partial<StrategyRouteCandidate> &
    Pick<StrategyRouteCandidate, 'routeStrategy' | 'distanceMeters' | 'encodedPolyline'>,
): StrategyRouteCandidate => ({
  durationSeconds: 600,
  routeLegs: [
    {
      legIndex: 0,
      distanceMeters: overrides.distanceMeters,
      durationSeconds: 600,
      encodedPolyline: overrides.encodedPolyline,
    },
  ],
  avoidHighways: false,
  avoidTolls: false,
  routingPreference: 'TRAFFIC_AWARE',
  ...overrides,
})

describe('preFixed route strategy selection (lp-site parity)', () => {
  it('keeps A/B even when polyline and meters match', () => {
    const poly = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.61, lng: 140.11 },
    ])
    const a = baseRoute({
      routeStrategy: 'time_priority',
      distanceMeters: 6900,
      encodedPolyline: poly,
    })
    const b = baseRoute({
      routeStrategy: 'general_road_priority',
      distanceMeters: 6900,
      encodedPolyline: poly,
      avoidHighways: true,
      avoidTolls: true,
    })
    const assembled = assembleStrategySlotRoutes({
      time_priority: a,
      general_road_priority: b,
      shorter_distance: a,
      toll_allowed: a,
    })
    expect(assembled.map((route) => route.routeStrategy)).toEqual([
      'time_priority',
      'general_road_priority',
    ])
  })

  it('hides C when distanceMeters is not strictly shorter than A and B', () => {
    const polyA = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.61, lng: 140.12 },
    ])
    const polyC = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.605, lng: 140.11 },
      { lat: 35.61, lng: 140.12 },
    ])
    const a = baseRoute({
      routeStrategy: 'time_priority',
      distanceMeters: 6900,
      encodedPolyline: polyA,
    })
    const b = baseRoute({
      routeStrategy: 'general_road_priority',
      distanceMeters: 7000,
      encodedPolyline: polyA,
      avoidHighways: true,
      avoidTolls: true,
    })
    const c = baseRoute({
      routeStrategy: 'shorter_distance',
      distanceMeters: 6900,
      encodedPolyline: polyC,
    })
    expect(isStrictlyShorterThanCoreRoutes(c, [a, b])).toBe(false)
    expect(canAssignStrategySlot('shorter_distance', c, [a, b])).toBe(false)
  })

  it('shows C when non-duplicate and strictly shorter than A and B', () => {
    const polyA = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.62, lng: 140.14 },
    ])
    const polyC = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.61, lng: 140.11 },
    ])
    const a = baseRoute({
      routeStrategy: 'time_priority',
      distanceMeters: 8000,
      encodedPolyline: polyA,
    })
    const b = baseRoute({
      routeStrategy: 'general_road_priority',
      distanceMeters: 8200,
      encodedPolyline: polyA,
      avoidHighways: true,
      avoidTolls: true,
    })
    const c = baseRoute({
      routeStrategy: 'shorter_distance',
      distanceMeters: 7000,
      encodedPolyline: polyC,
    })
    const assembled = assembleStrategySlotRoutes({
      time_priority: a,
      general_road_priority: b,
      shorter_distance: c,
      toll_allowed: null,
    })
    expect(assembled.map((route) => route.routeStrategy)).toEqual([
      'time_priority',
      'general_road_priority',
      'shorter_distance',
    ])
  })

  it('hides D when toll is not actually used', () => {
    const poly = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.7, lng: 140.2 },
    ])
    const a = baseRoute({
      routeStrategy: 'time_priority',
      distanceMeters: 10000,
      encodedPolyline: poly,
    })
    const b = baseRoute({
      routeStrategy: 'general_road_priority',
      distanceMeters: 11000,
      encodedPolyline: encodePolyline([
        { lat: 35.6, lng: 140.1 },
        { lat: 35.65, lng: 140.15 },
      ]),
      avoidHighways: true,
      avoidTolls: true,
    })
    const d = baseRoute({
      routeStrategy: 'toll_allowed',
      distanceMeters: 9000,
      encodedPolyline: encodePolyline([
        { lat: 35.6, lng: 140.1 },
        { lat: 35.66, lng: 140.18 },
      ]),
    })
    expect(canAssignStrategySlot('toll_allowed', d, [a, b])).toBe(false)
  })

  it('treats identical polyline as duplicate even across fingerprints', () => {
    const poly = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.61, lng: 140.11 },
    ])
    const left = baseRoute({
      routeStrategy: 'time_priority',
      distanceMeters: 5000,
      encodedPolyline: poly,
      avoidTolls: false,
    })
    const right = baseRoute({
      routeStrategy: 'shorter_distance',
      distanceMeters: 4800,
      encodedPolyline: poly,
      avoidTolls: true,
      routingPreference: 'TRAFFIC_UNAWARE',
    })
    expect(isDuplicateRoute(left, right)).toBe(true)
  })

  it('falls back selection to A when selected C is removed', () => {
    const poly = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.61, lng: 140.11 },
    ])
    const candidates = ensureMinimumStrategyCandidates([
      baseRoute({
        routeStrategy: 'time_priority',
        distanceMeters: 6900,
        encodedPolyline: poly,
      }),
    ]).map((route, index) => ({
      id: index === 0 ? 'A' : 'B',
      routeStrategy: route.routeStrategy,
    }))
    const resolved = ensureDefaultStrategySelection(candidates, 'C')
    expect(resolved?.id).toBe('A')
  })

  it('gates round-trip C by totalDistanceMeters not display km', () => {
    const pairs = filterRoundTripPairsByShorterDistance([
      { strategy: 'time_priority', totalDistanceMeters: 14000 },
      { strategy: 'general_road_priority', totalDistanceMeters: 15000 },
      { strategy: 'shorter_distance', totalDistanceMeters: 14000 },
    ])
    expect(pairs.map((pair) => pair.strategy)).toEqual([
      'time_priority',
      'general_road_priority',
    ])
  })
})

describe('round-trip leg polyline concat', () => {
  it('keeps outbound and return paths without overwriting', () => {
    const outbound = [
      { lat: 35.6, lng: 140.1 },
      { lat: 35.61, lng: 140.11 },
      { lat: 35.62, lng: 140.12 },
    ]
    const inbound = [
      { lat: 35.62, lng: 140.12 },
      { lat: 35.61, lng: 140.105 },
      { lat: 35.6, lng: 140.1 },
    ]
    const combined = concatLegPaths([outbound, inbound])
    expect(combined[0]).toEqual(outbound[0])
    expect(combined[combined.length - 1]).toEqual(inbound[inbound.length - 1])
    expect(combined.length).toBe(outbound.length + inbound.length - 1)
  })

  it('pathFromRouteLegs prefers concatenated legs over overview alone', () => {
    const outbound = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.62, lng: 140.12 },
    ])
    const inbound = encodePolyline([
      { lat: 35.62, lng: 140.12 },
      { lat: 35.6, lng: 140.1 },
    ])
    const overviewOnly = encodePolyline([
      { lat: 35.62, lng: 140.12 },
      { lat: 35.6, lng: 140.1 },
    ])
    const path = pathFromRouteLegs(
      [
        { encodedPolyline: outbound },
        { encodedPolyline: inbound },
      ],
      overviewOnly,
    )
    expect(path.length).toBeGreaterThan(decodePolyline(overviewOnly).length)
    expect(path[0]).toEqual({ lat: 35.6, lng: 140.1 })
    expect(path[path.length - 1]).toEqual({ lat: 35.6, lng: 140.1 })
  })
})
