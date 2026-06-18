import type { MeterMode, OperationStatus, PaymentMethod } from '../types/case'
import type { MeterPermissions } from '../types/work'
import { getAllowedMeterModes, isMeterModeAllowed } from '../services/subscriptionPlans'

export const meterModeLabels: Record<MeterMode, string> = {
  gps: 'GPSM',
  obd: 'OBDM',
  time: '時間M',
}

export const meterModeStorageKey = 'careTaxiMeterMode'

export const parseMeterModeParam = (value: string | null | undefined): MeterMode | null =>
  value === 'gps' || value === 'time' || value === 'obd' ? value : null

export const readStoredMeterMode = (): MeterMode => {
  const storedMode = window.localStorage.getItem(meterModeStorageKey)
  return parseMeterModeParam(storedMode) ?? 'gps'
}

export const writeStoredMeterMode = (mode: MeterMode) => {
  window.localStorage.setItem(meterModeStorageKey, mode)
}

export const clampMeterModeToPermissions = (
  mode: MeterMode,
  permissions: MeterPermissions,
): MeterMode => {
  if (isMeterModeAllowed(mode, permissions)) {
    return mode
  }

  return getAllowedMeterModes(permissions)[0] ?? 'gps'
}

/** 権限クランプ前の生の meterMode を決定する（復元 > クエリ > localStorage） */
export const resolveRawMeterMode = ({
  queryMode,
  snapshotMeterMode,
}: {
  queryMode: string | null
  snapshotMeterMode?: MeterMode | null
}): MeterMode => {
  const fromSnapshot = parseMeterModeParam(snapshotMeterMode)
  if (fromSnapshot) {
    return fromSnapshot
  }

  const fromQuery = parseMeterModeParam(queryMode)
  if (fromQuery) {
    return fromQuery
  }

  return readStoredMeterMode()
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
