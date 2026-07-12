import { beforeEach, describe, expect, it, vi } from 'vitest'

const memoryStorage = vi.hoisted(() => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
})

vi.stubGlobal('localStorage', memoryStorage)

vi.mock('./services/workSessions', () => ({
  fetchWorkSessionById: vi.fn(),
  fetchOpenWorkingWorkSession: vi.fn(),
  subscribeOpenWorkingWorkSession: vi.fn(),
  clockInWorkSession: vi.fn(),
  clockOutWorkSession: vi.fn(),
}))

vi.mock('./services/authSession', () => ({
  loadAuthStaffSession: vi.fn(),
}))

vi.mock('./utils/workLocation', () => ({
  captureWorkLocation: vi.fn(),
}))

vi.mock('./utils/diagnostics', () => ({
  logDiagnostic: vi.fn(),
}))

import {
  fetchOpenWorkingWorkSession,
  fetchWorkSessionById,
} from './services/workSessions'
import { loadAuthStaffSession } from './services/authSession'
import {
  __resetWorkSessionSharedStateForTests,
  hydrateWorkingSession,
  workSessionStorageKey,
} from './hooks/useWorkSession'
import type { WorkSession } from './types/work'

const openSession = (overrides: Partial<WorkSession> = {}): WorkSession => ({
  id: 'work-1',
  companyId: 'co-1',
  franchiseeId: 'co-1',
  companyName: 'テスト',
  storeId: 'store-1',
  storeName: '本店',
  staffId: 'staff-1',
  staffName: '太郎',
  staffRole: 'driver',
  clockInAt: '2026-07-12T00:00:00.000Z',
  clockOutAt: null,
  workSeconds: 0,
  clockInLatitude: null,
  clockInLongitude: null,
  clockInAccuracy: null,
  clockOutLatitude: null,
  clockOutLongitude: null,
  clockOutAccuracy: null,
  status: 'working',
  activeTripStatus: null,
  activeTripUpdatedAt: null,
  activeTripCaseNumber: null,
  activeTripVehicleId: null,
  ...overrides,
})

describe('hydrateWorkingSession', () => {
  beforeEach(() => {
    memoryStorage.clear()
    vi.clearAllMocks()
    __resetWorkSessionSharedStateForTests()
  })

  it('restores open session from localStorage after confirming by id', async () => {
    const session = openSession()
    memoryStorage.setItem(workSessionStorageKey, JSON.stringify(session))
    vi.mocked(fetchWorkSessionById).mockResolvedValue(session)

    const restored = await hydrateWorkingSession()

    expect(restored?.id).toBe('work-1')
    expect(vi.mocked(fetchWorkSessionById)).toHaveBeenCalledWith('work-1')
    expect(JSON.parse(memoryStorage.getItem(workSessionStorageKey) ?? '{}').id).toBe('work-1')
  })

  it('restores from auth open working session when localStorage empty', async () => {
    vi.mocked(loadAuthStaffSession).mockReturnValue({
      id: 'staff-1',
      companyId: 'co-1',
      franchiseeId: 'co-1',
      name: '太郎',
      role: 'driver',
      storeId: 'store-1',
      storeName: '本店',
    })
    const session = openSession()
    vi.mocked(fetchOpenWorkingWorkSession).mockResolvedValue(session)

    const restored = await hydrateWorkingSession()

    expect(restored?.id).toBe('work-1')
    expect(vi.mocked(fetchOpenWorkingWorkSession)).toHaveBeenCalled()
  })

  it('does not invent a session when nothing is open', async () => {
    vi.mocked(loadAuthStaffSession).mockReturnValue({
      id: 'staff-1',
      companyId: 'co-1',
      franchiseeId: 'co-1',
      name: '太郎',
      role: 'driver',
      storeId: 'store-1',
      storeName: '本店',
    })
    vi.mocked(fetchOpenWorkingWorkSession).mockResolvedValue(null)

    const restored = await hydrateWorkingSession()

    expect(restored).toBeNull()
    expect(memoryStorage.getItem(workSessionStorageKey)).toBeNull()
  })

  it('keeps local session when id confirm fails with network error', async () => {
    const session = openSession()
    memoryStorage.setItem(workSessionStorageKey, JSON.stringify(session))
    vi.mocked(fetchWorkSessionById).mockRejectedValue(new Error('offline'))

    const restored = await hydrateWorkingSession()

    expect(restored?.id).toBe('work-1')
  })
})
