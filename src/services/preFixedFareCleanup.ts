import type { MeterMode } from '../types/case'
import { clearActiveTripSnapshot } from './activeTripSnapshot'
import { clearPostSettlementLock } from './postSettlementLock'
import { clearPreFixedMeterSession } from './preFixedMeterSession'
import { clearReservationTripContext } from './reservationTripContext'

/** 事前確定Mの精算完了後に残るローカル運行状態をまとめて削除する。 */
export const clearPreFixedFareLocalSessionState = () => {
  clearActiveTripSnapshot()
  clearReservationTripContext()
  clearPreFixedMeterSession()
}

const clearPostSettlementAndPreFixedLocalState = () => {
  clearPostSettlementLock()
  clearPreFixedFareLocalSessionState()
}

/**
 * TOP「案件開始」向け。完了済みロックと事前確定Mの一時データを除去し、通常案件開始へ進めるようにする。
 */
export const clearStalePreFixedStateForNormalCaseStart = () => {
  clearPostSettlementAndPreFixedLocalState()
}

/**
 * 精算完了後に事前確定Mで新しい運行を開始する前のローカル状態クリア。
 * ログイン・出勤・車両ロックは維持し、旧案件固有データのみ除去する。
 */
export const clearPreFixedFareStateForNewTrip = () => {
  clearPostSettlementAndPreFixedLocalState()
}

/** 予約あり／予約なし選択画面の正規URL */
export const buildPreFixedMeterMenuPath = (vehicleId?: string): string => {
  const normalizedVehicleId = vehicleId?.trim() ?? ''
  return normalizedVehicleId
    ? `/case/pre-fixed?vehicleId=${encodeURIComponent(normalizedVehicleId)}`
    : '/case/pre-fixed'
}

export type PostSettlementNewCaseNavigation =
  | { kind: 'reset_in_place' }
  | { kind: 'navigate'; to: string; replace: true }

/**
 * 「新しい案件を開始」押下時の遷移先。
 * 通常メーターは既存どおり同一画面でリセット、事前確定運賃Mは予約あり／なし選択画面へ。
 */
export const resolvePostSettlementNewCaseNavigation = (input: {
  meterMode: MeterMode
  vehicleId?: string
  reviewDemoMode?: boolean
}): PostSettlementNewCaseNavigation => {
  if (input.reviewDemoMode || input.meterMode !== 'fixed') {
    return { kind: 'reset_in_place' }
  }

  return {
    kind: 'navigate',
    to: buildPreFixedMeterMenuPath(input.vehicleId),
    replace: true,
  }
}
