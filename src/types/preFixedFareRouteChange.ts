/** 事前確定Mのルート変更パターン */
export type PreFixedFareRouteChangePattern =
  | 'add_stop'
  | 'change_destination'
  | 'add_stop_and_change_destination'
  | 'end_here'
  | 'traffic_detour'

export const preFixedFareRouteChangePatternLabels: Record<
  PreFixedFareRouteChangePattern,
  string
> = {
  add_stop: '① 立ち寄り追加',
  change_destination: '② 目的地変更',
  add_stop_and_change_destination: '③ 立ち寄り追加＋目的地変更',
  end_here: '④ ここで終了',
  traffic_detour: '⑤ 交通規制・迂回',
}

export const passengerRequestedRouteChangePatterns: PreFixedFareRouteChangePattern[] = [
  'add_stop',
  'change_destination',
  'add_stop_and_change_destination',
  'end_here',
]

export type PreFixedFareRouteStopRole = 'S' | 'G' | 'via' | 'current'

export type PreFixedFareRouteStop = {
  id: string
  role: PreFixedFareRouteStopRole
  label: string
  address: string
  latitude?: number | null
  longitude?: number | null
}

export type PreFixedFareRouteCandidate = {
  id: string
  label: string
  distanceKm: number
  durationSeconds: number
  additionalFareYen: number
  summary: string
  useToll: boolean
}

export type PreFixedFareRouteChangeLocation = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  address: string
  capturedAt: string
}

export type PreFixedFareRouteChangeLog = {
  changedAt: string
  location: PreFixedFareRouteChangeLocation
  pattern: PreFixedFareRouteChangePattern
  reason: string
  routeBefore: string
  routeAfter: string
  selectedRouteId: string
  selectedRouteSummary: string
  additionalDistanceKm: number
  additionalDurationSeconds: number
  additionalRouteFareYen: number
  additionalCareFareYen: number
  waitingFareYen: number
  escortFareYen: number
  totalFareYen: number
  consentAt: string | null
  consentMethod: string
  navigationStartedAt: string | null
  driverName: string
  caseId: string
  reservationId: string
}

export type PreFixedFareConfirmedRouteView = {
  overallRouteLabel: string
  stops: PreFixedFareRouteStop[]
  pickupAddress: string
  dropoffAddress: string
  viaAddresses: string[]
  distanceMeters: number | null
  durationSeconds: number | null
  useToll: boolean
  confirmedFareYen: number
  consentAt: string
  snapshotHash: string
  reservationId: string
  fareBreakdownLines: Array<{ label: string; amountYen: number }>
}
