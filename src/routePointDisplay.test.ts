import { describe, expect, it } from 'vitest'
import {
  formatRoutePointOverviewLines,
  getRoutePointInputText,
  isCoordinatePairText,
  toSafeDisplayText,
} from './utils/routePointDisplay'
import { createRoutePoint } from './services/preFixedMeterSession'
import { isRoutePointResolved } from './services/resolveRoutePoint'

describe('routePointDisplay input helpers', () => {
  it('detects coordinate pair text', () => {
    expect(isCoordinatePairText('35.59768702841796,140.1137353410021')).toBe(true)
    expect(isCoordinatePairText('千葉メディカルセンター')).toBe(false)
  })

  it('keeps draft-like facility text for input value', () => {
    const drafting = createRoutePoint({
      address: '千葉メ',
      label: '千葉メ',
      facilityName: '千葉メ',
      source: 'manual',
    })
    expect(getRoutePointInputText(drafting)).toBe('千葉メ')
  })

  it('never puts 未設定 into input text for empty points', () => {
    const empty = createRoutePoint({ label: '', address: '', source: 'manual' })
    expect(empty.label).toBe('')
    expect(getRoutePointInputText(empty)).toBe('')
    expect(formatRoutePointOverviewLines(empty)).toEqual(['未設定'])
  })

  it('never returns coordinate text from toSafeDisplayText', () => {
    expect(toSafeDisplayText('35.1,140.2', '現在地（位置情報取得済み)')).toBe(
      '現在地（位置情報取得済み)',
    )
  })

  it('treats typed-only via without coords as unresolved', () => {
    const typedOnly = createRoutePoint({
      address: '千葉メディカルセンター',
      label: '千葉メディカルセンター',
      facilityName: '千葉メディカルセンター',
      source: 'manual',
    })
    expect(isRoutePointResolved(typedOnly)).toBe(false)
    expect(formatRoutePointOverviewLines(typedOnly)).toEqual(['未設定'])
  })

  it('resolves GPS points without placeId', () => {
    const gps = createRoutePoint({
      address: '千葉県千葉市中央区出洲港8-1',
      formattedAddress: '千葉県千葉市中央区出洲港8-1',
      label: '現在地',
      lat: 35.6,
      lng: 140.1,
      source: 'gps',
    })
    expect(isRoutePointResolved(gps)).toBe(true)
    expect(gps.placeId).toBeUndefined()
  })

  it('requires placeId for Places-selected points', () => {
    const withoutPlaceId = createRoutePoint({
      address: '千葉県千葉市中央区南町1丁目7-1',
      formattedAddress: '千葉県千葉市中央区南町1丁目7-1',
      label: '千葉メディカルセンター',
      facilityName: '千葉メディカルセンター',
      lat: 35.6,
      lng: 140.1,
      source: 'facility_search',
    })
    expect(isRoutePointResolved(withoutPlaceId)).toBe(false)

    const withPlaceId = createRoutePoint({
      ...withoutPlaceId,
      placeId: 'place-1',
      source: 'facility_search',
    })
    expect(isRoutePointResolved(withPlaceId)).toBe(true)
  })

  it('shows facility and address separately after place selection', () => {
    const selected = createRoutePoint({
      address: '千葉県千葉市中央区南町1丁目7-1',
      formattedAddress: '千葉県千葉市中央区南町1丁目7-1',
      label: '千葉メディカルセンター',
      facilityName: '千葉メディカルセンター',
      placeId: 'place-1',
      lat: 35.6,
      lng: 140.1,
      source: 'facility_search',
    })
    expect(isRoutePointResolved(selected)).toBe(true)
    expect(getRoutePointInputText(selected)).toBe('千葉メディカルセンター')
    expect(formatRoutePointOverviewLines(selected)).toEqual([
      '千葉メディカルセンター',
      '千葉県千葉市中央区南町1丁目7-1',
    ])
  })
})
