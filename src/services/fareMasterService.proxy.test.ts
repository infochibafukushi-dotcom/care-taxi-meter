import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildActiveFareMasterUrl,
  fetchActiveFareMaster,
  readScopedFareMasterCache,
  resolveFareMasterDriverApiRoot,
} from './fareMasterService'

vi.mock('./reservationApi', () => ({
  getReservationDriverApiBaseUrl: () => 'https://proxy.example.com/api/driver',
}))

function mockLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

const activePayload = {
  success: true,
  fareSource: 'active_master',
  fareMasterId: 'fmv-headquarters-v1',
  fareVersionId: 'fmv-headquarters-v1',
  fareVersion: 'v1',
  meterSettings: {
    waitingFare: { unitSeconds: 1800, unitFareYen: 800 },
    escortFare: { unitSeconds: 1800, unitFareYen: 1600 },
    timeMeter: { baseAmountYen: 4180 },
  },
  calculationRules: {},
  fareSnapshot: { fareMasterId: 'fmv-headquarters-v1' },
}

describe('fareMasterService proxy integration', () => {
  beforeEach(() => {
    mockLocalStorage()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds driver-proxy fare master URL', () => {
    expect(buildActiveFareMasterUrl({ franchiseeId: 'fc-1' })).toBe(
      'https://proxy.example.com/api/driver/fare-master/active?franchiseeId=fc-1',
    )
    expect(resolveFareMasterDriverApiRoot()).toBe('https://proxy.example.com/api/driver')
  })

  it('fetches active_master via proxy without Authorization header', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(activePayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const payload = await fetchActiveFareMaster({ franchiseeId: 'fc-1', storeId: 'store-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/api/driver/fare-master/active?franchiseeId=fc-1&storeId=store-1',
      { cache: 'no-store' },
    )
    expect(payload.fareSource).toBe('active_master')
    expect(payload.fareMasterId).toBe('fmv-headquarters-v1')
    expect(readScopedFareMasterCache('fc-1', 'store-1')?.fareMasterId).toBe('fmv-headquarters-v1')
  })
})
