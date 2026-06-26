/**
 * 事前確定運賃の監査・帳票・外部連携向けの正式識別子。
 *
 * meterMode: "fixed" は既存メーター内部制御用の互換値。
 * 事前確定運賃としての正式な監査識別子は fareMode: "pre_fixed_fare"。
 */
export const FARE_MODE_PRE_FIXED = 'pre_fixed_fare' as const

export type FareMode = typeof FARE_MODE_PRE_FIXED

export type PreFixedFareExceptionType = 'passenger_requested_change'

export type CompletionReason = 'passenger_requested_route_change'

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
