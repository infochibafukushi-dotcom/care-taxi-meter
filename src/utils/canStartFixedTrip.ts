import type { MeterMode, OperationStatus } from '../types/case'
import { resolvePreFixedConfirmedFareYen } from '../services/reservationTripContext'
import type { ReservationTripContext } from '../services/reservationTripContext'
import type { ActiveTripSnapshot } from '../services/activeTripSnapshot'

export type CanStartFixedTripInputs = {
  meterMode: MeterMode
  reservationTripContext: ReservationTripContext | null
  restoredTripSnapshot: ActiveTripSnapshot | null
  fixedFareRun: { confirmedFareYen: number; reservationId: string; snapshotHash: string } | null
  status: OperationStatus
  /** sessionPhase === 'active' */
  hasWorkSession: boolean
  /** sessionPhase === 'loading' — 未出勤と混同しない */
  isWorkSessionLoading: boolean
  selectedVehicleId: string
  isFixedTripStarting: boolean
}

export type CanStartFixedTripConditionName =
  | 'meterMode===fixed'
  | 'reservationTripContext|restoredFixedSnapshot'
  | '!fixedFareRun||status===空車'
  | 'workSession.resolved'
  | 'workSession.currentSession'
  | 'selectedVehicleId'
  | '!isFixedTripStarting'
  | 'status in 空車|待機中|院内付き添い中'

export type CanStartFixedTripEvaluation = {
  canStartFixedTrip: boolean
  conditions: Array<{
    name: CanStartFixedTripConditionName
    value: boolean
    source: string
    detail: string
  }>
  firstFalseName: CanStartFixedTripConditionName | null
}

const hasRestoredFixedSnapshotContext = (
  restoredTripSnapshot: ActiveTripSnapshot | null,
): boolean =>
  Boolean(
    restoredTripSnapshot?.meterMode === 'fixed' &&
      restoredTripSnapshot.reservationId &&
      resolvePreFixedConfirmedFareYen({ snapshot: restoredTripSnapshot }) > 0,
  )

/**
 * CasePage の canStartFixedTrip と同じ論理。各条件の実測用に分解する。
 */
export const evaluateCanStartFixedTrip = (
  input: CanStartFixedTripInputs,
): CanStartFixedTripEvaluation => {
  const hasTripContext = Boolean(
    input.reservationTripContext || hasRestoredFixedSnapshotContext(input.restoredTripSnapshot),
  )
  const fixedFareRunAllowsStart = !input.fixedFareRun || input.status === '空車'
  const statusAllowsStart =
    input.status === '空車' ||
    input.status === '待機中' ||
    input.status === '院内付き添い中'

  const conditions: CanStartFixedTripEvaluation['conditions'] = [
    {
      name: 'meterMode===fixed',
      value: input.meterMode === 'fixed',
      source: 'state meterMode / URL meterMode',
      detail: `meterMode=${input.meterMode}`,
    },
    {
      name: 'reservationTripContext|restoredFixedSnapshot',
      value: hasTripContext,
      source:
        'state reservationTripContext (sessionStorage / preFixedMeterSession / activeTripSnapshot)',
      detail: `hasContext=${Boolean(input.reservationTripContext)} restoredFixed=${hasRestoredFixedSnapshotContext(input.restoredTripSnapshot)}`,
    },
    {
      name: '!fixedFareRun||status===空車',
      value: fixedFareRunAllowsStart,
      source: 'state fixedFareRun + status',
      detail: `fixedFareRun=${Boolean(input.fixedFareRun)} status=${input.status}`,
    },
    {
      name: 'workSession.resolved',
      value: !input.isWorkSessionLoading,
      source: 'useWorkSession.sessionPhase',
      detail: `isWorkSessionLoading=${input.isWorkSessionLoading}`,
    },
    {
      name: 'workSession.currentSession',
      value: input.hasWorkSession,
      source: 'localStorage careTaxiMeterCurrentWorkSession / Firestore open session / useWorkSession',
      detail: `hasWorkSession=${input.hasWorkSession}`,
    },
    {
      name: 'selectedVehicleId',
      value: Boolean(input.selectedVehicleId),
      source: 'state selectedVehicleId (URL vehicleId / vehicles list / snapshot)',
      detail: `selectedVehicleId=${input.selectedVehicleId ? 'set' : 'empty'}`,
    },
    {
      name: '!isFixedTripStarting',
      value: !input.isFixedTripStarting,
      source: 'state isFixedTripStarting',
      detail: `isFixedTripStarting=${input.isFixedTripStarting}`,
    },
    {
      name: 'status in 空車|待機中|院内付き添い中',
      value: statusAllowsStart,
      source: 'state status',
      detail: `status=${input.status}`,
    },
  ]

  const firstFalse = conditions.find((condition) => !condition.value) ?? null

  return {
    canStartFixedTrip: conditions.every((condition) => condition.value),
    conditions,
    firstFalseName: firstFalse?.name ?? null,
  }
}

export const resolvePrimaryStartDisabledReason = ({
  canStartTrip,
  isTripStarting,
  evaluation,
}: {
  canStartTrip: boolean
  isTripStarting: boolean
  evaluation: CanStartFixedTripEvaluation
}): string => {
  if (isTripStarting) {
    return 'isTripStarting'
  }
  if (!canStartTrip) {
    return evaluation.firstFalseName ?? 'canStartTrip=false'
  }
  return 'none'
}
