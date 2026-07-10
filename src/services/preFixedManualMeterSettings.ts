import { getDoc, onSnapshot, type DocumentSnapshot, type FirestoreError } from 'firebase/firestore'
import type { AssistItem, DispatchMenuItem, SpecialVehicleMenuItem } from './fare'
import {
  getMeterSettingsRef,
  sanitizeMeterSettings,
  type MeterSettings,
} from './meterSettings'
import type { TenantScope } from './tenancy'

export const METER_SETTINGS_LOADING_MESSAGE = '料金設定を読み込み中です'

export const METER_SETTINGS_FETCH_ERROR_MESSAGE =
  '料金設定を取得できませんでした。通信状況を確認して再読み込みしてください。'

export type StoreMeterSettingsLoadState =
  | { status: 'loading' }
  | { status: 'missing_scope' }
  | { status: 'ready'; settings: MeterSettings }
  | { status: 'error'; message: string }

export const canProceedToManualFareSettings = (state: StoreMeterSettingsLoadState): boolean =>
  state.status === 'ready'

export const canCalculateManualFare = (state: StoreMeterSettingsLoadState): boolean =>
  state.status === 'ready'

/**
 * 本番の手動事前確定フローで使用する店舗料金設定。
 * 読込完了前・失敗時は null を返し、defaultMeterSettings へはフォールバックしない。
 */
export const resolveManualFlowMeterSettings = (
  state: StoreMeterSettingsLoadState,
): MeterSettings | null => (state.status === 'ready' ? state.settings : null)

export const resolveManualFlowMeterSettingsErrorMessage = (
  state: StoreMeterSettingsLoadState,
): string | null => {
  if (state.status === 'loading') {
    return METER_SETTINGS_LOADING_MESSAGE
  }
  if (state.status === 'error' || state.status === 'missing_scope') {
    return METER_SETTINGS_FETCH_ERROR_MESSAGE
  }
  return null
}

export const isDispatchMenuItemConfigured = (
  items: DispatchMenuItem[],
  id: string,
): boolean => Boolean(items.find((item) => item.id === id)?.enabled)

export const isSpecialVehicleMenuItemConfigured = (
  items: SpecialVehicleMenuItem[],
  id: string,
): boolean => Boolean(items.find((item) => item.id === id)?.enabled)

export const isAssistItemConfigured = (items: AssistItem[], id: string): boolean =>
  Boolean(items.find((item) => item.id === id)?.enabled)

export const resolveConfiguredAssistAmount = (
  items: AssistItem[],
  id: string,
): number | null => {
  const item = items.find((entry) => entry.id === id)
  if (!item?.enabled) {
    return null
  }
  return Math.max(item.amount, 0)
}

export const resolveConfiguredMenuItemAmount = <
  T extends { id: string; enabled: boolean; amount: number },
>(
  items: T[],
  id: string,
): number | null => {
  const item = items.find((entry) => entry.id === id)
  if (!item?.enabled) {
    return null
  }
  return Math.max(item.amount, 0)
}

export const formatConfiguredFareLabel = (amountYen: number | null): string =>
  amountYen === null ? '未設定' : `${amountYen.toLocaleString('ja-JP')}円`

export async function fetchStoreMeterSettings(scope: TenantScope): Promise<MeterSettings> {
  const { franchiseeId, storeId } = scope
  if (!franchiseeId || !storeId) {
    throw new Error('MISSING_TENANT_SCOPE')
  }

  const snapshot = await getDoc(getMeterSettingsRef(scope))
  if (!snapshot.exists()) {
    throw new Error('METER_SETTINGS_NOT_FOUND')
  }

  return sanitizeMeterSettings(snapshot.data())
}

export function subscribeStoreMeterSettings(
  scope: TenantScope,
  onUpdate: (settings: MeterSettings) => void,
  onError: (error: Error) => void,
): () => void {
  const { franchiseeId, storeId } = scope
  if (!franchiseeId || !storeId) {
    onError(new Error('MISSING_TENANT_SCOPE'))
    return () => undefined
  }

  return onSnapshot(
    getMeterSettingsRef(scope),
    (snapshot: DocumentSnapshot) => {
      if (!snapshot.exists()) {
        onError(new Error('METER_SETTINGS_NOT_FOUND'))
        return
      }
      onUpdate(sanitizeMeterSettings(snapshot.data()))
    },
    (error: FirestoreError) => {
      onError(error instanceof Error ? error : new Error(String(error)))
    },
  )
}
