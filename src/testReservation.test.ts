import { describe, expect, it } from 'vitest'
import {
  mapDriverReservationDetail,
  mapDriverReservationListItem,
} from './services/reservationApi'
import { resolveReservationCategory } from './utils/reservationCategory'
import { resolveReservationIsTest } from './utils/testReservation'

describe('test reservation support', () => {
  it('maps isTest from API list item and normalizes null fields', () => {
    const summary = mapDriverReservationListItem({
      reservationId: '202607100600',
      estimateNo: null,
      status: 'test',
      isTest: true,
      meterRunStatus: 'in_progress',
      scheduledAt: '2026-07-10T06:00:00+09:00',
      date: '2026-07-10',
      time: '06:00',
      customerName: 'テストタロウ',
      customerPhone: '09000000000',
      pickupAddress: '千葉市中央区 テスト出発地',
      destinationAddress: '千葉市若葉区 テスト目的地',
      confirmedFareYen: 0,
      fixedFareTotalYen: 0,
      fareType: null,
      preFixedFareConfirmable: false,
      useToll: false,
      selectedRouteId: null,
      consentAt: null,
      snapshotHash: null,
      franchiseeId: null,
      storeId: null,
    })

    expect(summary.isTest).toBe(true)
    expect(summary.fareType).toBe('')
    expect(summary.selectedRouteId).toBe('')
    expect(resolveReservationCategory(summary)).toBe('normal')
  })

  it('maps detail with null consent and quote snapshot', () => {
    const detail = mapDriverReservationDetail({
      reservationId: '202607100600',
      estimateNo: null,
      status: 'test',
      isTest: true,
      meterRunStatus: 'in_progress',
      scheduledAt: '2026-07-10T06:00:00+09:00',
      customer: {
        name: 'テストタロウ',
        kana: 'テストタロウ',
        phone: '09000000000',
        email: '',
      },
      trip: {
        date: '2026-07-10',
        time: '06:00',
        pickupAddress: '千葉市中央区 テスト出発地',
        destinationAddress: '千葉市若葉区 テスト目的地',
        vehicle: '無料車いす',
        usageSummary: [],
        notes: '通常テスト予約確認',
      },
      fixedFare: {
        confirmedFareYen: 0,
        fixedFareTotalYen: 0,
        fareType: null,
        fareLockedAt: null,
        selectedRouteId: null,
        selectedOverallRouteId: null,
        useToll: false,
        preFixedFareConfirmable: false,
      },
      consent: null,
      quoteSnapshot: null,
      routePlan: null,
      integrity: {
        snapshotHash: null,
        computedSnapshotHash: null,
        snapshotHashVerified: false,
        confirmedFareMatchesSnapshot: false,
        consentSnapshotHashMatches: null,
      },
      franchiseeId: null,
      storeId: null,
    })

    expect(detail.isTest).toBe(true)
    expect(detail.quoteSnapshot.serviceFees).toEqual([])
    expect(detail.consent.consentAt).toBe('')
    expect(detail.fixedFare.selectedRouteId).toBe('')
    expect(resolveReservationIsTest(detail)).toBe(true)
  })
})
