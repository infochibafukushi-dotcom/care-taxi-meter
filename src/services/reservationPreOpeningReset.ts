import type { DriverReservationSummary } from '../types/reservation'
import type { TenantScope } from './tenancy'
import { fetchDriverReservations } from './reservationApi'

const PRE_OPENING_RESET_LOOKBACK_DAYS = 120
const DATE_BATCH_SIZE = 7

export type ReservationApiDeleteCapability = {
  supported: boolean
  reason: string
}

export type ReservationPreOpeningDeleteResult = {
  deletedCount: number
  skipped: boolean
  message: string
}

type ReservationPreOpeningDeleteResponse = {
  success?: boolean
  deletedCount?: number
  message?: string
  error?: string
}

const normalizeUrlPrefix = (value: string) => value.replace(/\/+$/, '')

/** driver-proxy 経由の reservation-v4 管理者 API ベース URL */
export const getReservationAdminApiBaseUrl = () => {
  const configuredBase = (import.meta.env.VITE_RESERVATION_API_BASE_URL ?? '').trim()
  if (configuredBase) {
    return `${normalizeUrlPrefix(configuredBase)}/api/admin`
  }

  return `${normalizeUrlPrefix(import.meta.env.BASE_URL || '/')}/api/admin`
}

const buildReservationAdminApiUrl = (relativePath: string) => {
  const suffix = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  return `${getReservationAdminApiBaseUrl()}${suffix}`
}

const formatDateKey = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const buildLookbackDateKeys = (lookbackDays: number) => {
  const keys: string[] = []
  const today = new Date()

  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const target = new Date(today)
    target.setUTCDate(today.getUTCDate() - offset)
    keys.push(formatDateKey(target))
  }

  return keys
}

export const matchesReservationTenant = (
  reservation: Pick<DriverReservationSummary, 'franchiseeId' | 'storeId'>,
  scope: TenantScope,
) => {
  const franchiseeId = reservation.franchiseeId?.trim() ?? ''
  const storeId = reservation.storeId?.trim() ?? ''
  if (!franchiseeId || !storeId) {
    return false
  }

  return franchiseeId === scope.franchiseeId && storeId === scope.storeId
}

const uniqueReservationsById = (reservations: DriverReservationSummary[]) => {
  const byId = new Map<string, DriverReservationSummary>()
  for (const reservation of reservations) {
    if (!reservation.reservationId) {
      continue
    }
    byId.set(reservation.reservationId, reservation)
  }
  return [...byId.values()]
}

export async function countTenantReservationsFromApi(
  scope: TenantScope,
  lookbackDays = PRE_OPENING_RESET_LOOKBACK_DAYS,
): Promise<number> {
  const dateKeys = buildLookbackDateKeys(lookbackDays)
  const matched: DriverReservationSummary[] = []

  for (let offset = 0; offset < dateKeys.length; offset += DATE_BATCH_SIZE) {
    const batch = dateKeys.slice(offset, offset + DATE_BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (dateKey) => {
        try {
          const response = await fetchDriverReservations(dateKey)
          return response.reservations
        } catch {
          return []
        }
      }),
    )

    for (const reservations of batchResults) {
      for (const reservation of reservations) {
        if (matchesReservationTenant(reservation, scope)) {
          matched.push(reservation)
        }
      }
    }
  }

  return uniqueReservationsById(matched).length
}

/** reservation-v4 に管理者向け削除 API があるかを確認する */
export async function checkReservationPreOpeningDeleteCapability(): Promise<ReservationApiDeleteCapability> {
  try {
    const response = await fetch(
      buildReservationAdminApiUrl('/reservations/pre-opening-reset/capability'),
      {
        headers: { Accept: 'application/json' },
      },
    )

    if (response.status === 404 || response.status === 405) {
      return {
        supported: false,
        reason:
          '予約API（reservation-v4）に開業前リセット用の削除APIが未実装です。予約本体は削除されません。',
      }
    }

    if (!response.ok) {
      return {
        supported: false,
        reason: `予約APIの削除機能を確認できませんでした。（HTTP ${response.status}）`,
      }
    }

    const body = (await response.json()) as { supported?: boolean; reason?: string }
    if (body.supported) {
      return { supported: true, reason: '' }
    }

    return {
      supported: false,
      reason:
        body.reason?.trim() ||
        '予約API（reservation-v4）に開業前リセット用の削除APIが未実装です。予約本体は削除されません。',
    }
  } catch {
    return {
      supported: false,
      reason:
        '予約API（reservation-v4）に接続できないため、予約本体は削除されません。',
    }
  }
}

export async function deleteTenantReservationsPreOpening({
  franchiseeId,
  storeId,
  confirmText,
  executedBy,
}: TenantScope & {
  confirmText: string
  executedBy: string
}): Promise<ReservationPreOpeningDeleteResult> {
  const capability = await checkReservationPreOpeningDeleteCapability()
  if (!capability.supported) {
    return {
      deletedCount: 0,
      skipped: true,
      message: capability.reason,
    }
  }

  const response = await fetch(
    buildReservationAdminApiUrl('/reservations/pre-opening-reset'),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        franchiseeId,
        storeId,
        confirmText,
        executedBy,
      }),
    },
  )

  if (response.status === 404 || response.status === 405) {
    return {
      deletedCount: 0,
      skipped: true,
      message:
        '予約API（reservation-v4）に開業前リセット用の削除APIが未実装です。予約本体は削除されません。',
    }
  }

  let body: ReservationPreOpeningDeleteResponse = {}
  try {
    body = (await response.json()) as ReservationPreOpeningDeleteResponse
  } catch {
    body = {}
  }

  if (!response.ok) {
    const message =
      body.error?.trim() ||
      body.message?.trim() ||
      `予約APIの削除に失敗しました。（HTTP ${response.status}）`
    throw new Error(message)
  }

  return {
    deletedCount: typeof body.deletedCount === 'number' ? body.deletedCount : 0,
    skipped: false,
    message: body.message?.trim() || '予約API上の予約データを削除しました。',
  }
}
