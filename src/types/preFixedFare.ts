/**
 * 事前確定運賃の監査・帳票・外部連携向けの正式識別子。
 *
 * meterMode: "fixed" は既存メーター内部制御用の互換値。
 * 事前確定運賃としての正式な監査識別子は fareMode: "pre_fixed_fare"。
 */
export const FARE_MODE_PRE_FIXED = 'pre_fixed_fare' as const

export type FareMode = typeof FARE_MODE_PRE_FIXED

export type PreFixedFareExceptionType = 'passenger_requested_change'

export type CompletionReason = 'normal_completed' | 'passenger_requested_route_change'

export type PreFixedFareExceptionLocation = {
  lat: number | null
  lng: number | null
  accuracy: number | null
}

export type PreFixedFareException = {
  type: PreFixedFareExceptionType
  reasonLabel: string
  endedAt: string
  endedLocation: PreFixedFareExceptionLocation
  originalFixedFareYen: number
  fareModeBeforeEnd: FareMode
  nextOperationRequired: 'start_new_meter_trip'
  note: string
}

export const PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL =
  '旅客都合によるルート変更・立ち寄り追加'

export const PRE_FIXED_FARE_PASSENGER_CHANGE_NOTE =
  '旅客都合により当初走行予定ルートから変更。事前確定運賃運送を終了し、以後は別運送として扱う。'

export type PreFixedFareCompletionStatus = 'completed' | 'completed_with_passenger_change'

/** complete-fixed-fare API へ送る完了メタデータ（reservation-v4 未対応時は無視される可能性あり） */
export type CompleteFixedFareRunPayload = {
  completionStatus?: PreFixedFareCompletionStatus
  completionReason?: CompletionReason
  preFixedFareException?: Omit<PreFixedFareException, 'note'>
}

export function buildCompleteFixedFareRunPayload(
  exception: PreFixedFareException | null | undefined,
): CompleteFixedFareRunPayload | undefined {
  if (!exception) {
    return undefined
  }

  return {
    completionStatus: 'completed_with_passenger_change',
    completionReason: 'passenger_requested_route_change',
    preFixedFareException: {
      type: exception.type,
      reasonLabel: exception.reasonLabel,
      endedAt: exception.endedAt,
      endedLocation: exception.endedLocation,
      originalFixedFareYen: exception.originalFixedFareYen,
      fareModeBeforeEnd: exception.fareModeBeforeEnd,
      nextOperationRequired: exception.nextOperationRequired,
    },
  }
}

export const fixedFareCompletionStatusLabels: Record<PreFixedFareCompletionStatus, string> = {
  completed: '通常完了',
  completed_with_passenger_change: '旅客都合途中終了',
}

export const fixedFareCompletionReasonLabels: Record<CompletionReason, string> = {
  normal_completed: '通常完了',
  passenger_requested_route_change: PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL,
}

export const PRE_FIXED_FARE_PASSENGER_CHANGE_PANEL_TITLE =
  `事前確定運賃M：${PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL}のため途中終了`

export const PRE_FIXED_FARE_PASSENGER_CHANGE_NEXT_OPERATION_LABEL =
  '通常メーター等の別運送として開始'

export const formatFixedFareCompletionStatus = (status: string) =>
  fixedFareCompletionStatusLabels[status as PreFixedFareCompletionStatus] ?? status

export const formatFixedFareCompletionReason = (reason: string) =>
  fixedFareCompletionReasonLabels[reason as CompletionReason] ?? reason

const toNullableFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const mapPreFixedFareExceptionFromApi = (
  value: unknown,
): PreFixedFareException | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const source = value as Record<string, unknown>
  const type = typeof source.type === 'string' ? source.type : 'passenger_requested_change'

  if (type !== 'passenger_requested_change') {
    return null
  }

  const endedLocationSource =
    source.endedLocation && typeof source.endedLocation === 'object' && !Array.isArray(source.endedLocation)
      ? (source.endedLocation as Record<string, unknown>)
      : {}

  return {
    type: 'passenger_requested_change',
    reasonLabel:
      typeof source.reasonLabel === 'string' && source.reasonLabel.trim()
        ? source.reasonLabel
        : PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL,
    endedAt: typeof source.endedAt === 'string' ? source.endedAt : '',
    endedLocation: {
      lat: toNullableFiniteNumber(endedLocationSource.lat),
      lng: toNullableFiniteNumber(endedLocationSource.lng),
      accuracy: toNullableFiniteNumber(endedLocationSource.accuracy),
    },
    originalFixedFareYen:
      typeof source.originalFixedFareYen === 'number' && Number.isFinite(source.originalFixedFareYen)
        ? Math.max(Math.round(source.originalFixedFareYen), 0)
        : 0,
    fareModeBeforeEnd: FARE_MODE_PRE_FIXED,
    nextOperationRequired: 'start_new_meter_trip',
    note: typeof source.note === 'string' ? source.note : '',
  }
}

export type PreFixedFarePassengerChangeIndicators = {
  fixedFareCompletionStatus?: string | null
  fixedFareCompletionReason?: string | null
  preFixedFareException?: PreFixedFareException | null
}

export const isPreFixedFarePassengerChangeCompletion = (
  indicators: PreFixedFarePassengerChangeIndicators,
) =>
  indicators.fixedFareCompletionStatus === 'completed_with_passenger_change' ||
  indicators.fixedFareCompletionReason === 'passenger_requested_route_change' ||
  indicators.preFixedFareException != null

/** Firestore caseRecords に永続化する事前確定M開始コンテキスト */
export type PreFixedFareCaseContext = {
  sourceFlow: string
  reservationCategory?: 'pre_fixed' | 'normal' | 'phone'
  reservationId: string
  estimateNo?: string
  pickupAddress: string
  dropoffAddress: string
  viaAddresses: string[]
  selectedRouteId: string
  selectedRouteLabel?: string
  preFixedFareYen: number
  assistFareYen: number
  otherFareYen: number
  billingTotalYen: number
  consentAt: string
  consentAgreed: boolean
  consentTermsVersion?: string
  meterMode: 'fixed'
  fareMode: typeof FARE_MODE_PRE_FIXED
}
