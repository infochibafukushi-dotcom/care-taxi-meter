import { describe, expect, it } from 'vitest'
import {
  buildRouteSegmentsFromPoints,
  isRenderableRouteCandidate,
  resolveTripTypeForCreateSession,
} from './services/preFixedCreateRoute'
import { createRoutePoint } from './services/preFixedMeterSession'
import { isRoutePointResolved } from './services/resolveRoutePoint'
import { formatRoutePointDisplayLines } from './utils/routePointDisplay'

const pickup = createRoutePoint({
  address: '出洲港',
  label: '出洲港',
  lat: 35.6,
  lng: 140.1,
  source: 'manual',
})
const hospital = createRoutePoint({
  address: '千葉メディカルセンター',
  label: '千葉メディカルセンター',
  lat: 35.62,
  lng: 140.12,
  source: 'manual',
})
const otherGoal = createRoutePoint({
  address: '千葉駅',
  label: '千葉駅',
  lat: 35.61,
  lng: 140.11,
  source: 'manual',
})

describe('buildRouteSegmentsFromPoints', () => {
  it('keeps origin, vias, and independent destination', () => {
    const segments = buildRouteSegmentsFromPoints({
      pickup,
      viaStops: [hospital],
      finalDestination: otherGoal,
    })
    expect(segments?.origin.address).toBe('出洲港')
    expect(segments?.stops).toHaveLength(1)
    expect(segments?.stops[0].address).toBe('千葉メディカルセンター')
    expect(segments?.destination.address).toBe('千葉駅')
  })

  it('supports return-to-origin when destination equals pickup', () => {
    const segments = buildRouteSegmentsFromPoints({
      pickup,
      viaStops: [hospital],
      finalDestination: pickup,
    })
    expect(segments?.origin.address).toBe(segments?.destination.address)
    expect(segments?.stops).toHaveLength(1)
  })

  it('rejects empty destination', () => {
    expect(
      buildRouteSegmentsFromPoints({
        pickup,
        viaStops: [hospital],
        finalDestination: createRoutePoint({ address: '', label: '', source: 'manual' }),
      }),
    ).toBeNull()
  })
})

describe('resolveTripTypeForCreateSession', () => {
  it('maps direct choice without link to one_way', () => {
    expect(
      resolveTripTypeForCreateSession({
        tripTypeChoice: 'one_way',
        destinationLinkedToPickup: false,
        viaCount: 0,
      }),
    ).toBe('one_way')
  })

  it('maps multi_stop choice without link to with_stops, not round_trip', () => {
    expect(
      resolveTripTypeForCreateSession({
        tripTypeChoice: 'round_or_via',
        destinationLinkedToPickup: false,
        viaCount: 1,
      }),
    ).toBe('with_stops')
  })

  it('maps destinationLinkedToPickup to round_trip only', () => {
    expect(
      resolveTripTypeForCreateSession({
        tripTypeChoice: 'round_or_via',
        destinationLinkedToPickup: true,
        viaCount: 1,
      }),
    ).toBe('round_trip')
    expect(
      resolveTripTypeForCreateSession({
        tripTypeChoice: 'one_way',
        destinationLinkedToPickup: true,
        viaCount: 0,
      }),
    ).toBe('round_trip')
  })

  it('gates fare display on polyline + positive distance/duration', () => {
    expect(
      isRenderableRouteCandidate({
        distanceMeters: 6600,
        durationSeconds: 1080,
        polyline: 'abc',
      }),
    ).toBe(true)
    expect(
      isRenderableRouteCandidate({
        distanceMeters: 6600,
        durationSeconds: 1080,
        polyline: '',
      }),
    ).toBe(false)
  })
})

describe('resolveRoutePoint helpers', () => {
  it('detects unresolved facility-only points', () => {
    const unresolved = createRoutePoint({
      address: '千葉メディカルセンター',
      label: '千葉メディカルセンター',
      facilityName: '千葉メディカルセンター',
      source: 'facility_search',
    })
    expect(isRoutePointResolved(unresolved)).toBe(false)
  })

  it('formats facility name and formal address on separate lines', () => {
    const point = createRoutePoint({
      address: '千葉県千葉市中央区...',
      label: '千葉メディカルセンター',
      facilityName: '千葉メディカルセンター',
      formattedAddress: '千葉県千葉市中央区...',
      lat: 35.6,
      lng: 140.1,
      source: 'facility_search',
    })
    const lines = formatRoutePointDisplayLines(point)
    expect(lines[0]).toContain('千葉メディカルセンター')
  })
})
