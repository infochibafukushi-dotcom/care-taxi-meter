import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildReviewDemoSearch,
  isReviewDemoActive,
  isReviewDemoQueryActive,
  REVIEW_DEMO_RESERVATION_ID,
  setReviewDemoRuntimeEnabled,
} from '../src/utils/reviewDemo'
import {
  reviewDemoConfirmedFareBreakdownTotalYen,
  reviewDemoPreFixedFareReservationDetail,
  reviewDemoPreFixedFareReservationSummary,
} from '../src/fixtures/reviewDemoPreFixedFare'
import { generateCaseNumber, saveCaseRecord } from '../src/services/caseRecords'
import {
  completeFixedFareRun,
  resetFixedFareRun,
  startFixedFareRun,
} from '../src/services/reservationApi'
import { claimVehicleForCaseStart } from '../src/services/vehicleAvailability'
import { updateWorkSessionActiveTrip } from '../src/services/workSessions'
import { saveGpsRoute } from '../src/services/gpsRoutes'
import { recordReceiptReissue } from '../src/services/caseRecords'
import { thermalPrinterService } from '../src/services/escPosPrinterConnection'

describe('review demo mode detection', () => {
  it('detects review demo query and path', () => {
    expect(isReviewDemoQueryActive('?reviewDemo=1&scenario=pre-fixed-fare-demo')).toBe(true)
    expect(
      isReviewDemoActive({
        pathname: '/review-demo/reservations',
        search: '',
      }),
    ).toBe(true)
    expect(buildReviewDemoSearch()).toContain('reviewDemo=1')
  })
})

describe('review demo fixture data', () => {
  it('contains the expected reservation values', () => {
    expect(reviewDemoPreFixedFareReservationSummary.reservationId).toBe('PF-REVIEW-001')
    expect(reviewDemoPreFixedFareReservationDetail.customer.name).toBe('審査用デモ')
    expect(reviewDemoPreFixedFareReservationDetail.fixedFare.confirmedFareYen).toBe(3740)
    expect(reviewDemoConfirmedFareBreakdownTotalYen).toBe(4840)
    expect(reviewDemoPreFixedFareReservationDetail.trip.pickupAddress).toBe('中央区出洲港8-3-2')
    expect(reviewDemoPreFixedFareReservationDetail.trip.destinationAddress).toBe('千葉メディカルセンター')
    expect(reviewDemoPreFixedFareReservationDetail.consent.consentAt).toBeTruthy()
    expect(reviewDemoPreFixedFareReservationDetail.meterRunStatus).toBe('not_started')
    expect(reviewDemoPreFixedFareReservationDetail.fixedFare.fareType).toBe('事前確定運賃')
  })
})

describe('review demo production write guards', () => {
  beforeEach(() => {
    setReviewDemoRuntimeEnabled(true)
  })

  afterEach(() => {
    setReviewDemoRuntimeEnabled(false)
  })

  it('blocks production write functions while review demo runtime is enabled', async () => {
    await expect(
      generateCaseNumber({ storeId: 'store', storeName: 'store' }),
    ).rejects.toThrow(/generateCaseNumber/)

    await expect(
      saveCaseRecord({
        caseNumber: 'TEST-001',
        closedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        distanceKm: 0,
        chargeableDistanceKm: 0,
        businessDistanceKm: 0,
        drivingSeconds: 0,
        workSession: null,
        vehicle: null,
        fareBreakdown: {
          meterMode: 'fixed',
          totalFareYen: 4840,
        } as never,
        paymentMethod: '現金',
        pickupLocation: {
          address: '',
          capturedAt: null,
          latitude: null,
          longitude: null,
        },
        selectedCareOptions: [],
        selectedExpenses: [],
        dropoffLocation: {
          address: '',
          capturedAt: null,
          latitude: null,
          longitude: null,
        },
      }),
    ).rejects.toThrow(/saveCaseRecord/)

    await expect(
      recordReceiptReissue({ id: 'demo', receiptReissues: [] } as never, { reason: 'test' }),
    ).rejects.toThrow(/recordReceiptReissue/)

    await startFixedFareRun(REVIEW_DEMO_RESERVATION_ID)
    await completeFixedFareRun(REVIEW_DEMO_RESERVATION_ID)
    await resetFixedFareRun(REVIEW_DEMO_RESERVATION_ID, {
      confirmReservationId: REVIEW_DEMO_RESERVATION_ID,
    })

    await claimVehicleForCaseStart({
      vehicleId: 'demo-vehicle',
      staffId: 'demo',
      staffName: 'demo',
      workSessionId: 'demo',
    })

    await updateWorkSessionActiveTrip({
      workSessionId: 'demo',
      status: '走行中',
      caseNumber: 'DEMO-001',
    })

    await expect(
      saveGpsRoute({
        caseRecordId: 'demo',
        caseNumber: 'DEMO-001',
        franchiseeId: 'demo',
        storeId: 'demo',
        staffId: 'demo',
        staffName: 'demo',
        vehicleId: 'demo',
        vehicleName: 'demo',
        closedAt: new Date().toISOString(),
        logs: [],
      }),
    ).resolves.toBe(false)

    await expect(thermalPrinterService.connectIfNeeded()).rejects.toThrow(/connectIfNeeded/)
    await expect(thermalPrinterService.printReceipt(new Uint8Array([1]))).rejects.toThrow(/printReceipt/)
  })

  it('does not call reservation-v4 fetch during guarded API functions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await startFixedFareRun(REVIEW_DEMO_RESERVATION_ID)
    await completeFixedFareRun(REVIEW_DEMO_RESERVATION_ID)

    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
