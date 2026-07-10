import { describe, expect, it } from 'vitest'
import { decodeEncodedPolyline, decodePolylinePath } from './polyline'

// Google sample polyline for path from (38.5,-120.2) to (40.7,-120.95) to (43.252,-126.453)
const SAMPLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

describe('decodeEncodedPolyline', () => {
  it('decodes an encoded polyline into lat/lng points', () => {
    const path = decodeEncodedPolyline(SAMPLE_POLYLINE)
    expect(path.length).toBeGreaterThan(1)
    expect(path[0]?.lat).toBeCloseTo(38.5, 1)
    expect(path[0]?.lng).toBeCloseTo(-120.2, 1)
  })

  it('returns empty array for blank input via decodePolylinePath', () => {
    expect(decodePolylinePath('')).toEqual([])
    expect(decodePolylinePath('   ')).toEqual([])
  })

  it('falls back to manual decode when google decoder is unavailable', () => {
    const path = decodePolylinePath(SAMPLE_POLYLINE)
    expect(path.length).toBeGreaterThan(1)
  })

  it('uses google decoder when provided', () => {
    const googlePath = [
      { lat: 35.0, lng: 139.0 },
      { lat: 35.1, lng: 139.1 },
    ]
    const path = decodePolylinePath(SAMPLE_POLYLINE, () => googlePath)
    expect(path).toEqual(googlePath)
  })
})
