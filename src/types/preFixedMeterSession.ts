import type { AssistItem } from '../services/fare'

/**
 * 事前確定Mの現場作成セッション。
 *
 * UI / CasePage の meterMode は既存互換のため `"fixed"` を使用する。
 * 監査・帳票・案件保存の fareMode は `"pre_fixed_fare"`（@see preFixedFare.ts）。
 */

/** 事前確定Mの送迎タイプ */
export type PreFixedTripType = 'one_way' | 'round_trip' | 'with_stops'

export const preFixedTripTypeLabels: Record<PreFixedTripType, string> = {
  one_way: '片道送迎',
  round_trip: '往復送迎',
  with_stops: '立ち寄りあり',
}

export type RoutePointSource =
  | 'reservation'
  | 'manual'
  | 'gps'
  | 'facility_search'
  | 'facility_block'
  | 'unknown'

export type RoutePoint = {
  label: string
  address: string
  facilityName?: string
  lat?: number
  lng?: number
  source: RoutePointSource
}

export type PreFixedRouteCandidateId = 'A' | 'B' | 'C' | 'D'

export type PreFixedRouteSegment = {
  fromLabel: string
  toLabel: string
  distanceMeters: number
  durationSeconds: number
}

export type PreFixedRouteCandidate = {
  id: PreFixedRouteCandidateId
  label: string
  distanceMeters: number
  durationSeconds: number
  fixedFareYen: number
  serviceFeesYen: number
  totalYen: number
  polyline?: string
  tollIncluded?: boolean
  segments?: PreFixedRouteSegment[]
  stopOrderLabels?: string[]
}

export type ManualRouteKind = 'single' | 'multi'

export type ManualWaitingEscortPlan = 'none' | 'waiting' | 'escort' | 'both'

export type PreFixedManualFareSelection = {
  dispatchEnabled: boolean
  dispatchFareYen: number
  specialVehicleEnabled: boolean
  specialVehicleFareYen: number
  boardingAssist: boolean
  boardingAssistFareYen: number
  bodyAssist: boolean
  bodyAssistFareYen: number
  stairsAssist: boolean
  stairFloorId?: string
  stairFloorLabel?: string
  stairAssistFareYen: number
  equipmentItems: Array<{ id: string; name: string; amountYen: number }>
  waitingEscortPlan: ManualWaitingEscortPlan
  waitingFirstUnitYen: number
  escortFirstUnitYen: number
  waitingUnitSeconds: number
  escortUnitSeconds: number
  waitingUnitFareYen: number
  escortUnitFareYen: number
}

export const preFixedRouteCandidateLabels: Record<PreFixedRouteCandidateId, string> = {
  A: '推奨ルート',
  B: '距離優先',
  C: '時間優先',
  D: '別ルート',
}

export type PreFixedSourceFlow =
  | 'fixed_reservation'
  | 'normal_reservation'
  | 'phone_reservation'
  | 'manual'

export type PreFixedMeterSessionStatus =
  | 'draft'
  | 'quoted'
  | 'agreed'
  | 'started'
  | 'completed'
  | 'terminated_by_route_change'

export type PreFixedMeterSession = {
  id: string
  meterMode: 'fixed'
  sourceFlow: PreFixedSourceFlow
  tripType: PreFixedTripType
  reservationId?: string
  caseId?: string
  pickup: RoutePoint
  stops: RoutePoint[]
  destination: RoutePoint
  selectedServiceItems: AssistItem[]
  routeCandidates: PreFixedRouteCandidate[]
  selectedRouteId: PreFixedRouteCandidateId
  fare: {
    fixedFareYen: number
    serviceFeesYen: number
    actualExpensesYen: number
    totalYen: number
  }
  consent: {
    status: 'not_agreed' | 'agreed'
    agreedAt?: string
    agreedBy?: string
    termsVersion: string
  }
  status: PreFixedMeterSessionStatus
  createdAt: string
  updatedAt: string
  /** 予約なし手動フロー（v2）— 既存セッションには存在しない */
  manualFlowVersion?: 2
  routeKind?: ManualRouteKind
  savedInitialPickup?: RoutePoint
  orderedDestinations?: RoutePoint[]
  fareSelection?: PreFixedManualFareSelection
  preFixedTotalYen?: number
  fareSettingsSnapshot?: Record<string, unknown>
}

export const PRE_FIXED_CONSENT_TERMS_VERSION = '2026-07-01'
