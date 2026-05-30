export type OperationStatus =
  | '待機中'
  | '院内付き添い中'
  | '走行中'
  | '精算前'
  | '案件終了'

export type MeterMetric = {
  label: string
  value: string
  unit?: string
}

export type MeterAction = {
  label: string
  variant: 'primary' | 'secondary' | 'accent'
}
