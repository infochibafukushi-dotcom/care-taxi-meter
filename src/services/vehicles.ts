import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { Vehicle, VehicleFuelType, VehicleStatus } from '../types/work'

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
    name: toStringValue(data.name) || '名称未設定の車両',
    number: toStringValue(data.number),
    status: toStatus(data.status),
    fuelType: toFuelType(data.fuelType),
    enabled: toBooleanValue(data.enabled),
    sortOrder: toNumberValue(data.sortOrder),
    storeId: toStringValue(data.storeId),
    storeName: toStringValue(data.storeName),
    tenantId: toStringValue(data.tenantId),
    organizationId: toStringValue(data.organizationId),
    inspectionExpiresAt: toStringValue(data.inspectionExpiresAt),
    lastMaintenanceAt: toStringValue(data.lastMaintenanceAt),
    nextMaintenanceAt: toStringValue(data.nextMaintenanceAt),
    memo: toStringValue(data.memo),
  }
}

function getVehiclesCollection() {
  const db = getFirestore(getFirebaseApp())
  return collection(db, vehiclesCollectionName)
}

export async function fetchVehicles() {
  const snapshots = await getDocs(query(getVehiclesCollection(), orderBy('sortOrder', 'asc')))
  return snapshots.docs.map(toVehicle)
}

export async function saveVehicle(vehicle: Vehicle) {
  const db = getFirestore(getFirebaseApp())
  const document = {
    ...vehicle,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  await setDoc(doc(db, vehiclesCollectionName, vehicle.id), document, {
    merge: true,
  })
  return vehicle
}
