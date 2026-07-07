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

/**
 * TOP「案件開始」向け。完了済みロックと事前確定Mの一時データを除去し、通常案件開始へ進めるようにする。
 */
export const clearStalePreFixedStateForNormalCaseStart = () => {
  clearPostSettlementLock()
  clearPreFixedFareLocalSessionState()
}
