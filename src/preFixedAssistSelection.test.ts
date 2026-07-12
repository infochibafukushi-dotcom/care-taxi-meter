import { describe, expect, it } from 'vitest'
import type { AssistItem } from './services/fare'
import {
  applyAssistFeesToRouteCandidates,
  applyMeterEditChoice,
  applyStepChoice,
  areRequiredAssistStepsComplete,
  assistItemsFromSelectionState,
  calculatePreFixedFareBreakdown,
  computeAssistFeeBreakdown,
  hydrateAssistItemsFromSavedFees,
  normalizeExtraFeeSelectedIds,
  openStepForEdit,
  selectionStateFromAssistItems,
  STAIR_CATALOG,
} from './services/preFixedAssistSelection'
import { createEmptyAssistSelectionState } from './types/preFixedAssistSelection'
import type { PreFixedRouteCandidate } from './types/preFixedMeterSession'

describe('preFixedAssistSelection step flow', () => {
  it('case1: STEP1 無料車いす is 0円 and can be re-edited', () => {
    let state = createEmptyAssistSelectionState()
    state = applyStepChoice(state, 'mobility', 'free-wheelchair')
    expect(computeAssistFeeBreakdown(state).wheelchairFee).toBe(0)
    expect(state.mobilityId).toBe('free-wheelchair')

    state = openStepForEdit(state, 'mobility')
    expect(state.mobilityId).toBe('')
    expect(state.assistanceId).toBe('')
    expect(state.stairId).toBe('')
  })

  it('case2: switching assistance replaces fee once', () => {
    let state = createEmptyAssistSelectionState()
    state = applyStepChoice(state, 'mobility', 'free-wheelchair')
    state = applyStepChoice(state, 'assistance', 'boarding-assist')
    expect(computeAssistFeeBreakdown(state).assistanceFee).toBe(1100)

    state = applyStepChoice(state, 'assistance', 'body-assist')
    expect(computeAssistFeeBreakdown(state).assistanceFee).toBe(1600)
    expect(computeAssistFeeBreakdown(state).serviceTotal).toBe(1600)
  })

  it('case3: stair amounts match lp-site catalog', () => {
    let state = createEmptyAssistSelectionState()
    state = applyStepChoice(state, 'mobility', 'cane-walk')
    state = applyStepChoice(state, 'assistance', 'watch-assist')

    state = applyStepChoice(state, 'stair', 'stair-none')
    expect(computeAssistFeeBreakdown(state).stairFee).toBe(0)

    state = applyStepChoice(state, 'stair', 'stair-floor2')
    expect(computeAssistFeeBreakdown(state).stairFee).toBe(3000)
    expect(STAIR_CATALOG.find((item) => item.id === 'stair-floor5')?.amount).toBe(10000)

    state = applyStepChoice(state, 'stair', 'stair-floor5')
    expect(computeAssistFeeBreakdown(state).stairFee).toBe(10000)
  })

  it('case4: re-selecting same item does not double fee', () => {
    let state = createEmptyAssistSelectionState()
    state = applyStepChoice(state, 'mobility', 'reclining-wheelchair')
    state = applyStepChoice(state, 'assistance', 'boarding-assist')
    state = applyStepChoice(state, 'stair', 'stair-floor2')
    const first = computeAssistFeeBreakdown(state).serviceTotal

    state = applyStepChoice(state, 'assistance', 'boarding-assist')
    state = applyStepChoice(state, 'stair', 'stair-floor2')
    expect(computeAssistFeeBreakdown(state).serviceTotal).toBe(first)
    expect(first).toBe(2500 + 1100 + 3000)
  })

  it('case7: legacy checkbox items convert without duplicate fees', () => {
    const legacy: AssistItem[] = [
      { id: 'standardWheelchair', name: '標準車いす', amount: 0, enabled: true, sortOrder: 1 },
      { id: 'boardingAssist', name: '乗降介助', amount: 1100, enabled: true, sortOrder: 2 },
      { id: 'stairsAssist', name: '階段介助', amount: 0, enabled: true, sortOrder: 3 },
      { id: 'recliningAssist', name: 'リクライニング', amount: 1000, enabled: false, sortOrder: 4 },
    ]
    const state = selectionStateFromAssistItems(legacy)
    expect(state.mobilityId).toBe('free-wheelchair')
    expect(state.assistanceId).toBe('boarding-assist')
    expect(state.stairId).toBe('stair-none')

    const items = assistItemsFromSelectionState(state)
    const enabled = items.filter((item) => item.enabled)
    const ids = enabled.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(computeAssistFeeBreakdown(state).serviceTotal).toBe(1100)
  })

  it('requires mobility/assistance/stair before proceed', () => {
    let state = createEmptyAssistSelectionState()
    expect(areRequiredAssistStepsComplete(state)).toBe(false)
    state = applyStepChoice(state, 'mobility', 'own-wheelchair')
    expect(areRequiredAssistStepsComplete(state)).toBe(false)
    state = applyStepChoice(state, 'assistance', 'body-assist')
    expect(areRequiredAssistStepsComplete(state)).toBe(false)
    state = applyStepChoice(state, 'stair', 'stair-watch')
    expect(areRequiredAssistStepsComplete(state)).toBe(true)
  })
})

describe('fare breakdown separation', () => {
  it('total = routeFare + assistFees without mutating route fare', () => {
    const a = calculatePreFixedFareBreakdown({ routeFareYen: 3320, assistFeesYen: 3600 })
    expect(a).toEqual({
      routeFareYen: 3320,
      assistFeesYen: 3600,
      totalEstimatedFareYen: 6920,
    })

    const b = calculatePreFixedFareBreakdown({ routeFareYen: 3500, assistFeesYen: 3600 })
    expect(b.totalEstimatedFareYen).toBe(7100)
    expect(b.routeFareYen).toBe(3500)
  })

  it('re-applying assist fees does not double-add into fixedFareYen', () => {
    const candidates: PreFixedRouteCandidate[] = [
      {
        id: 'A',
        label: '時間優先ルート',
        distanceMeters: 6900,
        durationSeconds: 1140,
        fixedFareYen: 3320,
        serviceFeesYen: 0,
        totalYen: 3320,
        polyline: 'encoded-a',
      },
      {
        id: 'B',
        label: '一般道優先ルート',
        distanceMeters: 7200,
        durationSeconds: 1200,
        fixedFareYen: 3500,
        serviceFeesYen: 0,
        totalYen: 3500,
        polyline: 'encoded-b',
      },
    ]

    const once = applyAssistFeesToRouteCandidates(candidates, 3600)
    expect(once[0].fixedFareYen).toBe(3320)
    expect(once[0].serviceFeesYen).toBe(3600)
    expect(once[0].totalYen).toBe(6920)
    expect(once[1].totalYen).toBe(7100)

    const twice = applyAssistFeesToRouteCandidates(once, 3600)
    expect(twice[0].fixedFareYen).toBe(3320)
    expect(twice[0].serviceFeesYen).toBe(3600)
    expect(twice[0].totalYen).toBe(6920)
    expect(twice[0].polyline).toBe('encoded-a')

    const changed = applyAssistFeesToRouteCandidates(twice, 1100)
    expect(changed[0].fixedFareYen).toBe(3320)
    expect(changed[0].serviceFeesYen).toBe(1100)
    expect(changed[0].totalYen).toBe(4420)
    expect(changed[0].distanceMeters).toBe(6900)
    expect(changed[0].polyline).toBe('encoded-a')
  })
})

describe('route fare non-destruction', () => {
  it('assist fee update keeps fixedFareYen and route identity', () => {
    const candidates: PreFixedRouteCandidate[] = [
      {
        id: 'A',
        label: '時間優先ルート',
        distanceMeters: 6900,
        durationSeconds: 1140,
        fixedFareYen: 3320,
        serviceFeesYen: 0,
        totalYen: 3320,
        polyline: 'encoded-a',
      },
      {
        id: 'B',
        label: '一般道優先ルート',
        distanceMeters: 7000,
        durationSeconds: 1200,
        fixedFareYen: 3400,
        serviceFeesYen: 0,
        totalYen: 3400,
        polyline: 'encoded-b',
      },
    ]

    const updated = applyAssistFeesToRouteCandidates(candidates, 4100)
    expect(updated[0].fixedFareYen).toBe(3320)
    expect(updated[0].serviceFeesYen).toBe(4100)
    expect(updated[0].totalYen).toBe(7420)
    expect(updated[0].polyline).toBe('encoded-a')
    expect(updated[0].id).toBe('A')
    expect(updated[1].fixedFareYen).toBe(3400)
    expect(updated[1].polyline).toBe('encoded-b')
  })
})

describe('meter edit hydration and draft safety', () => {
  it('restores zero-yen selections (free wheelchair / stair-none)', () => {
    const items = hydrateAssistItemsFromSavedFees(
      [
        { key: 'standardWheelchair', label: '無料車いす', amount: 0 },
        { key: 'boardingAssist', label: '乗降介助', amount: 1100 },
        { key: 'stairsAssist', label: '階段介助なし', amount: 0 },
        { key: 'reservedPickup', label: '予約迎車', amount: 800 },
        { key: 'oneBoxLift', label: '1BOXリフト車両', amount: 1000 },
      ],
      [],
    )
    const state = selectionStateFromAssistItems(items)
    expect(state.mobilityId).toBe('free-wheelchair')
    expect(state.assistanceId).toBe('boarding-assist')
    expect(state.stairId).toBe('stair-none')
    expect(state.extraIds).toEqual(expect.arrayContaining(['reservedPickup', 'oneBoxLift']))
  })

  it('maps legacy 標準車いす label to free-wheelchair', () => {
    const state = selectionStateFromAssistItems([
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
    ])
    expect(state.mobilityId).toBe('free-wheelchair')
    expect(state.assistanceId).toBe('boarding-assist')
  })

  it('meter edit assistance change keeps stair and does not double fee', () => {
    let state = createEmptyAssistSelectionState()
    state = applyStepChoice(state, 'mobility', 'free-wheelchair')
    state = applyStepChoice(state, 'assistance', 'boarding-assist')
    state = applyStepChoice(state, 'stair', 'stair-none')
    state = applyMeterEditChoice(state, 'assistance', 'body-assist')
    expect(state.stairId).toBe('stair-none')
    expect(state.mobilityId).toBe('free-wheelchair')
    expect(computeAssistFeeBreakdown(state).assistanceFee).toBe(1600)
    expect(computeAssistFeeBreakdown(state).serviceTotal).toBe(1600)
  })

  it('normalizes extra fee aliases without duplicates', () => {
    const ids = normalizeExtraFeeSelectedIds([
      'reservedPickup',
      'waiting',
      'waitingPlanned',
      'hospital-escort',
    ])
    expect(ids.has('reservedPickup')).toBe(true)
    expect(ids.has('waitingPlanned')).toBe(true)
    expect(ids.has('escortPlanned')).toBe(true)
    expect(ids.has('waiting')).toBe(false)
    expect(ids.size).toBe(3)
  })
})
