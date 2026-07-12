import { describe, expect, it } from 'vitest'
import {
  applyAssistFeesToRouteCandidates,
  calculatePreFixedFareBreakdown,
  selectionStateFromAssistItems,
  computeAssistFeeBreakdown,
} from './services/preFixedAssistSelection'
import {
  getPreFixedCreateStepAfterTripType,
  getPreFixedManualCreateBackStep,
  getPreFixedManualCreateForwardStep,
  PRE_FIXED_MANUAL_CREATE_STEPS,
} from './services/preFixedCreateFlow'
import type { AssistItem } from './services/fare'
import type { PreFixedRouteCandidate } from './types/preFixedMeterSession'

describe('pre-fixed create flow order (manual)', () => {
  it('orders trip-type → assist → points → routes → consent', () => {
    expect([...PRE_FIXED_MANUAL_CREATE_STEPS]).toEqual([
      'trip-type',
      'assist-items',
      'pickup',
      'destinations',
      'routes',
      'consent',
    ])
  })

  it('walks forward without visiting assist after routes', () => {
    let step: (typeof PRE_FIXED_MANUAL_CREATE_STEPS)[number] = 'trip-type'
    const visited: string[] = [step]
    while (true) {
      const next = getPreFixedManualCreateForwardStep(step)
      if (!next) {
        break
      }
      step = next
      visited.push(step)
    }
    expect(visited).toEqual([...PRE_FIXED_MANUAL_CREATE_STEPS])
    expect(visited.indexOf('assist-items')).toBeLessThan(visited.indexOf('routes'))
    expect(visited.indexOf('assist-items')).toBeLessThan(visited.indexOf('pickup'))
  })

  it('walks back from routes to trip-type through points then assist', () => {
    const chain: string[] = []
    let step: (typeof PRE_FIXED_MANUAL_CREATE_STEPS)[number] | null = 'routes'
    while (step) {
      chain.push(step)
      step = getPreFixedManualCreateBackStep(step)
    }
    expect(chain).toEqual(['routes', 'destinations', 'pickup', 'assist-items', 'trip-type'])
  })

  it('skips assist after trip-type when starting from reservation', () => {
    expect(getPreFixedCreateStepAfterTripType(false)).toBe('assist-items')
    expect(getPreFixedCreateStepAfterTripType(true)).toBe('destinations')
  })
})

describe('create flow fare fields on candidates', () => {
  const baseCandidates: PreFixedRouteCandidate[] = [
    {
      id: 'A',
      label: '時間優先ルート',
      distanceMeters: 6900,
      durationSeconds: 1140,
      fixedFareYen: 3320,
      serviceFeesYen: 0,
      totalYen: 3320,
      polyline: 'poly-a',
      routeStrategy: 'time_priority',
    },
    {
      id: 'B',
      label: '一般道優先ルート',
      distanceMeters: 7200,
      durationSeconds: 1200,
      fixedFareYen: 3500,
      serviceFeesYen: 0,
      totalYen: 3500,
      polyline: 'poly-b',
      routeStrategy: 'general_road_priority',
    },
  ]

  it('case2/3: shared assistFeesYen, per-route totals', () => {
    const assistFeesYen = 3600
    const withFees = applyAssistFeesToRouteCandidates(baseCandidates, assistFeesYen)
    expect(
      calculatePreFixedFareBreakdown({
        routeFareYen: withFees[0].fixedFareYen,
        assistFeesYen,
      }).totalEstimatedFareYen,
    ).toBe(6920)
    expect(
      calculatePreFixedFareBreakdown({
        routeFareYen: withFees[1].fixedFareYen,
        assistFeesYen,
      }).totalEstimatedFareYen,
    ).toBe(7100)
    expect(withFees[0].fixedFareYen).toBe(3320)
    expect(withFees[1].fixedFareYen).toBe(3500)
  })

  it('case4: re-display / re-apply does not double-add assist into routeFare', () => {
    const once = applyAssistFeesToRouteCandidates(baseCandidates, 3600)
    const twice = applyAssistFeesToRouteCandidates(once, 3600)
    expect(twice[0].fixedFareYen).toBe(3320)
    expect(twice[0].serviceFeesYen).toBe(3600)
    expect(twice[0].totalYen).toBe(6920)
    expect(twice[0].polyline).toBe('poly-a')
  })

  it('case5: assist change updates totals only (route geometry untouched)', () => {
    const withFees = applyAssistFeesToRouteCandidates(baseCandidates, 3600)
    const changed = applyAssistFeesToRouteCandidates(withFees, 1100)
    expect(changed[0].fixedFareYen).toBe(3320)
    expect(changed[0].serviceFeesYen).toBe(1100)
    expect(changed[0].totalYen).toBe(4420)
    expect(changed[0].distanceMeters).toBe(6900)
    expect(changed[0].durationSeconds).toBe(1140)
    expect(changed[0].polyline).toBe('poly-a')
    expect(changed[1].fixedFareYen).toBe(3500)
    expect(changed[1].totalYen).toBe(4600)
  })

  it('case9: old AssistItem[] converts without double-adding into route fare', () => {
    const oldItems: AssistItem[] = [
      {
        id: 'standardWheelchair',
        name: '標準車いす',
        amount: 0,
        enabled: true,
        sortOrder: 1,
      },
      {
        id: 'boardingAssist',
        name: '乗降介助',
        amount: 1100,
        enabled: true,
        sortOrder: 2,
      },
      {
        id: 'stairFloor2',
        name: '2階階段介助',
        amount: 3000,
        enabled: true,
        sortOrder: 3,
      },
    ]
    const state = selectionStateFromAssistItems(oldItems)
    const assistFeesYen = computeAssistFeeBreakdown(state).serviceTotal
    expect(assistFeesYen).toBe(4100)
    const withFees = applyAssistFeesToRouteCandidates(baseCandidates, assistFeesYen)
    expect(withFees[0].fixedFareYen).toBe(3320)
    expect(withFees[0].serviceFeesYen).toBe(4100)
    expect(withFees[0].totalYen).toBe(7420)
  })
})
