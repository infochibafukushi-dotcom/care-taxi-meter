import { describe, expect, it } from 'vitest'
import {
  ADDITIONAL_DISTANCE_KM,
  ADDITIONAL_FARE_YEN,
  INITIAL_DISTANCE_KM,
  INITIAL_FARE_YEN,
} from './constants/fareConstants'
import { basicFareSettings, calculateBasicFareYen } from './services/fare'
import {
  calculateSelectedServiceFeesYen,
  ensureMinimumRouteCandidates,
} from './services/preFixedRouteQuote'
import type { PreFixedRouteCandidate } from './types/preFixedMeterSession'
import { preFixedRouteCandidateLabels } from './types/preFixedMeterSession'

const sampleCandidate = (
  id: PreFixedRouteCandidate['id'],
  overrides: Partial<PreFixedRouteCandidate> = {},
): PreFixedRouteCandidate => ({
  id,
  label: preFixedRouteCandidateLabels[id],
  distanceMeters: 3300,
  durationSeconds: 540,
  fixedFareYen: 1620,
  serviceFeesYen: 0,
  totalYen: 1620,
  tollIncluded: false,
  polyline: 'encoded-path',
  ...overrides,
})

describe('ensureMinimumRouteCandidates', () => {
  it('returns A and B when only one route is available', () => {
    const single = [sampleCandidate('A')]
    const result = ensureMinimumRouteCandidates(single, 2)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('A')
    expect(result[1]?.id).toBe('B')
    expect(result[1]?.label).toBe('距離優先ルート')
    expect(result[1]?.polyline).toBe(single[0]?.polyline)
  })

  it('keeps distinct routes when two or more are available', () => {
    const routes = [
      sampleCandidate('A', { distanceMeters: 3300, polyline: 'route-a' }),
      sampleCandidate('B', { distanceMeters: 4100, polyline: 'route-b' }),
    ]
    const result = ensureMinimumRouteCandidates(routes, 2)
    expect(result).toHaveLength(2)
    expect(result[0]?.polyline).toBe('route-a')
    expect(result[1]?.polyline).toBe('route-b')
  })

  it('does not remove duplicate A/B when distances and fares match', () => {
    const routes = ensureMinimumRouteCandidates([sampleCandidate('A')], 2)
    expect(routes[0]?.fixedFareYen).toBe(routes[1]?.fixedFareYen)
    expect(routes[0]?.distanceMeters).toBe(routes[1]?.distanceMeters)
    expect(routes).toHaveLength(2)
  })
})

/**
 * 予約なし手動フロー・予約連携作成フローともに
 * calculatePreFixedRouteCandidates → calculateAdditionalRouteCandidates → calculateBasicFareYen
 * の同一パイプラインで運賃を算出する。
 */
describe('pre-fixed route fare pipeline (かんたん見積同等)', () => {
  it('uses tiered B-fare: initial distance and fare', () => {
    expect(calculateBasicFareYen(INITIAL_DISTANCE_KM, basicFareSettings)).toBe(INITIAL_FARE_YEN)
    expect(calculateBasicFareYen(INITIAL_DISTANCE_KM - 0.01, basicFareSettings)).toBe(
      INITIAL_FARE_YEN,
    )
  })

  it('uses tiered B-fare: additional segments with ceil rounding', () => {
    const oneSegmentOver =
      INITIAL_DISTANCE_KM + ADDITIONAL_DISTANCE_KM * 0.01
    expect(calculateBasicFareYen(oneSegmentOver, basicFareSettings)).toBe(
      INITIAL_FARE_YEN + ADDITIONAL_FARE_YEN,
    )

    const twoSegments =
      INITIAL_DISTANCE_KM + ADDITIONAL_DISTANCE_KM * 1.5
    expect(calculateBasicFareYen(twoSegments, basicFareSettings)).toBe(
      INITIAL_FARE_YEN + ADDITIONAL_FARE_YEN * 2,
    )
  })

  it('does not apply simple distance-times-unit formula', () => {
    const distanceKm = 5.0
    const tiered = calculateBasicFareYen(distanceKm, basicFareSettings)
    const naivePerKm = Math.round(distanceKm * 100)
    expect(tiered).not.toBe(naivePerKm)
    expect(tiered).toBe(INITIAL_FARE_YEN + Math.ceil((distanceKm - INITIAL_DISTANCE_KM) / ADDITIONAL_DISTANCE_KM) * ADDITIONAL_FARE_YEN)
  })

  it('matches manual and reservation quote fare for the same route distance', () => {
    const distanceKm = 8.3
    const manualFlowFare = calculateBasicFareYen(distanceKm, basicFareSettings)
    const reservationCreateFare = calculateBasicFareYen(distanceKm, basicFareSettings)
    expect(manualFlowFare).toBe(reservationCreateFare)
  })

  it('excludes service fees from route fare when includeServiceFees is false', () => {
    const serviceFees = calculateSelectedServiceFeesYen([
      { id: 'boardingAssist', name: '乗降介助', amount: 1100, enabled: true, sortOrder: 1 },
    ])
    const routeFare = calculateBasicFareYen(3.5, basicFareSettings)
    expect(serviceFees).toBe(1100)
    expect(routeFare).toBeGreaterThan(0)
    expect(routeFare).not.toBe(routeFare + serviceFees)
  })
})

describe('multi-stop total distance handling', () => {
  it('sums leg distances before tiered fare (same as Directions API leg reduce)', () => {
    const leg1Km = 2.1
    const leg2Km = 3.4
    const totalKm = leg1Km + leg2Km
    const fareFromTotal = calculateBasicFareYen(totalKm, basicFareSettings)
    const fareFromLegsSeparate = calculateBasicFareYen(leg1Km, basicFareSettings) + calculateBasicFareYen(leg2Km, basicFareSettings)
    expect(fareFromTotal).not.toBe(fareFromLegsSeparate)
    expect(fareFromTotal).toBe(
      calculateBasicFareYen(5.5, basicFareSettings),
    )
  })
})
