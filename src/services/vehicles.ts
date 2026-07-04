import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { getFirebaseApp } from '../lib/firebase'
import type { Vehicle, VehicleFuelType, VehicleStatus } from '../types/work'
import { defaultStoreId, getFranchiseeId, getStoreId, isHqRole } from './tenancy'
import type { TenantAccessScope } from './tenancy'

/** 車両管理の保存で書き込んではいけない稼働ロック用フィールド */
export const VEHICLE_LOCK_FIELD_KEYS = [
  'inUse',
  'currentDriverId',
  'currentDriverName',
  'currentWorkSessionId',
  'inUseSince',
  'activeTripVehicleId',
  'currentCaseId',
] as const

export const VEHICLE_SAVE_PERMISSION_MESSAGE =
  '車両情報を保存できませんでした。編集権限または保存対象項目を確認してください。'

export const VEHICLE_EDIT_FORBIDDEN_MESSAGE = '車両情報の編集権限がありません。'

const vehiclesCollectionName = 'vehicles'
const validStatuses: VehicleStatus[] = ['稼働中', '整備中', '休車', '売却済']
const validFuelTypes: VehicleFuelType[] = ['', 'ガソリン', '軽油', 'EV']

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '')
const toBooleanValue = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback
const toNumberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const toStatus = (value: unknown): VehicleStatus =>
  typeof value === 'string' && validStatuses.includes(value as VehicleStatus)
    ? (value as VehicleStatus)
    : '稼働中'
const toFuelType = (value: unknown): VehicleFuelType =>
  typeof value === 'string' && validFuelTypes.includes(value as VehicleFuelType)
    ? (value as VehicleFuelType)
    : ''

const toVehicle = (snapshot: QueryDocumentSnapshot<DocumentData>): Vehicle => {
  const data = snapshot.data()

  return {
    id: toStringValue(data.id) || snapshot.id,
    companyId: getFranchiseeId(data),
    franchiseeId: getFranchiseeId(data),
    storeId: getStoreId(data),
    storeName: toStringValue(data.storeName),
    name: toStringValue(data.name) || toStringValue(data.vehicleName) || '名称未設定の車両',
    vehicleName: toStringValue(data.vehicleName) || toStringValue(data.name) || '名称未設定の車両',
    number: toStringValue(data.number) || toStringValue(data.plateNumber),
    plateNumber: toStringValue(data.plateNumber) || toStringValue(data.number),
    status: toStatus(data.status),
    fuelType: toFuelType(data.fuelType),
    vehicleType: toStringValue(data.vehicleType),
    wheelchairCapacity: toNumberValue(data.wheelchairCapacity),
    stretcherSupported: toBooleanValue(data.stretcherSupported, false),
    inspectionExpiresAt: toStringValue(data.inspectionExpiresAt),
    insuranceExpiresAt: toStringValue(data.insuranceExpiresAt),
    memo: toStringValue(data.memo),
    enabled: toBooleanValue(data.enabled),
    isActive: toBooleanValue(data.isActive ?? data.enabled),
    sortOrder: toNumberValue(data.sortOrder),
    inUse: data.inUse === true,
    currentDriverId: toStringValue(data.currentDriverId) || undefined,
    currentDriverName: toStringValue(data.currentDriverName) || undefined,
    currentWorkSessionId: toStringValue(data.currentWorkSessionId) || undefined,
    inUseSince: toStringValue(data.inUseSince) || undefined,
  }
}

function getVehiclesCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, vehiclesCollectionName)
}

const createVehicleTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || isHqRole(scope.role ?? '')) return []

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const constraints: QueryConstraint[] = []

  if (franchiseeId) {
    constraints.push(where('franchiseeId', '==', franchiseeId))
  }

  // owner は加盟店全体、manager/driver のみ店舗で絞る
  if ((scope.role === 'manager' || scope.role === 'driver') && scope.storeId) {
    constraints.push(where('storeId', '==', scope.storeId))
  }

  return constraints
}

/**
 * 車両一覧のテナント絞り込み。
 * createVehicleTenantConstraints と同じ方針（owner は franchisee 全体）。
 * storeId 未設定の既存車両は、店舗ロールでも franchisee が一致すれば残す。
 */
const matchesVehicleTenantScope = (vehicle: Vehicle, scope?: TenantAccessScope) => {
  if (!scope || isHqRole(scope.role ?? '')) return true

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const vehicleFranchiseeId = vehicle.franchiseeId || vehicle.companyId
  if (franchiseeId && vehicleFranchiseeId !== franchiseeId) return false

  if (scope.role === 'owner') return true

  if ((scope.role === 'manager' || scope.role === 'driver') && scope.storeId) {
    // 既存データで storeId 未設定（default-store）の場合は除外しない
    const vehicleStoreId =
      vehicle.storeId && vehicle.storeId !== defaultStoreId ? vehicle.storeId : ''
    if (vehicleStoreId && vehicleStoreId !== scope.storeId) return false
  }

  return true
}

export async function fetchVehicles(scope?: TenantAccessScope) {
  const snapshots = await getDocs(
    query(
      getVehiclesCollection(),
      ...createVehicleTenantConstraints(scope),
      orderBy('sortOrder', 'asc'),
    ),
  )

  return snapshots.docs.map(toVehicle).filter((vehicle) => matchesVehicleTenantScope(vehicle, scope))
}

/**
 * 案件開始などで選択可能な車両かどうか。
 * active / isActive / enabled が未設定の既存データは有効として扱う。
 * 明確に無効化・非稼働の車両のみ除外する。
 */
export const isVehicleSelectable = (vehicle: Vehicle) => {
  if (vehicle.enabled === false) return false
  if (vehicle.isActive === false) return false
  if (vehicle.status === '売却済') return false
  if (vehicle.status === '休車') return false
  if (vehicle.status === '整備中') return false
  return true
}

/**
 * 車両管理と同じテナントスコープで取得し、案件開始時に選択可能な車両だけ返す。
 * Firestore ルール上、スコープなしの全件取得は加盟店・店舗ロールでは失敗するため、
 * 必ず franchiseeId（と必要なら storeId）を渡すこと。
 */
export async function getSelectableVehicles(scope?: TenantAccessScope) {
  const vehicles = await fetchVehicles(scope)
  return vehicles.filter(isVehicleSelectable)
}

/**
 * 車両管理画面用の保存ペイロード。
 * 稼働ロック用フィールドは含めない（claim/release 専用）。
 * undefined は送らない。
 */
export const buildVehicleAdminUpdatePayload = (vehicle: Vehicle) => {
  const franchiseeId = (vehicle.franchiseeId || vehicle.companyId || '').trim()
  const storeId = (vehicle.storeId || defaultStoreId).trim() || defaultStoreId
  const name = vehicle.name.trim()
  const number = (vehicle.number || vehicle.plateNumber || '').trim()

  return {
    id: vehicle.id,
    companyId: franchiseeId,
    franchiseeId,
    storeId,
    storeName: (vehicle.storeName || '').trim(),
    name,
    vehicleName: (vehicle.vehicleName || name).trim() || name,
    number,
    plateNumber: (vehicle.plateNumber || number).trim() || number,
    status: vehicle.status || '稼働中',
    fuelType: vehicle.fuelType || '',
    vehicleType: vehicle.vehicleType || '',
    wheelchairCapacity: Math.max(vehicle.wheelchairCapacity || 0, 0),
    stretcherSupported: Boolean(vehicle.stretcherSupported),
    inspectionExpiresAt: vehicle.inspectionExpiresAt || '',
    insuranceExpiresAt: vehicle.insuranceExpiresAt || '',
    memo: vehicle.memo || '',
    enabled: vehicle.enabled !== false,
    isActive: vehicle.isActive ?? vehicle.enabled !== false,
    sortOrder: Math.max(vehicle.sortOrder || 1, 1),
  }
}

export const isVehicleReadyToSave = (vehicle: Vehicle) => {
  const name = vehicle.name.trim()
  const number = (vehicle.number || vehicle.plateNumber || '').trim()
  const franchiseeId = (vehicle.franchiseeId || vehicle.companyId || '').trim()
  return Boolean(name && number && franchiseeId)
}

export const VEHICLE_INCOMPLETE_MESSAGE = '車両名とナンバーを入力してください。'

export const toVehicleSaveUserMessage = (error: unknown) => {
  if (error instanceof FirebaseError && error.code === 'permission-denied') {
    return VEHICLE_SAVE_PERMISSION_MESSAGE
  }

  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/missing or insufficient permissions|permission-denied|permission_denied/i.test(message)) {
    return VEHICLE_SAVE_PERMISSION_MESSAGE
  }

  if (error instanceof Error && error.message) {
    return `車両情報を保存できませんでした。${error.message}`
  }

  return VEHICLE_SAVE_PERMISSION_MESSAGE
}

type VehicleSaveSessionContext = {
  companyId?: string
  franchiseeId?: string
  storeId?: string
  staffRole?: string
  staffId?: string
}

const getErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '')
  }
  return ''
}

export async function saveVehicle(
  vehicle: Vehicle,
  sessionContext: VehicleSaveSessionContext = {},
) {
  const db = getFirestore(getFirebaseApp())
  const vehicleRef = doc(db, vehiclesCollectionName, vehicle.id)
  const masterPayload = buildVehicleAdminUpdatePayload(vehicle)

  if (!masterPayload.franchiseeId) {
    throw new Error('車両の会社ID（franchiseeId）が未設定です。')
  }
  if (!masterPayload.storeId) {
    throw new Error('車両の店舗ID（storeId）が未設定です。')
  }

  let operation: 'create' | 'update' = 'create'
  try {
    const snapshot = await getDoc(vehicleRef)
    operation = snapshot.exists() ? 'update' : 'create'
  } catch (error) {
    // 未作成ドキュメントの get が rules で拒否される場合は create として扱う
    operation = 'create'
    console.warn('[VehicleManagement] getDoc before save failed; treating as create', {
      vehicleId: vehicle.id,
      errorCode: getErrorCode(error),
      errorMessage: error instanceof Error ? error.message : String(error ?? ''),
      session: sessionContext,
    })
  }

  const payload = {
    ...masterPayload,
    ...(operation === 'create' ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  try {
    // merge: true でもロック用フィールドは payload に含めないため既存ロックは保持される
    await setDoc(vehicleRef, payload, { merge: true })
    return vehicle
  } catch (error) {
    console.warn('[VehicleManagement] save failed', {
      operation,
      vehicleId: vehicle.id,
      payload: {
        ...masterPayload,
        createdAt: operation === 'create' ? '[serverTimestamp]' : undefined,
        updatedAt: '[serverTimestamp]',
      },
      payloadKeys: Object.keys(payload),
      session: {
        companyId: sessionContext.companyId ?? '',
        franchiseeId: sessionContext.franchiseeId ?? '',
        storeId: sessionContext.storeId ?? '',
        staffRole: sessionContext.staffRole ?? '',
        staffId: sessionContext.staffId ?? '',
      },
      errorCode: getErrorCode(error),
      errorMessage: error instanceof Error ? error.message : String(error ?? ''),
    })
    throw error
  }
}
