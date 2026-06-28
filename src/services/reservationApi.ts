import type {
  DriverReservationDetail,
  DriverReservationDetailApi,
  DriverReservationDetailResponseApi,
  DriverReservationListItemApi,
  DriverReservationSummary,
  DriverReservationsListResponseApi,
} from '../types/reservation'
import {
  mapPreFixedFareExceptionFromApi,
  type CompleteFixedFareRunPayload,
} from '../types/preFixedFare'

type ReservationApiErrorBody = {
  error?: string
  message?: string
  success?: boolean
}

export class ReservationApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ReservationApiError'
    this.status = status
  }
}

const normalizeUrlPrefix = (value: string) => value.replace(/\/+$/, '')

/**
 * Driver API root path.
 * - Local dev (empty VITE_RESERVATION_API_BASE_URL): /care-taxi-meter/api/driver
 * - Production proxy: ${VITE_RESERVATION_API_BASE_URL}/api/driver
 */
export const getReservationDriverApiBaseUrl = () => {
  const configuredBase = (import.meta.env.VITE_RESERVATION_API_BASE_URL ?? '').trim()
  if (configuredBase) {
    return `${normalizeUrlPrefix(configuredBase)}/api/driver`
  }

  return `${normalizeUrlPrefix(import.meta.env.BASE_URL || '/')}/api/driver`
}

const buildReservationApiUrl = (relativePath: string) => {
  const suffix = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  return `${getReservationDriverApiBaseUrl()}${suffix}`
}

const parseErrorMessage = async (response: Response) => {
  try {
    const body = (await response.json()) as ReservationApiErrorBody
    if (body.error?.trim()) {
      return body.error.trim()
    }
    if (body.message?.trim()) {
      return body.message.trim()
    }
  } catch {
    // ignore JSON parse errors
  }

  return ''
}

const reservationErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return '予約 API から不正な応答を受信しました。開発時は Vite プロキシ設定を確認してください。'
  }

  const bodyMessage = await parseErrorMessage(response)

  if (response.status === 401) {
    return bodyMessage || '予約 API の認証に失敗しました。'
  }

  if (response.status === 404) {
    return bodyMessage || '予約が見つかりません。'
  }

  return bodyMessage || `予約 API の取得に失敗しました。（HTTP ${response.status}）`
}

const parseReservationJsonResponse = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ReservationApiError(
      response.status,
      '予約 API から不正な応答を受信しました。開発時は Vite プロキシ設定を確認してください。',
    )
  }

  return (await response.json()) as T
}

async function requestReservationApi<T>(relativePath: string): Promise<T> {
  const response = await fetch(buildReservationApiUrl(relativePath), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new ReservationApiError(response.status, await reservationErrorMessage(response))
  }

  return parseReservationJsonResponse<T>(response)
}

type FixedFareRunActionResponseApi = {
  success: boolean
  message?: string
}

const postReservationErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return '予約 API から不正な応答を受信しました。開発時は Vite プロキシ設定を確認してください。'
  }

  const bodyMessage = await parseErrorMessage(response)

  if (response.status === 401) {
    return bodyMessage || '予約 API の認証に失敗しました。'
  }

  if (response.status === 404) {
    return bodyMessage || '予約が見つかりません。'
  }

  if (response.status === 409) {
    return bodyMessage || '運行状態が競合しています。画面を再読み込みしてください。'
  }

  if (response.status === 422) {
    return bodyMessage || '予約の整合性検証に失敗しました。'
  }

  return bodyMessage || `予約 API の処理に失敗しました。（HTTP ${response.status}）`
}

async function postReservationApi<T>(
  relativePath: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(buildReservationApiUrl(relativePath), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new ReservationApiError(response.status, await postReservationErrorMessage(response))
  }

  return parseReservationJsonResponse<T>(response)
}

export const mapDriverReservationListItem = (
  item: DriverReservationListItemApi,
): DriverReservationSummary => ({
  ...item,
})

export const mapDriverReservationDetail = (
  reservation: DriverReservationDetailApi,
): DriverReservationDetail => ({
  reservationId: reservation.reservationId,
  estimateNo: reservation.estimateNo,
  status: reservation.status,
  meterRunStatus: reservation.meterRunStatus,
  scheduledAt: reservation.scheduledAt,
  customer: reservation.customer,
  trip: reservation.trip,
  fixedFare: reservation.fixedFare,
  consent: reservation.consent,
  quoteSnapshot: reservation.quoteSnapshot,
  routePlan: reservation.routePlan,
  integrity: reservation.integrity,
  franchiseeId: reservation.franchiseeId,
  storeId: reservation.storeId,
  snapshotHashVerified: reservation.integrity.snapshotHashVerified,
  fareMatch: reservation.integrity.confirmedFareMatchesSnapshot,
  fixedFareCompletionStatus: reservation.fixedFareCompletionStatus ?? null,
  fixedFareCompletionReason: reservation.fixedFareCompletionReason ?? null,
  preFixedFareException: mapPreFixedFareExceptionFromApi(reservation.preFixedFareException),
})

export async function fetchDriverReservations(date: string): Promise<{
  date: string
  reservations: DriverReservationSummary[]
}> {
  const encodedDate = encodeURIComponent(date)
  const response = await requestReservationApi<DriverReservationsListResponseApi>(
    `/reservations?date=${encodedDate}`,
  )

  if (!response.success) {
    throw new ReservationApiError(500, '予約一覧の取得に失敗しました。')
  }

  return {
    date: response.date,
    reservations: response.reservations.map(mapDriverReservationListItem),
  }
}

export async function fetchDriverReservation(
  reservationId: string,
): Promise<DriverReservationDetail> {
  const encodedReservationId = encodeURIComponent(reservationId)
  const response = await requestReservationApi<DriverReservationDetailResponseApi>(
    `/reservations/${encodedReservationId}`,
  )

  if (!response.success || !response.reservation) {
    throw new ReservationApiError(500, '予約詳細の取得に失敗しました。')
  }

  return mapDriverReservationDetail(response.reservation)
}

export async function startFixedFareRun(reservationId: string): Promise<void> {
  const encodedReservationId = encodeURIComponent(reservationId)
  const response = await postReservationApi<FixedFareRunActionResponseApi>(
    `/reservations/${encodedReservationId}/start-fixed-fare`,
  )

  if (!response.success) {
    throw new ReservationApiError(500, response.message?.trim() || '事前確定Mの開始に失敗しました。')
  }
}

export async function completeFixedFareRun(
  reservationId: string,
  completion?: CompleteFixedFareRunPayload,
): Promise<void> {
  const encodedReservationId = encodeURIComponent(reservationId)
  const body: Record<string, unknown> = {}

  if (completion?.completionStatus) {
    body.completionStatus = completion.completionStatus
  }

  if (completion?.completionReason) {
    body.completionReason = completion.completionReason
  }

  if (completion?.preFixedFareException) {
    body.preFixedFareException = completion.preFixedFareException
  }

  const response = await postReservationApi<FixedFareRunActionResponseApi>(
    `/reservations/${encodedReservationId}/complete-fixed-fare`,
    body,
  )

  if (!response.success) {
    throw new ReservationApiError(500, response.message?.trim() || '事前確定Mの完了に失敗しました。')
  }
}
