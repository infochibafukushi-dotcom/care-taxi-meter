export type StaffRole = 'admin' | 'manager' | 'driver' | 'staff'

export type VehicleStatus = '稼働中' | '整備中' | '休車' | '売却済'

export type VehicleFuelType = 'ガソリン' | '軽油' | 'EV' | ''

export type WorkSessionStatus = 'working' | 'closed'

export type Store = {
  id: string
  name: string
  enabled: boolean
}

export type StaffMember = {
  id: string
  name: string
  role: StaffRole
  enabled: boolean
  sortOrder: number
}

export type Vehicle = {
  id: string
  name: string
  number: string
  status: VehicleStatus
  fuelType: VehicleFuelType
  enabled: boolean
  sortOrder: number
}

export type WorkSession = {
  id: string
  storeId: string
  storeName: string
  staffId: string
  staffName: string
  staffRole: StaffRole
  vehicleId: string
  vehicleName: string
  vehicleNumber: string
  clockInAt: string
  clockOutAt: string | null
  workSeconds: number
  clockInLatitude: number | null
  clockInLongitude: number | null
  clockInAccuracy: number | null
  clockOutLatitude: number | null
  clockOutLongitude: number | null
  clockOutAccuracy: number | null
  status: WorkSessionStatus
}

export type CurrentWorkSession = WorkSession

export const staffRoles: StaffRole[] = ['admin', 'manager', 'driver', 'staff']
export const vehicleStatuses: VehicleStatus[] = ['稼働中', '整備中', '休車', '売却済']
export const vehicleFuelTypes: VehicleFuelType[] = ['', 'ガソリン', '軽油', 'EV']
