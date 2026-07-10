/**
 * 事前確定運賃 二重加算防止テスト
 */
import { describe, expect, it } from 'vitest'
import {
  shouldExcludeServiceFeeFromMeterReadd,
  SERVICE_FEE_KEYS_EXCLUDED_FROM_METER_READD,
} from '../services/fareMasterService'
import { resolvePreFixedConfirmedFareYen } from '../services/reservationTripContext'

describe('fare master double-charge prevention', () => {
  it('excludes waiting and escort from meter re-add', () => {
    expect(shouldExcludeServiceFeeFromMeterReadd('waitingFee')).toBe(true)
    expect(shouldExcludeServiceFeeFromMeterReadd('escortFee')).toBe(true)
    expect(shouldExcludeServiceFeeFromMeterReadd('boarding-assist')).toBe(false)
  })

  it('does not use fixedFareTotalYen as confirmed base when confirmed is zero', () => {
    const yen = resolvePreFixedConfirmedFareYen({
      context: {
        reservationId: 'r1',
        estimateNo: 'e1',
        confirmedFareYen: 0,
        fixedFareTotalYen: 12000,
        snapshotHash: '',
        consentAt: '',
        pickupAddress: '',
        dropoffAddress: '',
        usageSummary: [],
        quoteSnapshot: {
          fixedFareTotal: 8000,
          serviceFees: [{ key: 'waitingFee', label: '待機', amount: 800 }],
          fareMode: 'pre_fixed_fare',
          selectedRouteId: '',
          selectedUsesToll: false,
          distanceMeters: 0,
          durationSeconds: 0,
          preFixedFareConfirmable: true,
        },
        routePlan: null,
        consent: {
          consentAt: '',
          consentTextVersion: '',
          snapshotHash: '',
          quotedFareYen: 0,
          source: '',
        },
        customerName: '',
        scheduledAt: '',
      },
    })
    expect(yen).toBe(8000)
    expect(SERVICE_FEE_KEYS_EXCLUDED_FROM_METER_READD.has('waitingFee')).toBe(true)
  })
})
