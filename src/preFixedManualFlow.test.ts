import { describe, expect, it } from 'vitest'
import {
  buildDefaultFareSelection,
  calculateManualPreFixedServiceYen,
  calculateManualPreFixedTotalYen,
  buildServiceFeesFromManualSelection,
} from './services/preFixedManualFare'
import {
  buildSegmentsFromOrderedPoints,
  clonePickupAsDestination,
  resolveTripTypeFromPoints,
} from './services/preFixedManualRoute'
import { createRoutePoint } from './services/preFixedMeterSession'
import {
  calculatePrepaidWaitingEscortBillableYen,
  waitingFareSettings,
} from './services/fare'
import { preFixedRouteCandidateLabels } from './types/preFixedMeterSession'
import type { PreFixedManualFareSelection } from './types/preFixedMeterSession'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const baseSelection = (): PreFixedManualFareSelection => ({
  dispatchEnabled: true,
  dispatchFareYen: 800,
  specialVehicleEnabled: true,
  specialVehicleFareYen: 1000,
  boardingAssist: true,
  boardingAssistFareYen: 1100,
  bodyAssist: false,
  bodyAssistFareYen: 0,
  stairsAssist: true,
  stairFloorId: 'stair-floor3',
  stairFloorLabel: '3階',
  stairAssistFareYen: 5000,
  equipmentItems: [{ id: 'ownWheelchair', name: '利用者所有の車いす', amountYen: 0 }],
  waitingEscortPlan: 'both',
  waitingFirstUnitYen: 800,
  escortFirstUnitYen: 1600,
  waitingUnitSeconds: 1800,
  escortUnitSeconds: 1800,
  waitingUnitFareYen: 800,
  escortUnitFareYen: 1600,
})

describe('calculateManualPreFixedTotalYen', () => {
  it('sums route fare and selected fees including waiting and escort first units', () => {
    const total = calculateManualPreFixedTotalYen({
      routeFareYen: 2500,
      selection: baseSelection(),
    })
    expect(total).toBe(2500 + 800 + 1000 + 1100 + 5000 + 800 + 1600)
  })
})

describe('buildServiceFeesFromManualSelection', () => {
  it('includes waiting and escort prepaid keys', () => {
    const fees = buildServiceFeesFromManualSelection(baseSelection())
    expect(fees.some((fee) => fee.key === 'waiting30min')).toBe(true)
    expect(fees.some((fee) => fee.key === 'escort30min')).toBe(true)
    expect(fees.some((fee) => fee.key === 'ownWheelchair')).toBe(true)
  })
})

describe('preFixedManualRoute', () => {
  it('builds round trip segments when final destination matches pickup coordinates', () => {
    const pickup = createRoutePoint({
      address: '自宅',
      label: '自宅',
      lat: 35.1,
      lng: 139.1,
      source: 'gps',
    })
    const hospital = createRoutePoint({
      address: '病院',
      label: '病院',
      lat: 35.2,
      lng: 139.2,
      source: 'manual',
    })
    const homeAgain = clonePickupAsDestination(pickup)
    const segments = buildSegmentsFromOrderedPoints(pickup, [hospital, homeAgain])
    expect(segments?.stops).toHaveLength(1)
    expect(segments?.destination.address).toBe('自宅')
    expect(resolveTripTypeFromPoints(pickup, [hospital, homeAgain])).toBe('round_trip')
  })
})

describe('calculatePrepaidWaitingEscortBillableYen', () => {
  const settings = waitingFareSettings

  it('does not double-charge the first 30 minutes when prepaid', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(1, settings, 1)).toBe(0)
    expect(calculatePrepaidWaitingEscortBillableYen(1800, settings, 1)).toBe(0)
  })

  it('adds the next unit after 30 minutes and 1 second', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(1801, settings, 1)).toBe(settings.unitFareYen)
    expect(calculatePrepaidWaitingEscortBillableYen(3601, settings, 1)).toBe(settings.unitFareYen * 2)
  })

  it('bills waiting and escort independently with separate prepaid units', () => {
    const waitingBillable = calculatePrepaidWaitingEscortBillableYen(1801, settings, 1)
    const escortBillable = calculatePrepaidWaitingEscortBillableYen(3601, settings, 1)
    expect(waitingBillable).toBe(settings.unitFareYen)
    expect(escortBillable).toBe(settings.unitFareYen * 2)
    expect(waitingBillable).not.toBe(escortBillable)
  })

  it('starts billing from second 1 when no prepaid unit', () => {
    expect(calculatePrepaidWaitingEscortBillableYen(1, settings, 0)).toBe(settings.unitFareYen)
  })
})

describe('manual flow route labels', () => {
  it('uses A-D labels matching かんたん見積もり', () => {
    expect(preFixedRouteCandidateLabels.A).toBe('時間優先')
    expect(preFixedRouteCandidateLabels.B).toBe('一般道優先')
    expect(preFixedRouteCandidateLabels.C).toBe('距離優先')
    expect(preFixedRouteCandidateLabels.D).toBe('有料道路優先')
  })
})

describe('buildDefaultFareSelection automatic fees', () => {
  const waitingFare = waitingFareSettings
  const escortFare = { ...waitingFareSettings, unitFareYen: 1600 }

  it('enables reserved pickup when dispatch item is enabled', () => {
    const selection = buildDefaultFareSelection({
      dispatchItem: { id: 'reservedPickup', name: '予約迎車', amount: 800, enabled: true, sortOrder: 1 },
      specialVehicleItem: { id: 'oneBoxLift', name: '1BOXリフト車両', amount: 1000, enabled: true, sortOrder: 1 },
      waitingFare,
      escortFare,
      vehicleEligible: false,
    })
    expect(selection.dispatchEnabled).toBe(true)
    expect(selection.dispatchFareYen).toBe(800)
    expect(selection.specialVehicleEnabled).toBe(false)
  })

  it('enables special vehicle fee when vehicle is eligible', () => {
    const selection = buildDefaultFareSelection({
      dispatchItem: { id: 'reservedPickup', name: '予約迎車', amount: 800, enabled: true, sortOrder: 1 },
      specialVehicleItem: { id: 'oneBoxLift', name: '1BOXリフト車両', amount: 1000, enabled: true, sortOrder: 1 },
      waitingFare,
      escortFare,
      vehicleEligible: true,
    })
    expect(selection.specialVehicleEnabled).toBe(true)
    expect(selection.specialVehicleFareYen).toBe(1000)
  })

  it('keeps special vehicle off when vehicle is not eligible', () => {
    const selection = buildDefaultFareSelection({
      specialVehicleItem: { id: 'oneBoxLift', name: '1BOXリフト車両', amount: 1000, enabled: true, sortOrder: 1 },
      waitingFare,
      escortFare,
      vehicleEligible: false,
    })
    expect(selection.specialVehicleEnabled).toBe(false)
    expect(selection.specialVehicleFareYen).toBe(0)
  })
})

describe('calculateManualPreFixedServiceYen', () => {
  it('sums service fees without route fare', () => {
    const serviceYen = calculateManualPreFixedServiceYen(baseSelection())
    const total = calculateManualPreFixedTotalYen({ routeFareYen: 2500, selection: baseSelection() })
    expect(total - 2500).toBe(serviceYen)
  })
})

describe('manual flow UI wiring', () => {
  const flowSource = readFileSync(resolve(process.cwd(), 'src/pages/PreFixedManualCreateFlow.tsx'), 'utf8')
  const createPageSource = readFileSync(resolve(process.cwd(), 'src/pages/PreFixedCreatePage.tsx'), 'utf8')
  const mapSource = readFileSync(
    resolve(process.cwd(), 'src/components/preFixed/PreFixedRouteMapPanel.tsx'),
    'utf8',
  )

  it('uses shared route selection step and polyline decode like かんたん見積もり', () => {
    expect(flowSource).toContain('PreFixedRouteSelectionStep')
    expect(createPageSource).toContain('PreFixedRouteSelectionStep')
    expect(flowSource).toContain('buildRouteMapMarkers')
    expect(mapSource).toContain('loadGoogleMapsPolylineDecoder')
    expect(mapSource).toContain('decodePolylinePath')
  })

  it('shows route kind heading and options without TRIP TYPE eyebrow', () => {
    expect(flowSource).toContain('運行ルートを選択')
    expect(flowSource).toContain("single: '目的地'")
    expect(flowSource).toContain("multi: '複数経由'")
    expect(flowSource).not.toContain('TRIP TYPE')
    expect(flowSource).not.toContain('ROUTES')
    expect(flowSource).not.toContain('SERVICE ITEMS')
  })

  it('does not cap route candidates to manual-only A/B', () => {
    expect(flowSource).not.toContain('minCandidates: 2')
    expect(flowSource).not.toContain('maxCandidates: 2')
    expect(flowSource).toContain('PreFixedRouteSelectionStep')
  })

  it('uses compact route cards and fare settings panel with category classes', () => {
    expect(flowSource).toContain('PreFixedManualFareSettingsPanel')
    const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
    expect(css).toContain('.pre-fixed-fare-category--auto')
    expect(css).toContain('.pre-fixed-fare-category--assist')
    expect(css).toContain('.pre-fixed-fare-category--rental')
    expect(css).toContain('.pre-fixed-fare-category--waiting')
    expect(css).toContain('.pre-fixed-route-candidate-grid')
    expect(css).toContain('.pre-fixed-route-card.is-selected')
    expect(css).toContain('.pre-fixed-fare-option-card.is-selected')
  })

  it('tracks automatic fee initialization without re-enabling after manual edits', () => {
    expect(flowSource).toContain('hasInitializedAutomaticFeesRef')
    expect(flowSource).toContain('userEditedFareSelectionRef')
  })
})
