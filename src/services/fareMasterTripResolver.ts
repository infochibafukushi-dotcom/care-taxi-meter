/**
 * 運行時料金解決 — D1料金マスター > キャッシュ > システムフォールバック
 * Firestore meterSettings は料金正本ではなく端末互換設定
 */
import type { CareOptionMasterItem, DispatchMenuItem, SpecialVehicleMenuItem } from './fare'
import {
  basicFareSettings,
  careOptionMaster,
  dispatchMenuMaster,
  escortFareSettings,
  specialVehicleMenuMaster,
  waitingFareSettings,
  type BasicFareSettings,
  type TimeFareSettings,
} from './fare'
import type { ReservationTripContext } from './reservationTripContext'
import {
  fetchActiveFareMaster,
  readScopedFareMasterCache,
  type FareMasterMeterPayload,
} from './fareMasterService'

export type TripFareSource =
  | 'reservation_snapshot'
  | 'active_master'
  | 'cached_master'
  | 'system_fallback'

export type TripFarePricing = {
  basicFare: BasicFareSettings
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  assistItems: CareOptionMasterItem[]
  dispatchMenuItems: DispatchMenuItem[]
  specialVehicleMenuItems: SpecialVehicleMenuItem[]
}

export type EffectiveFareMeta = {
  fareSource: TripFareSource
  fareMasterId: string | null
  fareVersionId: string | null
  fareVersion: string | null
  fallbackReason?: string | null
  effectiveFareSnapshot: Record<string, unknown>
  reservationFareSnapshot?: Record<string, unknown> | null
  capturedAt: string
}

function readLongLivedCache(franchiseeId?: string, storeId?: string): FareMasterMeterPayload | null {
  return readScopedFareMasterCache(franchiseeId, storeId)
}

function mapAssistItems(raw: unknown): CareOptionMasterItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return careOptionMaster
  return raw.map((item, index) => {
    const row = item as Record<string, unknown>
    return {
      id: String(row.id || `assist-${index}`),
      name: String(row.name || ''),
      amount: Math.max(Number(row.amount) || 0, 0),
      enabled: row.enabled !== false,
      sortOrder: Number(row.sortOrder) || index + 1,
    }
  })
}

function mapMenuItems<T extends { id: string; name: string; amount: number; enabled: boolean; sortOrder: number }>(
  raw: unknown,
  fallback: T[],
): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback
  return raw.map((item, index) => {
    const row = item as Record<string, unknown>
    return {
      id: String(row.id || `item-${index}`),
      name: String(row.name || ''),
      amount: Math.max(Number(row.amount) || 0, 0),
      enabled: row.enabled !== false,
      sortOrder: Number(row.sortOrder) || index + 1,
    } as T
  })
}

export function mapFareMasterPayloadToPricing(payload: FareMasterMeterPayload): TripFarePricing {
  const m = payload.meterSettings || {}
  const basic = (m.basicFare || {}) as Record<string, number>
  const waiting = (m.waitingFare || {}) as Record<string, number>
  const escort = (m.escortFare || {}) as Record<string, number>

  return {
    basicFare: {
      initialDistanceKm: basic.initialDistanceKm ?? basicFareSettings.initialDistanceKm,
      initialFareYen: basic.initialFareYen ?? basicFareSettings.initialFareYen,
      additionalDistanceKm: basic.additionalDistanceKm ?? basicFareSettings.additionalDistanceKm,
      additionalFareYen: basic.additionalFareYen ?? basicFareSettings.additionalFareYen,
    },
    waitingFare: {
      unitSeconds: waiting.unitSeconds ?? waitingFareSettings.unitSeconds,
      unitFareYen: waiting.unitFareYen ?? waitingFareSettings.unitFareYen,
    },
    escortFare: {
      unitSeconds: escort.unitSeconds ?? escortFareSettings.unitSeconds,
      unitFareYen: escort.unitFareYen ?? escortFareSettings.unitFareYen,
    },
    assistItems: mapAssistItems(m.assistItems),
    dispatchMenuItems: mapMenuItems(m.dispatchMenuItems, dispatchMenuMaster),
    specialVehicleMenuItems: mapMenuItems(m.specialVehicleMenuItems, specialVehicleMenuMaster),
  }
}

function buildSystemFallbackPayload(): FareMasterMeterPayload {
  return {
    fareMasterId: null,
    fareVersionId: null,
    fareVersion: null,
    fareSource: 'system_fallback',
    fallbackReason: 'fare_master_unavailable',
    meterSettings: {
      basicFare: basicFareSettings,
      waitingFare: waitingFareSettings,
      escortFare: escortFareSettings,
      assistItems: careOptionMaster,
      dispatchMenuItems: dispatchMenuMaster,
      specialVehicleMenuItems: specialVehicleMenuMaster,
    },
    calculationRules: {},
    fareSnapshot: {},
  }
}

export function buildReservationSnapshotMeta(
  context: ReservationTripContext | null,
): EffectiveFareMeta | null {
  if (!context?.quoteSnapshot) return null
  const snapshot = context.quoteSnapshot as Record<string, unknown>
  const fareMasterId =
    (typeof snapshot.fareMasterId === 'string' && snapshot.fareMasterId) ||
    (typeof snapshot.fareVersionId === 'string' && snapshot.fareVersionId) ||
    null
  if (!fareMasterId && !snapshot.fixedFareTotal) return null
  return {
    fareSource: 'reservation_snapshot',
    fareMasterId,
    fareVersionId: fareMasterId,
    fareVersion:
      typeof snapshot.fareVersion === 'string' ? snapshot.fareVersion : null,
    effectiveFareSnapshot: {
      fareMasterId,
      fareVersionId: fareMasterId,
      fareVersion: snapshot.fareVersion ?? null,
      quoteSnapshot: snapshot,
      reservationId: context.reservationId,
      capturedAt: new Date().toISOString(),
    },
    reservationFareSnapshot: snapshot,
    capturedAt: new Date().toISOString(),
  }
}

export async function resolveTripFareForMeter({
  franchiseeId,
  storeId,
  reservationContext = null,
  preferReservationSnapshot = true,
}: {
  franchiseeId?: string
  storeId?: string
  token?: string
  reservationContext?: ReservationTripContext | null
  preferReservationSnapshot?: boolean
}): Promise<{ pricing: TripFarePricing; meta: EffectiveFareMeta }> {
  if (preferReservationSnapshot) {
    const reservationMeta = buildReservationSnapshotMeta(reservationContext)
    if (reservationMeta) {
      const cached = readLongLivedCache(franchiseeId, storeId)
      const pricing = cached
        ? mapFareMasterPayloadToPricing(cached)
        : mapFareMasterPayloadToPricing(buildSystemFallbackPayload())
      return { pricing, meta: reservationMeta }
    }
  }

  try {
    const payload = await fetchActiveFareMaster({ franchiseeId, storeId })
    const source = payload.fareSource === 'cached_master' ? 'cached_master' : 'active_master'
    return {
      pricing: mapFareMasterPayloadToPricing(payload),
      meta: {
        fareSource: source as TripFareSource,
        fareMasterId: payload.fareMasterId,
        fareVersionId: payload.fareVersionId,
        fareVersion: payload.fareVersion,
        fallbackReason: payload.fallbackReason ?? null,
        effectiveFareSnapshot: payload.fareSnapshot,
        capturedAt: new Date().toISOString(),
      },
    }
  } catch (error) {
    const cached = readLongLivedCache(franchiseeId, storeId)
    if (cached) {
      return {
        pricing: mapFareMasterPayloadToPricing(cached),
        meta: {
          fareSource: 'cached_master',
          fareMasterId: cached.fareMasterId,
          fareVersionId: cached.fareVersionId,
          fareVersion: cached.fareVersion,
          fallbackReason: String(error),
          effectiveFareSnapshot: cached.fareSnapshot,
          capturedAt: new Date().toISOString(),
        },
      }
    }
    const fallback = buildSystemFallbackPayload()
    return {
      pricing: mapFareMasterPayloadToPricing(fallback),
      meta: {
        fareSource: 'system_fallback',
        fareMasterId: null,
        fareVersionId: null,
        fareVersion: null,
        fallbackReason: String(error),
        effectiveFareSnapshot: fallback.fareSnapshot,
        capturedAt: new Date().toISOString(),
      },
    }
  }
}

export function applyTripFarePricingToState(
  pricing: TripFarePricing,
  setters: {
    setBasicFare: (v: BasicFareSettings) => void
    setWaitingFare: (v: TimeFareSettings) => void
    setEscortFare: (v: TimeFareSettings) => void
    setAssistItems: (v: CareOptionMasterItem[]) => void
    setDispatchItems: (v: DispatchMenuItem[]) => void
    setSpecialVehicleItems: (v: SpecialVehicleMenuItem[]) => void
  },
) {
  setters.setBasicFare(pricing.basicFare)
  setters.setWaitingFare(pricing.waitingFare)
  setters.setEscortFare(pricing.escortFare)
  setters.setAssistItems(pricing.assistItems)
  setters.setDispatchItems(pricing.dispatchMenuItems)
  setters.setSpecialVehicleItems(pricing.specialVehicleMenuItems)
}
