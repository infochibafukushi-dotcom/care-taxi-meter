export type MeterMode = 'gps' | 'time' | 'obd'

export type OperationStatus =
  | '空車'
  | '待機中'
  | '院内付き添い中'
  | '走行中'
  | '精算前'
  | '精算修正'
  | '案件終了'

export type StatusTone =
  | 'vacant'
  | 'waiting'
  | 'accompanying'
  | 'driving'
  | 'settlement'
  | 'closed'

export type TimerKey = 'driving' | 'waiting' | 'accompanying'

export type ActivityHistoryType = 'waiting' | 'accompanying'

export type ActivityHistoryEntry = {
  endAt: string
  id: string
  startAt: string
  type: ActivityHistoryType
}

export type GpsPosition = {
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  updatedAt: number
}

export type MeterMovementState = 'normal' | 'low-speed' | 'unknown'

export type GpsLogEntry = {
  capturedAt: number
  latitude: number
  longitude: number
  speed: number | null
  accuracy: number
}

export type GpsRoutePoint = {
  t: number
  lat: number
  lng: number
  s: number | null
  a: number
}

export type GpsRouteBounds = {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export type GpsRouteRetentionPhase = 'active' | 'attention' | 'warning' | 'expired'

export type GpsRouteSummary = {
  schemaVersion: 1
  caseRecordId: string
  caseNumber: string
  franchiseeId: string
  storeId: string
  staffId: string
  staffName: string
  vehicleId: string
  vehicleName: string
  closedAt: string
  intervalSeconds: number
  pointCount: number
  chunkCount: number
  chunkSize: number
  bounds: GpsRouteBounds
  capturedFrom: string | null
  capturedTo: string | null
  retentionPhase: GpsRouteRetentionPhase
  expiresAt: string
  savedAt: string
}

export type GpsRouteChunk = {
  index: number
  from: number
  to: number
  points: GpsRoutePoint[]
}

export type SelectedCareOption = {
  id: string
  masterId: string
  name: string
  amountYen: number
}

export type ExpenseItem = {
  id: string
  name: string
  amountYen: number
}

export type PaymentMethod = '現金' | 'クレジット' | 'QR決済' | '請求書' | 'その他'

export type TaxiTicket = {
  amount: number
  id: string
  municipality: string
  ticketNumber: string
}

export type PaymentAllocation = {
  amount: number
  id: string
  type: PaymentMethod
}

export type MeterMetric = {
  label: string
  value: string
  unit?: string
  tone?: 'fare' | 'timer'
}

export type MeterAction = {
  label: string
  variant: 'primary' | 'secondary' | 'accent' | 'danger'
  nextStatus?: OperationStatus
}
