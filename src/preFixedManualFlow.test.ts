import { describe, expect, it } from 'vitest'
import {
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
import type { PreFixedManualFareSelection } from './types/preFixedMeterSession'

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
