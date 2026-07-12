import { describe, expect, it } from 'vitest'
import { decodePolyline } from './utils/decodePolyline'
import {
  buildRouteSegmentsFromPoints,
  isRenderableRouteCandidate,
  resolveTripTypeForCreateSession,
} from './services/preFixedCreateRoute'
import { createRoutePoint } from './services/preFixedMeterSession'
import {
  cloneRoutePoint,
  formatRoutePointDisplayLines,
  isRoutePointResolved,
} from './services/resolveRoutePoint'

describe('decodePolyline', () => {
  it('decodes a known encoded polyline into multiple points', () => {
    // Google sample-ish short polyline around Tokyo
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(points.length).toBeGreaterThan(1)
    expect(points[0].lat).toBeCloseTo(38.5, 1)
    expect(points[0].lng).toBeCloseTo(-120.2, 1)
  })
})

describe('preFixedCreateRoute helpers', () => {
  const pickup = createRoutePoint({
    address: '千葉市中央区出洲港8-2-2',
    label: '自宅',
    lat: 35.6,
    lng: 140.1,
    placeId: 'pickup-place',
    source: 'manual',
  })

  const hospital = createRoutePoint({
    address: '千葉県千葉市中央区南町1丁目7-1',
    label: '千葉メディカルセンター',
    facilityName: '千葉メディカルセンター',
    formattedAddress: '千葉県千葉市中央区南町1丁目7-1',
    lat: 35.61,
    lng: 140.12,
    placeId: 'hospital-place',
    source: 'facility_search',
  })

  it('builds origin → via → destination for round trip home-hospital-home', () => {
    const segments = buildRouteSegmentsFromPoints({
      pickup,
      viaStops: [hospital],
      finalDestination: cloneRoutePoint(pickup),
    })

    expect(segments).not.toBeNull()
    expect(segments?.origin.address).toBe(pickup.address)
    expect(segments?.origin.placeId).toBe('pickup-place')
    expect(segments?.stops).toHaveLength(1)
    expect(segments?.stops[0].placeId).toBe('hospital-place')
    expect(segments?.destination.address).toBe(pickup.address)
    expect(segments?.destination.lat).toBe(pickup.lat)
    expect(segments?.destination.placeId).toBe('pickup-place')
  })

  it('requires pickup and final destination address', () => {
    expect(
      buildRouteSegmentsFromPoints({
        pickup: createRoutePoint({ address: '', label: '', source: 'manual' }),
        viaStops: [hospital],
        finalDestination: cloneRoutePoint(pickup),
      }),
    ).toBeNull()
    expect(
      buildRouteSegmentsFromPoints({
        pickup,
        viaStops: [hospital],
        finalDestination: createRoutePoint({ address: '', label: '', source: 'manual' }),
      }),
    ).toBeNull()
  })

  it('resolves trip type for linked destination as round_trip', () => {
    expect(
      resolveTripTypeForCreateSession({
        tripTypeChoice: 'round_or_via',
        destinationLinkedToPickup: true,
        viaCount: 1,
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
    const resolved = createRoutePoint({
      address: '千葉県千葉市中央区南町1丁目7-1',
      label: '千葉メディカルセンター',
      facilityName: '千葉メディカルセンター',
      formattedAddress: '千葉県千葉市中央区南町1丁目7-1',
      lat: 35.61,
      lng: 140.12,
      source: 'facility_search',
    })
    expect(formatRoutePointDisplayLines(resolved)).toEqual([
      '千葉メディカルセンター',
      '千葉県千葉市中央区南町1丁目7-1',
    ])
  })

  it('never displays raw latitude/longitude text', () => {
    const gpsWithAddress = createRoutePoint({
      address: '千葉県千葉市中央区出洲港8-2-2',
      formattedAddress: '千葉県千葉市中央区出洲港8-2-2',
      label: '現在地',
      facilityName: '現在地',
      lat: 35.59768702841796,
      lng: 140.1137353410021,
      source: 'gps',
    })
    const lines = formatRoutePointDisplayLines(gpsWithAddress)
    expect(lines.join(' ')).not.toMatch(/35\.597/)
    expect(lines.join(' ')).not.toMatch(/140\.113/)
    expect(lines).toContain('千葉県千葉市中央区出洲港8-2-2')
  })

  it('shows 未設定 when GPS has coordinates but no address yet', () => {
    const gpsOnly = createRoutePoint({
      address: '',
      label: '現在地',
      lat: 35.59768702841796,
      lng: 140.1137353410021,
      source: 'gps',
    })
    expect(formatRoutePointDisplayLines(gpsOnly)).toEqual(['未設定'])
    expect(isRoutePointResolved(gpsOnly)).toBe(false)
  })

  it('clones all location fields for 出発地と同じ', () => {
    const pickup = createRoutePoint({
      address: '千葉市中央区出洲港8-2-2',
      label: '自宅',
      formattedAddress: '千葉県千葉市中央区出洲港8-2-2',
      placeId: 'abc',
      lat: 35.6,
      lng: 140.1,
      source: 'gps',
    })
    const copied = cloneRoutePoint(pickup)
    expect(copied).toEqual(pickup)
    expect(copied).not.toBe(pickup)
  })
})
