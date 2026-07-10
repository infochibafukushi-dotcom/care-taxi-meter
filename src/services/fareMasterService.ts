/**
 * 料金マスター取得（reservation-v4 API）
 */
const DEFAULT_API_BASE =
  import.meta.env.VITE_RESERVATION_API_BASE ||
  'https://throbbing-bush-8f59.info-chibafukushi.workers.dev'

const CACHE_KEY = 'careTaxiMeterFareMasterCache'
const CACHE_TTL_MS = 5 * 60 * 1000

export type FareMasterMeterPayload = {
  fareMasterId: string | null
  fareVersionId: string | null
  fareVersion: string | null
  fareSource: string
  fallbackReason?: string | null
  meterSettings: Record<string, unknown>
  calculationRules: Record<string, unknown>
  fareSnapshot: Record<string, unknown>
}

type CacheEntry = { fetchedAt: number; data: FareMasterMeterPayload }

function readCache(): FareMasterMeterPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(data: FareMasterMeterPayload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data }))
  } catch {
    /* ignore */
  }
}

export async function fetchActiveFareMaster({
  apiBase = DEFAULT_API_BASE,
  franchiseeId,
  storeId,
  token,
}: {
  apiBase?: string
  franchiseeId?: string
  storeId?: string
  token?: string
} = {}): Promise<FareMasterMeterPayload> {
  const params = new URLSearchParams()
  if (franchiseeId) params.set('franchiseeId', franchiseeId)
  if (storeId) params.set('storeId', storeId)
  const url = `${apiBase.replace(/\/$/, '')}/api/driver/fare-master/active${params.toString() ? `?${params}` : ''}`
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers, cache: 'no-store' })
  if (!res.ok) throw new Error(`fare master HTTP ${res.status}`)
  const data = await res.json()
  if (!data?.success) throw new Error(data?.message || 'fare master fetch failed')
  const payload: FareMasterMeterPayload = {
    fareMasterId: data.fareMasterId ?? null,
    fareVersionId: data.fareVersionId ?? null,
    fareVersion: data.fareVersion ?? null,
    fareSource: data.fareSource || 'active_master',
    fallbackReason: data.fallbackReason ?? null,
    meterSettings: data.meterSettings || {},
    calculationRules: data.calculationRules || {},
    fareSnapshot: data.fareSnapshot || {},
  }
  writeCache(payload)
  return payload
}

export async function resolveFareMasterForMeter(scope: {
  apiBase?: string
  franchiseeId?: string
  storeId?: string
  token?: string
}): Promise<FareMasterMeterPayload> {
  try {
    return await fetchActiveFareMaster(scope)
  } catch (error) {
    const cached = readCache()
    if (cached) {
      return { ...cached, fareSource: 'cached_master', fallbackReason: String(error) }
    }
    throw error
  }
}

/** 予約 serviceFees でメーター careOptions へ載せないキー */
export const SERVICE_FEE_KEYS_EXCLUDED_FROM_METER_READD = new Set([
  'pickupFee',
  'specialVehicleFee',
  'waitingFee',
  'escortFee',
  'waiting30min',
  'escort30min',
])

export function shouldExcludeServiceFeeFromMeterReadd(feeKey: string): boolean {
  return SERVICE_FEE_KEYS_EXCLUDED_FROM_METER_READD.has(feeKey)
}

export const STAIR_FLOOR_OPTIONS = [
  { id: 'stair-floor2', label: '2階', amount: 3000 },
  { id: 'stair-floor3', label: '3階', amount: 5000 },
  { id: 'stair-floor4', label: '4階', amount: 7000 },
  { id: 'stair-floor5', label: '5階以上', amount: 10000 },
] as const
