export type OperationStatus =
  | '待機中'
  | '院内付き添い中'
  | '走行中'
  | '精算前'
  | '案件終了'

export type StatusTone =
  | 'waiting'
  | 'accompanying'
  | 'driving'
  | 'settlement'
  | 'closed'

export type TimerKey = 'driving' | 'waiting' | 'accompanying'

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
