import { describe, expect, it } from 'vitest'
import {
  buildPreFixedMeterMenuPath,
  resolvePostSettlementNewCaseNavigation,
} from './services/preFixedFareCleanup'

describe('post-settlement new case navigation', () => {
  it('keeps normal meter modes on in-place reset', () => {
    for (const meterMode of ['gps', 'time', 'obd'] as const) {
      expect(
        resolvePostSettlementNewCaseNavigation({
          meterMode,
          vehicleId: 'vehicle-1',
        }),
      ).toEqual({ kind: 'reset_in_place' })
    }
  })

  it('sends pre-fixed meter to reservation yes/no menu with vehicleId', () => {
    expect(
      resolvePostSettlementNewCaseNavigation({
        meterMode: 'fixed',
        vehicleId: 'vehicle-1',
      }),
    ).toEqual({
      kind: 'navigate',
      to: '/case/pre-fixed?vehicleId=vehicle-1',
      replace: true,
    })
  })

  it('sends pre-fixed meter to menu without stale case query params', () => {
    const navigation = resolvePostSettlementNewCaseNavigation({
      meterMode: 'fixed',
      vehicleId: 'vehicle-1',
    })

    expect(navigation.kind).toBe('navigate')
    if (navigation.kind !== 'navigate') {
      return
    }

    expect(navigation.to).not.toContain('meterMode=')
    expect(navigation.to).not.toContain('preFixedSessionId')
    expect(navigation.to).not.toContain('reservationId')
    expect(navigation.to).not.toContain('caseRecordId')
    expect(navigation.replace).toBe(true)
  })

  it('builds pre-fixed menu path without vehicleId when missing', () => {
    expect(buildPreFixedMeterMenuPath('')).toBe('/case/pre-fixed')
    expect(buildPreFixedMeterMenuPath('  ')).toBe('/case/pre-fixed')
    expect(buildPreFixedMeterMenuPath()).toBe('/case/pre-fixed')
  })

  it('keeps review demo on in-place reset even for fixed mode', () => {
    expect(
      resolvePostSettlementNewCaseNavigation({
        meterMode: 'fixed',
        vehicleId: 'vehicle-1',
        reviewDemoMode: true,
      }),
    ).toEqual({ kind: 'reset_in_place' })
  })
})
