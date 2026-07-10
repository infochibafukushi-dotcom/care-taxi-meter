/**
 * 料金マスター取得（driver-proxy 経由 → reservation-v4）
 */
import { getReservationDriverApiBaseUrl } from './reservationApi'

const CACHE_KEY = 'careTaxiMeterFareMasterCache'

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

export function buildFareMasterCacheKey(franchiseeId?: string, storeId?: string) {
  return `${CACHE_KEY}:${franchiseeId ?? ''}:${storeId ?? ''}`
}

export function readScopedFareMasterCache(
  franchiseeId?: string,
  storeId?: string,
): FareMasterMeterPayload | null {
  try {
    const raw = localStorage.getItem(buildFareMasterCacheKey(franchiseeId, storeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    return parsed.data
  } catch {
    return null
  }
}

function writeScopedFareMasterCache(
  data: FareMasterMeterPayload,
  franchiseeId?: string,
  storeId?: string,
) {
  try {
    localStorage.setItem(
      buildFareMasterCacheKey(franchiseeId, storeId),
      JSON.stringify({ fetchedAt: Date.now(), data }),
    )
  } catch {
    /* ignore */
  }
}

export function resolveFareMasterDriverApiRoot(apiBase?: string) {
  const configured = apiBase?.trim()
  if (configured) {
    return configured.replace(/\/$/, '')
  }
  return getReservationDriverApiBaseUrl().replace(/\/$/, '')
}

export function buildActiveFareMasterUrl({
  apiBase,
  franchiseeId,
  storeId,
}: {
  apiBase?: string
  franchiseeId?: string
  storeId?: string
}) {
  const root = resolveFareMasterDriverApiRoot(apiBase)
  const params = new URLSearchParams()
  if (franchiseeId) params.set('franchiseeId', franchiseeId)
  if (storeId) params.set('storeId', storeId)
  const query = params.toString() ? `?${params}` : ''
  if (root.endsWith('/api/driver')) {
    return `${root}/fare-master/active${query}`
  }
  return `${root}/api/driver/fare-master/active${query}`
}

export async function fetchActiveFareMaster({
  apiBase,
  franchiseeId,
  storeId,
}: {
  apiBase?: string
  franchiseeId?: string
  storeId?: string
  token?: string
} = {}): Promise<FareMasterMeterPayload> {
  const url = buildActiveFareMasterUrl({ apiBase, franchiseeId, storeId })
  const res = await fetch(url, { cache: 'no-store' })
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
  writeScopedFareMasterCache(payload, franchiseeId, storeId)
  return payload
}

export async function resolveFareMasterForMeter(scope: {
  apiBase?: string
  franchiseeId?: string
  storeId?: string
}): Promise<FareMasterMeterPayload> {
  try {
    return await fetchActiveFareMaster(scope)
  } catch (error) {
    const cached = readScopedFareMasterCache(scope.franchiseeId, scope.storeId)
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
