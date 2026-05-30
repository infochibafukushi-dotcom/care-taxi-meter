export type OperationStatus =
  | '空車'
  | '待機中'
  | '院内付き添い中'
  | '走行中'
  | '精算前'
  | '案件終了'

export type StatusTone =
  | 'vacant'
  | 'waiting'
  | 'accompanying'
  | 'driving'
  | 'settlement'
  | 'closed'

export type TimerKey = 'driving' | 'waiting' | 'accompanying'

export type GpsPosition = {
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  updatedAt: number
}

export type GpsLogEntry = {
  capturedAt: number
  latitude: number
  longitude: number
  speed: number | null
  accuracy: number
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

export type PaymentMethod = '現金' | 'クレジット' | 'QR決済' | 'その他'

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
