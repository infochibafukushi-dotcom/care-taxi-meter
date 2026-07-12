import { describe, expect, it } from 'vitest'
import { normalizeDirectionsRoute, extractEncodedPolyline } from './services/preFixedFareRoute'
import { encodePolyline } from './utils/polylinePath'

describe('normalizeDirectionsRoute legs', () => {
  it('sums all legs and keeps each leg polyline', () => {
    const outbound = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.62, lng: 140.12 },
    ])
    const inbound = encodePolyline([
      { lat: 35.62, lng: 140.12 },
      { lat: 35.6, lng: 140.1 },
    ])
    const overview = encodePolyline([
      { lat: 35.6, lng: 140.1 },
      { lat: 35.62, lng: 140.12 },
      { lat: 35.6, lng: 140.1 },
    ])

    const normalized = normalizeDirectionsRoute({
      overview_polyline: overview,
      summary: 'test',
      legs: [
        {
          distance: { value: 3500 },
          duration: { value: 500 },
          steps: [{ polyline: outbound }],
        },
        {
          distance: { value: 3400 },
          duration: { value: 480 },
          steps: [{ polyline: inbound }],
        },
      ],
    })

    expect(normalized).not.toBeNull()
    expect(normalized?.routeLegs).toHaveLength(2)
    expect(normalized?.distanceMeters).toBe(6900)
    expect(normalized?.durationSeconds).toBe(980)
    expect(normalized?.routeLegs[0].encodedPolyline).toBeTruthy()
    expect(normalized?.routeLegs[1].encodedPolyline).toBeTruthy()
    expect(normalized?.combinedPointCount).toBeGreaterThan(2)
  })

  it('accepts string overview_polyline', () => {
    expect(extractEncodedPolyline('abc')).toBe('abc')
  })
})
