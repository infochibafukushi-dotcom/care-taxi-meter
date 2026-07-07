import { describe, expect, it } from 'vitest'
import type { DriverReservationSummary } from '../types/reservation'
import {
  formatMeterRunStatusForList,
  formatPreFixedFareLabel,
  isPreFixedReservationReady,
  resolveReservationCategory,
} from './utils/reservationCategory'
import { reviewDemoPreFixedFareReservationDetail } from './fixtures/reviewDemoPreFixedFare'

const baseSummary = (overrides: Partial<DriverReservationSummary> = {}): DriverReservationSummary => ({
  reservationId: 'res-001',
  estimateNo: 'EST-001',
  status: 'active',
  meterRunStatus: 'not_started',
  scheduledAt: '2026-07-07T10:00:00+09:00',
  date: '2026-07-07',
  time: '10:00',
  customerName: '山田太郎',
  customerPhone: '090-0000-0000',
  pickupAddress: '千葉市中央区',
  destinationAddress: '千葉駅',
  confirmedFareYen: 0,
  fixedFareTotalYen: 0,
  fareType: '通常予約',
  preFixedFareConfirmable: false,
  useToll: false,
  selectedRouteId: '',
  consentAt: '',
  snapshotHash: '',
  franchiseeId: null,
  storeId: null,
  ...overrides,
})

describe('resolveReservationCategory', () => {
  it('classifies pre-fixed reservations', () => {
    expect(
      resolveReservationCategory(
        baseSummary({
          fareType: '事前確定運賃',
          preFixedFareConfirmable: true,
          confirmedFareYen: 3740,
          consentAt: '2026-07-07T09:00:00+09:00',
        }),
      ),
    ).toBe('pre_fixed')
  })

  it('classifies phone reservations', () => {
    expect(resolveReservationCategory(baseSummary({ fareType: '電話予約' }))).toBe('phone')
  })

  it('classifies normal reservations', () => {
    expect(resolveReservationCategory(baseSummary({ fareType: '通常予約' }))).toBe('normal')
  })
})

describe('isPreFixedReservationReady', () => {
  it('returns true for ready pre-fixed reservation detail', () => {
    expect(isPreFixedReservationReady(reviewDemoPreFixedFareReservationDetail)).toBe(true)
  })
})

describe('formatPreFixedFareLabel', () => {
  it('shows amount when confirmed', () => {
    expect(
      formatPreFixedFareLabel({
        preFixedFareConfirmable: true,
        confirmedFareYen: 3740,
      }),
    ).toBe('3,740円')
  })

  it('shows pending label when not confirmed', () => {
    expect(
      formatPreFixedFareLabel({
        preFixedFareConfirmable: false,
        confirmedFareYen: 0,
      }),
    ).toBe('未確定')
  })
})

describe('formatMeterRunStatusForList', () => {
  it('maps meter statuses for list display', () => {
    expect(formatMeterRunStatusForList('not_started')).toBe('未開始')
    expect(formatMeterRunStatusForList('in_progress')).toBe('開始済み')
    expect(formatMeterRunStatusForList('completed')).toBe('完了')
  })
})
