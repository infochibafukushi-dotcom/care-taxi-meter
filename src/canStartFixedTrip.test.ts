import { describe, expect, it } from 'vitest'
import {
  evaluateCanStartFixedTrip,
  resolvePrimaryStartDisabledReason,
} from './utils/canStartFixedTrip'

const baseInput = {
  meterMode: 'fixed' as const,
  reservationTripContext: {
    reservationId: 'r1',
    estimateNo: '',
    confirmedFareYen: 3000,
    fixedFareTotalYen: 3000,
    snapshotHash: 'h',
    consentAt: '',
    pickupAddress: 'a',
    dropoffAddress: 'b',
    usageSummary: [],
    quoteSnapshot: {
      fixedFareTotal: 3000,
      serviceFees: [],
      fareMode: 'pre_fixed_fare',
      selectedRouteId: 'A',
      selectedUsesToll: false,
      distanceMeters: 0,
      durationSeconds: 0,
      preFixedFareConfirmable: true,
    },
    routePlan: null,
    consent: {
      consentAt: '',
      consentTextVersion: '',
      snapshotHash: 'h',
      quotedFareYen: 3000,
      source: 'manual',
    },
    customerName: '',
    scheduledAt: '',
  },
  restoredTripSnapshot: null,
  fixedFareRun: null,
  status: '空車' as const,
  hasWorkSession: true,
  isWorkSessionLoading: false,
  selectedVehicleId: 'v1',
  isFixedTripStarting: false,
}

describe('evaluateCanStartFixedTrip', () => {
  it('is true when all legacy gates pass', () => {
    const evaluation = evaluateCanStartFixedTrip(baseInput)
    expect(evaluation.canStartFixedTrip).toBe(true)
    expect(evaluation.firstFalseName).toBeNull()
  })

  it('reports selectedVehicleId as first false when empty', () => {
    const evaluation = evaluateCanStartFixedTrip({
      ...baseInput,
      selectedVehicleId: '',
    })
    expect(evaluation.canStartFixedTrip).toBe(false)
    expect(evaluation.firstFalseName).toBe('selectedVehicleId')
    expect(
      resolvePrimaryStartDisabledReason({
        canStartTrip: false,
        isTripStarting: false,
        evaluation,
      }),
    ).toBe('selectedVehicleId')
  })

  it('reports workSession.currentSession when missing', () => {
    const evaluation = evaluateCanStartFixedTrip({
      ...baseInput,
      hasWorkSession: false,
    })
    expect(evaluation.firstFalseName).toBe('workSession.currentSession')
  })

  it('reports workSession.resolved while loading (not inactive)', () => {
    const evaluation = evaluateCanStartFixedTrip({
      ...baseInput,
      hasWorkSession: false,
      isWorkSessionLoading: true,
    })
    expect(evaluation.firstFalseName).toBe('workSession.resolved')
    expect(evaluation.canStartFixedTrip).toBe(false)
  })

  it('reports reservationTripContext|restoredFixedSnapshot when missing', () => {
    const evaluation = evaluateCanStartFixedTrip({
      ...baseInput,
      reservationTripContext: null,
    })
    expect(evaluation.firstFalseName).toBe('reservationTripContext|restoredFixedSnapshot')
  })

  it('allows start when fixedFareRun is null (pre-start is normal)', () => {
    const evaluation = evaluateCanStartFixedTrip({
      ...baseInput,
      fixedFareRun: null,
    })
    const fixedGate = evaluation.conditions.find(
      (condition) => condition.name === '!fixedFareRun||status===空車',
    )
    expect(fixedGate?.value).toBe(true)
    expect(evaluation.canStartFixedTrip).toBe(true)
  })
})
