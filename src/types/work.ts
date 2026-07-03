export type StaffRole = 'hq_admin' | 'owner' | 'manager' | 'driver'

export type CompanyStatus = 'screening' | 'preparing' | 'active' | 'suspended' | 'ending' | 'terminated' | 'archived'
export type StoreStatus = 'active' | 'suspended' | 'archived'

export type VehicleStatus = '稼働中' | '整備中' | '休車' | '売却済'

export type VehicleFuelType = 'ガソリン' | '軽油' | 'EV' | ''

export type StandardVehicleType = '1BOX' | 'ミニバン' | '軽自動車' | '乗用車' | 'その他'

export type WorkSessionStatus = 'working' | 'closed'

export type SubscriptionPlan = 'standard' | 'professional' | 'premium'

export type MeterPermissions = {
  gps: boolean
  time: boolean
  obd: boolean
}

export type NotificationSettings = {
  email: boolean
  line: boolean
}

export type Company = {
  id: string
  franchiseeId?: string
  name: string
  corporateName?: string
  postalCode?: string
  invoiceNumber?: string
  representativeName?: string
  representativeLoginId?: string
  representativeInitialPassword?: string
  area?: string
  status?: CompanyStatus
  subscriptionPlan?: SubscriptionPlan
  plan?: string
  monthlyFee?: number
  meterPermissions?: MeterPermissions
  notificationSettings?: NotificationSettings
  obdAdapterLoanEnabled?: boolean
  defaultObdModel?: string
  defaultPrinterModel?: string
  initialFee?: number
  contractStartDate?: string
  contractEndDate?: string
  contractStatus?: string
  billingStatus?: string
  lastBillingMonth?: string
  paymentStatus?: string
  lastLoginAt?: string
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
  franchiseeId: string
  name: string
  storeName?: string
  companyName?: string
  ownerName?: string
  address?: string
  phoneNumber?: string
  email?: string
  invoiceNumber?: string
  planId?: string
  planName?: string
  monthlyPrice?: number
  status: StoreStatus
  enabled: boolean
  isActive: boolean
  sortOrder: number
}

export type StaffMember = {
  id: string
  companyId: string
  franchiseeId: string
  storeId: string
  storeName: string
  userId: string
  password: string
  name: string
  role: StaffRole
  loginId?: string
  status?: 'employed' | 'leave' | 'retired' | 'disabled'
  joinedAt?: string
  retiredAt?: string
  lastLoginAt?: string
  canDrive: boolean
  isActive: boolean
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
  franchiseeId: string
  storeId: string
  storeName: string
  name: string
  vehicleName: string
  number: string
  plateNumber: string
  status: VehicleStatus
  fuelType: VehicleFuelType
  vehicleType: string
  wheelchairCapacity: number
  stretcherSupported: boolean
  inspectionExpiresAt: string
  insuranceExpiresAt: string
  memo: string
  enabled: boolean
  isActive: boolean
  sortOrder: number
}

export type WorkSession = {
  id: string
  companyId: string
  franchiseeId: string
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
  activeTripStatus?: string | null
  activeTripUpdatedAt?: string | null
  activeTripCaseNumber?: string | null
  activeTripVehicleId?: string | null
}


export type CurrentWorkSession = WorkSession

export const staffRoles: StaffRole[] = ['driver', 'manager', 'owner', 'hq_admin']
export const vehicleStatuses: VehicleStatus[] = ['稼働中', '整備中', '休車', '売却済']
export const vehicleFuelTypes: VehicleFuelType[] = ['', 'ガソリン', '軽油', 'EV']
export const standardVehicleTypes: StandardVehicleType[] = ['1BOX', 'ミニバン', '軽自動車', '乗用車', 'その他']
