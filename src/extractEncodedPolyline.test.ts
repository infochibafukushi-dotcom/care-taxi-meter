import { describe, expect, it } from 'vitest'
import { extractEncodedPolyline } from './services/preFixedFareRoute'

describe('extractEncodedPolyline', () => {
  it('uses string overview_polyline as encoded polyline', () => {
    expect(extractEncodedPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toBe(
      '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    )
  })

  it('uses legacy { points: string } overview_polyline', () => {
    expect(extractEncodedPolyline({ points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' })).toBe(
      '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    )
  })

  it('excludes empty string overview_polyline', () => {
    expect(extractEncodedPolyline('')).toBeUndefined()
    expect(extractEncodedPolyline('   ')).toBeUndefined()
  })

  it('excludes undefined / invalid overview_polyline', () => {
    expect(extractEncodedPolyline(undefined)).toBeUndefined()
    expect(extractEncodedPolyline(null)).toBeUndefined()
    expect(extractEncodedPolyline({ points: '' })).toBeUndefined()
    expect(extractEncodedPolyline({ points: 123 })).toBeUndefined()
    expect(extractEncodedPolyline(42)).toBeUndefined()
  })
})
