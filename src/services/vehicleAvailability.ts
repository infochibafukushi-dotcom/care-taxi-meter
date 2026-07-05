import {
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import type { Vehicle } from '../types/work'
import type { TenantAccessScope } from './tenancy'
import { getSelectableVehicles } from './vehicles'

const vehiclesCollectionName = 'vehicles'
const workSessionsCollectionName = 'workSessions'

export const VEHICLE_IN_USE_MESSAGE =
  'この車両は現在ほかの案件で使用中です。別の車両を選択してください。'

const VEHICLE_LOAD_FAILED_MESSAGE =
  '車両情報の取得に失敗しました。時間をおいて再度お試しください。'

export type SelectableVehicleWithAvailability = Vehicle & {
  isInUse: boolean
  isSelectable: boolean
  activeDriverName?: string
  activeStaffId?: string
  activeWorkSessionId?: string
  inUseLabel?: string
}

type VehicleOccupancyFields = {
  inUse: boolean
  currentDriverId: string
  currentDriverName: string
  currentWorkSessionId: string
  inUseSince: string
}

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')

const readOccupancyFromVehicle = (vehicle: Vehicle): VehicleOccupancyFields => ({
  inUse: vehicle.inUse === true,
  currentDriverId: vehicle.currentDriverId ?? '',
  currentDriverName: vehicle.currentDriverName ?? '',
  currentWorkSessionId: vehicle.currentWorkSessionId ?? '',
  inUseSince: vehicle.inUseSince ?? '',
})

const readOccupancyFromData = (data: Record<string, unknown>): VehicleOccupancyFields => ({
  inUse: data.inUse === true,
  currentDriverId: toStringValue(data.currentDriverId),
  currentDriverName: toStringValue(data.currentDriverName),
  currentWorkSessionId: toStringValue(data.currentWorkSessionId),
  inUseSince: toStringValue(data.inUseSince),
})

const isOwnWorkingSession = (data: Record<string, unknown> | undefined) => {
  if (!data) {
    return false
  }

  if (data.status === 'closed' || toStringValue(data.clockOutAt)) {
    return false
  }

  return data.status === 'working'
}

const buildInUseLabel = (driverName: string) =>
  driverName ? `使用中：${driverName}` : '使用中'

const isHeldByOtherStaff = (occupancy: VehicleOccupancyFields, currentStaffId: string) =>
  occupancy.inUse &&
  Boolean(occupancy.currentDriverId) &&
  occupancy.currentDriverId !== currentStaffId

const toAvailabilityVehicle = (
  vehicle: Vehicle,
  occupancy: VehicleOccupancyFields,
  currentStaffId: string,
): SelectableVehicleWithAvailability => {
  const heldByOther = isHeldByOtherStaff(occupancy, currentStaffId)

  return {
    ...vehicle,
    isInUse: heldByOther,
    isSelectable: !heldByOther,
    activeDriverName: heldByOther ? occupancy.currentDriverName || undefined : undefined,
    activeStaffId: heldByOther ? occupancy.currentDriverId || undefined : undefined,
    activeWorkSessionId: heldByOther ? occupancy.currentWorkSessionId || undefined : undefined,
    inUseLabel: heldByOther ? buildInUseLabel(occupancy.currentDriverName) : undefined,
  }
}

const formatVehicleOptionLabel = (vehicle: SelectableVehicleWithAvailability) => {
  const baseLabel = `${vehicle.name} / ${vehicle.number || 'ナンバー未設定'}`
  if (!vehicle.isInUse) {
    return baseLabel
  }

  return `${baseLabel}（${vehicle.inUseLabel ?? '使用中'}）`
}

export const getVehicleOptionLabel = formatVehicleOptionLabel

/** Firestore permission 等の生エラーを利用者向け文言に変換する */
export const toVehicleAvailabilityUserMessage = (error: unknown, fallback = VEHICLE_LOAD_FAILED_MESSAGE) => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message) {
    return fallback
  }

  if (/missing or insufficient permissions|permission-denied|permission_denied/i.test(message)) {
    return fallback
  }

  return message
}

/**
 * 選択可能車両に使用中状態を付与する。
 * 他人の workSession は読まない（ドライバー権限では permission denied になるため）。
 * 使用中表示は車両ドキュメントのロックフィールドのみで判定する。
 */
export async function getSelectableVehiclesWithAvailability(
  scope: TenantAccessScope | undefined,
  currentStaffId: string,
): Promise<SelectableVehicleWithAvailability[]> {
  const vehicles = await getSelectableVehicles(scope)

  return vehicles.map((vehicle) =>
    toAvailabilityVehicle(vehicle, readOccupancyFromVehicle(vehicle), currentStaffId),
  )
}

export async function assertVehicleAvailableForStaff({
  vehicleId,
  staffId,
  workSessionId,
}: {
  vehicleId: string
  staffId: string
  workSessionId: string
}) {
  const db = getFirestore(getFirebaseApp())
  const vehicleSnapshot = await getDoc(doc(db, vehiclesCollectionName, vehicleId))

  if (!vehicleSnapshot.exists()) {
    throw new Error('選択した車両が見つかりません。')
  }

  const occupancy = readOccupancyFromData(vehicleSnapshot.data() as Record<string, unknown>)
  if (!occupancy.inUse) {
    return
  }

  if (occupancy.currentDriverId === staffId) {
    return
  }

  if (occupancy.currentDriverId && occupancy.currentDriverId !== staffId) {
    throw new Error(VEHICLE_IN_USE_MESSAGE)
  }

  // currentDriverId が空の古いロックは、同一 workSession 以外は使用中扱い
  if (occupancy.currentWorkSessionId && occupancy.currentWorkSessionId !== workSessionId) {
    throw new Error(VEHICLE_IN_USE_MESSAGE)
  }
}

/**
 * 案件開始時に車両を確保する。同一スタッフによる再確保は成功する。
 * 他人の workSession は読まない（車両ロックフィールドのみで判定）。
 */
export async function claimVehicleForCaseStart({
  vehicleId,
  staffId,
  staffName,
  workSessionId,
}: {
  vehicleId: string
  staffId: string
  staffName: string
  workSessionId: string
}) {
  if (isReviewDemoRuntimeEnabled()) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  const vehicleRef = doc(db, vehiclesCollectionName, vehicleId)
  const workSessionRef = doc(db, workSessionsCollectionName, workSessionId)
  const inUseSince = new Date().toISOString()

  await runTransaction(db, async (transaction) => {
    const vehicleSnapshot = await transaction.get(vehicleRef)
    if (!vehicleSnapshot.exists()) {
      throw new Error('選択した車両が見つかりません。')
    }

    // 自分の出勤セッションのみ読む
    const workSessionSnapshot = await transaction.get(workSessionRef)
    if (!workSessionSnapshot.exists()) {
      throw new Error('出勤セッションが見つかりません。再度出勤してください。')
    }

    const workSessionData = workSessionSnapshot.data() as Record<string, unknown>
    if (!isOwnWorkingSession(workSessionData)) {
      throw new Error('出勤セッションが有効ではありません。再度出勤してください。')
    }

    const occupancy = readOccupancyFromData(vehicleSnapshot.data() as Record<string, unknown>)

    if (occupancy.inUse && occupancy.currentWorkSessionId === workSessionId) {
      transaction.update(workSessionRef, {
        activeTripVehicleId: vehicleId,
        updatedAt: serverTimestamp(),
      })
      return
    }

    if (isHeldByOtherStaff(occupancy, staffId)) {
      throw new Error(VEHICLE_IN_USE_MESSAGE)
    }

    // 同一スタッフの別セッション、または未ロックなら確保（再確保）
    transaction.update(vehicleRef, {
      inUse: true,
      currentDriverId: staffId,
      currentDriverName: staffName,
      currentWorkSessionId: workSessionId,
      inUseSince,
      updatedAt: serverTimestamp(),
    })
    transaction.update(workSessionRef, {
      activeTripVehicleId: vehicleId,
      updatedAt: serverTimestamp(),
    })
  })
}

/**
 * 案件終了・キャンセル時に車両ロックを解除する。
 * 自分の workSession が保持している場合のみ解除する。
 */
export async function releaseVehicleFromCase({
  vehicleId,
  workSessionId,
}: {
  vehicleId: string
  workSessionId: string
}) {
  if (!vehicleId || !workSessionId) {
    return
  }

  const db = getFirestore(getFirebaseApp())
  const vehicleRef = doc(db, vehiclesCollectionName, vehicleId)
  const workSessionRef = doc(db, workSessionsCollectionName, workSessionId)

  await runTransaction(db, async (transaction) => {
    const vehicleSnapshot = await transaction.get(vehicleRef)
    const workSessionSnapshot = await transaction.get(workSessionRef)

    if (vehicleSnapshot.exists()) {
      const occupancy = readOccupancyFromData(vehicleSnapshot.data() as Record<string, unknown>)
      if (!occupancy.currentWorkSessionId || occupancy.currentWorkSessionId === workSessionId) {
        transaction.update(vehicleRef, {
          inUse: false,
          currentDriverId: '',
          currentDriverName: '',
          currentWorkSessionId: '',
          inUseSince: '',
          updatedAt: serverTimestamp(),
        })
      }
    }

    if (workSessionSnapshot.exists()) {
      const activeTripVehicleId = toStringValue(workSessionSnapshot.data()?.activeTripVehicleId)
      if (!activeTripVehicleId || activeTripVehicleId === vehicleId) {
        transaction.update(workSessionRef, {
          activeTripVehicleId: null,
          updatedAt: serverTimestamp(),
        })
      }
    }
  })
}
