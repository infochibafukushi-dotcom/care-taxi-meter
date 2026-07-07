import { describe, expect, it } from 'vitest'
import {
  buildPreFixedFareStartPersistKey,
  shouldPersistPreFixedFareStartAtMeterEntry,
} from './services/preFixedFareStartPersistence'

describe('shouldPersistPreFixedFareStartAtMeterEntry', () => {
  it('persists when fixed meter has consent and an open work session', () => {
    expect(
      shouldPersistPreFixedFareStartAtMeterEntry({
        meterMode: 'fixed',
        consentAt: '2026-07-07T09:00:00+09:00',
        workSessionId: 'work-1',
        reviewDemoMode: false,
      }),
    ).toBe(true)
  })

  it('skips review demo mode', () => {
    expect(
      shouldPersistPreFixedFareStartAtMeterEntry({
        meterMode: 'fixed',
        consentAt: '2026-07-07T09:00:00+09:00',
        workSessionId: 'work-1',
        reviewDemoMode: true,
      }),
    ).toBe(false)
  })

  it('skips without consent datetime', () => {
    expect(
      shouldPersistPreFixedFareStartAtMeterEntry({
        meterMode: 'fixed',
        consentAt: '',
        workSessionId: 'work-1',
        reviewDemoMode: false,
      }),
    ).toBe(false)
  })

  it('skips non-fixed meter modes', () => {
    expect(
      shouldPersistPreFixedFareStartAtMeterEntry({
        meterMode: 'gps',
        consentAt: '2026-07-07T09:00:00+09:00',
        workSessionId: 'work-1',
        reviewDemoMode: false,
      }),
    ).toBe(false)
  })
})

describe('buildPreFixedFareStartPersistKey', () => {
  it('builds a stable idempotency key', () => {
    expect(
      buildPreFixedFareStartPersistKey({
        workSessionId: 'work-1',
        reservationId: 'res-1',
        snapshotHash: 'hash-1',
      }),
    ).toBe('work-1:res-1:hash-1')
  })
})
