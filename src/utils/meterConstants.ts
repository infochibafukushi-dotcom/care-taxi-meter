import type { MeterMode, OperationStatus, PaymentMethod } from '../types/case'

export const meterModeLabels: Record<MeterMode, string> = {
  gps: 'GPSM',
  obd: 'OBDM',
  time: '時間M',
}

export const protectedOperationStatuses = new Set<OperationStatus>([
  '走行中',
  '待機中',
  '院内付き添い中',
  '精算前',
  '精算修正',
])

export const isProtectedOperationStatus = (value: unknown): value is OperationStatus =>
  typeof value === 'string' && protectedOperationStatuses.has(value as OperationStatus)

export const createEmptyPaymentAmounts = (): Record<PaymentMethod, number> => ({
  QR決済: 0,
  その他: 0,
  クレジット: 0,
  現金: 0,
  請求書: 0,
})
