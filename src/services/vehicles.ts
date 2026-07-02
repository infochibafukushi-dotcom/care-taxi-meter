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
import { getFirebaseApp } from '../lib/firebase'
import type { Vehicle, VehicleFuelType, VehicleStatus } from '../types/work'
import { getFranchiseeId, getStoreId, matchesTenantScope } from './tenancy'
import type { TenantAccessScope } from './tenancy'

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
  }
}

function getVehiclesCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, vehiclesCollectionName)
}

const createVehicleTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || scope.role === 'hq_admin') return []

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const constraints: QueryConstraint[] = []

  if (franchiseeId) {
    constraints.push(where('franchiseeId', '==', franchiseeId))
  }

  if ((scope.role === 'manager' || scope.role === 'driver') && scope.storeId) {
    constraints.push(where('storeId', '==', scope.storeId))
  }

  return constraints
}

export async function fetchVehicles(scope?: TenantAccessScope) {
  const snapshots = await getDocs(
    query(
      getVehiclesCollection(),
      ...createVehicleTenantConstraints(scope),
      orderBy('sortOrder', 'asc'),
    ),
  )

  return snapshots.docs.map(toVehicle).filter((vehicle) => matchesTenantScope(vehicle, scope))
}

export async function saveVehicle(vehicle: Vehicle) {
  const db = getFirestore(getFirebaseApp())
  const vehicleRef = doc(db, vehiclesCollectionName, vehicle.id)
  const snapshot = await getDoc(vehicleRef)
  const document = {
    ...vehicle,
    companyId: vehicle.franchiseeId || vehicle.companyId,
    franchiseeId: vehicle.franchiseeId || vehicle.companyId,
    vehicleName: vehicle.vehicleName || vehicle.name,
    plateNumber: vehicle.plateNumber || vehicle.number,
    isActive: vehicle.isActive ?? vehicle.enabled,
    ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }

  await setDoc(vehicleRef, document, { merge: true })
  return vehicle
}
