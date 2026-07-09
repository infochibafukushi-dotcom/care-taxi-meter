import { describe, expect, it } from 'vitest'
import {
  isPreOpeningResetConfirmationValid,
  summarizeCategoryCounts,
} from './services/preOpeningDataReset'
import { matchesReservationTenant } from './services/reservationPreOpeningReset'
import { canResetPreOpeningBusinessData } from './types/permissions'

describe('canResetPreOpeningBusinessData', () => {
  it('allows owner and hq_admin only', () => {
    expect(canResetPreOpeningBusinessData('owner')).toBe(true)
    expect(canResetPreOpeningBusinessData('hq_admin')).toBe(true)
    expect(canResetPreOpeningBusinessData('manager')).toBe(false)
    expect(canResetPreOpeningBusinessData('driver')).toBe(false)
    expect(canResetPreOpeningBusinessData('')).toBe(false)
  })
})

describe('isPreOpeningResetConfirmationValid', () => {
  it('accepts only RESET', () => {
    expect(isPreOpeningResetConfirmationValid('RESET')).toBe(true)
    expect(isPreOpeningResetConfirmationValid(' RESET ')).toBe(true)
    expect(isPreOpeningResetConfirmationValid('reset')).toBe(false)
    expect(isPreOpeningResetConfirmationValid('リセット')).toBe(false)
    expect(isPreOpeningResetConfirmationValid('')).toBe(false)
  })
})

describe('summarizeCategoryCounts', () => {
  it('groups collection counts into display categories', () => {
    expect(
      summarizeCategoryCounts(
        {
          caseRecords: 10,
          workSessions: 3,
          staffAttendance: 2,
          caseCounters: 1,
          accountingExpenses: 4,
          accountingReceipts: 2,
          accountingAdjustments: 1,
          accountingExports: 1,
          accountingSales: 0,
          accountingSettlementAuxiliary: 1,
          accountingFixedAssets: 1,
        },
        2,
        5,
        2,
      ),
    ).toEqual({
      browserTemporaryData: 2,
      reservationApiRecords: 5,
      tripsAndSales: 16,
      accounting: 10,
      storageFiles: 2,
    })
  })
})

describe('matchesReservationTenant', () => {
  it('requires both franchiseeId and storeId to match', () => {
    expect(
      matchesReservationTenant(
        { franchiseeId: 'franchisee-a', storeId: 'store-a' },
        { franchiseeId: 'franchisee-a', storeId: 'store-a' },
      ),
    ).toBe(true)
    expect(
      matchesReservationTenant(
        { franchiseeId: 'franchisee-a', storeId: 'store-b' },
        { franchiseeId: 'franchisee-a', storeId: 'store-a' },
      ),
    ).toBe(false)
    expect(
      matchesReservationTenant(
        { franchiseeId: null, storeId: 'store-a' },
        { franchiseeId: 'franchisee-a', storeId: 'store-a' },
      ),
    ).toBe(false)
  })
})
