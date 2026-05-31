export type StaffRole = 'admin' | 'manager' | 'driver' | 'staff'

export type VehicleStatus = '稼働中' | '整備中' | '休車' | '売却済'

export type VehicleFuelType = 'ガソリン' | '軽油' | 'EV' | ''

export type WorkSessionStatus = 'working' | 'closed'

export type Store = {
  id: string
  name: string
  enabled: boolean
  sortOrder: number
  tenantId: string
  organizationId: string
}

export type StaffMember = {
  id: string
  name: string
  role: StaffRole
  enabled: boolean
  sortOrder: number
  authUid: string
  email: string
  storeId: string
  storeName: string
  tenantId: string
  organizationId: string
}

export type Vehicle = {
  id: string
  name: string
  number: string
  status: VehicleStatus
  fuelType: VehicleFuelType
  enabled: boolean
  sortOrder: number
  storeId: string
  storeName: string
  tenantId: string
  organizationId: string
  inspectionExpiresAt: string
  lastMaintenanceAt: string
  nextMaintenanceAt: string
  memo: string
}

export type WorkSession = {
  id: string
  staffId: string
  staffName: string
  staffRole: StaffRole
  vehicleId: string
  vehicleName: string
  vehicleNumber: string
  storeId: string
  storeName: string
  tenantId: string
  organizationId: string
  clockInAt: string
  clockOutAt: string | null
  workSeconds: number
  clockInLatitude: number | null
  clockInLongitude: number | null
  clockOutLatitude: number | null
  clockOutLongitude: number | null
  clockInAccuracy: number | null
  clockOutAccuracy: number | null
  status: WorkSessionStatus
}

export type CurrentWorkSession = WorkSession

export const staffRoles: StaffRole[] = ['admin', 'manager', 'driver', 'staff']
export const vehicleStatuses: VehicleStatus[] = ['稼働中', '整備中', '休車', '売却済']
export const vehicleFuelTypes: VehicleFuelType[] = ['', 'ガソリン', '軽油', 'EV']
