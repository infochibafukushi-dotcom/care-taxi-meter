import {
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { Vehicle } from '../types/work'
import type { TenantAccessScope } from './tenancy'
import { getSelectableVehicles } from './vehicles'

const vehiclesCollectionName = 'vehicles'
const workSessionsCollectionName = 'workSessions'

export const VEHICLE_IN_USE_MESSAGE =
  'この車両は現在ほかの案件で使用中です。別の車両を選択してください。'

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

const readOccupancy = (data: Record<string, unknown>): VehicleOccupancyFields => ({
  inUse: data.inUse === true,
  currentDriverId: toStringValue(data.currentDriverId),
  currentDriverName: toStringValue(data.currentDriverName),
  currentWorkSessionId: toStringValue(data.currentWorkSessionId),
  inUseSince: toStringValue(data.inUseSince),
})

const isWorkSessionHoldingVehicle = (data: Record<string, unknown> | undefined) => {
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

const toAvailabilityVehicle = (
  vehicle: Vehicle,
  occupancy: VehicleOccupancyFields,
  currentStaffId: string,
): SelectableVehicleWithAvailability => {
  const heldByOther =
    occupancy.inUse &&
    Boolean(occupancy.currentDriverId) &&
    occupancy.currentDriverId !== currentStaffId

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

/**
 * 選択可能車両に使用中状態を付与する。
 * 正は車両ドキュメントの稼働ロック。ホルダーの出勤セッションが終了していれば空きとして扱う。
 */
export async function getSelectableVehiclesWithAvailability(
  scope: TenantAccessScope | undefined,
  currentStaffId: string,
): Promise<SelectableVehicleWithAvailability[]> {
  const vehicles = await getSelectableVehicles(scope)
  const db = getFirestore(getFirebaseApp())

  return Promise.all(
    vehicles.map(async (vehicle) => {
      const vehicleSnapshot = await getDoc(doc(db, vehiclesCollectionName, vehicle.id))
      if (!vehicleSnapshot.exists()) {
        return toAvailabilityVehicle(vehicle, {
          inUse: false,
          currentDriverId: '',
          currentDriverName: '',
          currentWorkSessionId: '',
          inUseSince: '',
        }, currentStaffId)
      }

      const occupancy = readOccupancy(vehicleSnapshot.data() as Record<string, unknown>)
      if (!occupancy.inUse || !occupancy.currentWorkSessionId) {
        return toAvailabilityVehicle(vehicle, occupancy, currentStaffId)
      }

      if (occupancy.currentDriverId === currentStaffId) {
        return toAvailabilityVehicle(vehicle, occupancy, currentStaffId)
      }

      const holderSnapshot = await getDoc(
        doc(db, workSessionsCollectionName, occupancy.currentWorkSessionId),
      )
      const holderData = holderSnapshot.exists()
        ? (holderSnapshot.data() as Record<string, unknown>)
        : undefined

      if (!isWorkSessionHoldingVehicle(holderData)) {
        return toAvailabilityVehicle(vehicle, {
          inUse: false,
          currentDriverId: '',
          currentDriverName: '',
          currentWorkSessionId: '',
          inUseSince: '',
        }, currentStaffId)
      }

      return toAvailabilityVehicle(vehicle, occupancy, currentStaffId)
    }),
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
  const vehicleRef = doc(db, vehiclesCollectionName, vehicleId)
  const vehicleSnapshot = await getDoc(vehicleRef)

  if (!vehicleSnapshot.exists()) {
    throw new Error('選択した車両が見つかりません。')
  }

  const occupancy = readOccupancy(vehicleSnapshot.data() as Record<string, unknown>)
  if (!occupancy.inUse) {
    return
  }

  if (
    occupancy.currentDriverId === staffId &&
    (!occupancy.currentWorkSessionId || occupancy.currentWorkSessionId === workSessionId)
  ) {
    return
  }

  if (occupancy.currentWorkSessionId) {
    const holderSnapshot = await getDoc(
      doc(db, workSessionsCollectionName, occupancy.currentWorkSessionId),
    )
    const holderData = holderSnapshot.exists()
      ? (holderSnapshot.data() as Record<string, unknown>)
      : undefined

    if (!isWorkSessionHoldingVehicle(holderData)) {
      return
    }
  }

  if (occupancy.currentDriverId && occupancy.currentDriverId !== staffId) {
    throw new Error(VEHICLE_IN_USE_MESSAGE)
  }
}

/**
 * 案件開始時に車両を確保する。同一 workSession による再確保は成功する。
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
  const db = getFirestore(getFirebaseApp())
  const vehicleRef = doc(db, vehiclesCollectionName, vehicleId)
  const workSessionRef = doc(db, workSessionsCollectionName, workSessionId)
  const inUseSince = new Date().toISOString()

  await runTransaction(db, async (transaction) => {
    const vehicleSnapshot = await transaction.get(vehicleRef)
    if (!vehicleSnapshot.exists()) {
      throw new Error('選択した車両が見つかりません。')
    }

    const workSessionSnapshot = await transaction.get(workSessionRef)
    if (!workSessionSnapshot.exists()) {
      throw new Error('出勤セッションが見つかりません。再度出勤してください。')
    }

    const workSessionData = workSessionSnapshot.data() as Record<string, unknown>
    if (!isWorkSessionHoldingVehicle(workSessionData)) {
      throw new Error('出勤セッションが有効ではありません。再度出勤してください。')
    }

    const occupancy = readOccupancy(vehicleSnapshot.data() as Record<string, unknown>)
    if (occupancy.inUse && occupancy.currentWorkSessionId) {
      if (occupancy.currentWorkSessionId === workSessionId) {
        transaction.update(workSessionRef, {
          activeTripVehicleId: vehicleId,
          updatedAt: serverTimestamp(),
        })
        return
      }

      const holderRef = doc(db, workSessionsCollectionName, occupancy.currentWorkSessionId)
      const holderSnapshot = await transaction.get(holderRef)
      const holderData = holderSnapshot.exists()
        ? (holderSnapshot.data() as Record<string, unknown>)
        : undefined

      if (isWorkSessionHoldingVehicle(holderData) && occupancy.currentDriverId !== staffId) {
        throw new Error(VEHICLE_IN_USE_MESSAGE)
      }
    } else if (
      occupancy.inUse &&
      occupancy.currentDriverId &&
      occupancy.currentDriverId !== staffId
    ) {
      throw new Error(VEHICLE_IN_USE_MESSAGE)
    }

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
      const occupancy = readOccupancy(vehicleSnapshot.data() as Record<string, unknown>)
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
