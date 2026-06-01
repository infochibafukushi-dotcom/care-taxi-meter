export type StaffRole = 'superAdmin' | 'owner' | 'manager' | 'driver'

export type CompanyStatus = 'active' | 'suspended'

export type VehicleStatus = '稼働中' | '整備中' | '休車' | '売却済'

export type VehicleFuelType = 'ガソリン' | '軽油' | 'EV' | ''

export type WorkSessionStatus = 'working' | 'closed'

export type Company = {
  id: string
  name: string
  enabled: boolean
  sortOrder: number
  ownerName: string
  phoneNumber: string
  email: string
  address: string
  memo: string
}

export type Store = {
  id: string
  companyId: string
  name: string
  enabled: boolean
  sortOrder: number
}

export type StaffMember = {
  id: string
  companyId: string
  storeId: string
  storeName: string
  userId: string
  password: string
  name: string
  role: StaffRole
  phoneNumber: string
  email: string
  address: string
  licenseNumber: string
  licenseExpiresAt: string
  accidentHistory: string
  memo: string
  enabled: boolean
  sortOrder: number
}

export type Vehicle = {
  id: string
  companyId: string
  storeId: string
  storeName: string
  name: string
  number: string
  status: VehicleStatus
  fuelType: VehicleFuelType
  vehicleType: string
  wheelchairCapacity: number
  stretcherSupported: boolean
  inspectionExpiresAt: string
  insuranceExpiresAt: string
  memo: string
  enabled: boolean
  sortOrder: number
}

export type WorkSession = {
  id: string
  companyId: string
  companyName: string
  storeId: string
  storeName: string
  staffId: string
  staffName: string
  staffRole: StaffRole
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

export const staffRoles: StaffRole[] = ['superAdmin', 'owner', 'manager', 'driver']
export const vehicleStatuses: VehicleStatus[] = ['稼働中', '整備中', '休車', '売却済']
export const vehicleFuelTypes: VehicleFuelType[] = ['', 'ガソリン', '軽油', 'EV']
