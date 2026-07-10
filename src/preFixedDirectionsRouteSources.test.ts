import { describe, expect, it } from 'vitest'
import { calculatePreFixedDirectionsRouteSources } from './services/preFixedFareRoute'

describe('calculatePreFixedDirectionsRouteSources fallback', () => {
  it('returns at least A and B sources when Directions API is unavailable', async () => {
    const sources = await calculatePreFixedDirectionsRouteSources({
      origin: { address: '千葉駅', latitude: 35.6129, longitude: 140.1146 },
      waypoints: [],
      destination: { address: '東京駅', latitude: 35.6812, longitude: 139.7671 },
    })

    expect(sources.length).toBeGreaterThanOrEqual(2)
    expect(sources[0]?.distanceKm).toBeGreaterThan(0)
    expect(sources[1]?.distanceKm).toBeGreaterThan(0)
  })
})
