import type { StaffMember, StaffRole } from '../types/work'

const authSessionStorageKey = 'careTaxiMeter.authStaff'

export type AuthStaffSession = {
  companyId: string
  franchiseeId: string
  id: string
  name: string
  role: StaffRole
  storeId: string
  storeName: string
}

export const saveAuthStaffSession = (staffMember: StaffMember) => {
  const session: AuthStaffSession = {
    companyId: staffMember.companyId,
    franchiseeId: staffMember.franchiseeId || staffMember.companyId,
    id: staffMember.id,
    name: staffMember.name,
    role: staffMember.role,
    storeId: staffMember.storeId,
    storeName: staffMember.storeName,
  }
  sessionStorage.setItem(authSessionStorageKey, JSON.stringify(session))
  return session
}

export const loadAuthStaffSession = (): AuthStaffSession | null => {
  try {
    const raw = sessionStorage.getItem(authSessionStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthStaffSession>
    if (!parsed.id || !parsed.role) return null
    return {
      companyId: parsed.companyId ?? '',
      franchiseeId: parsed.franchiseeId || parsed.companyId || '',
      id: parsed.id,
      name: parsed.name ?? '',
      role: parsed.role,
      storeId: parsed.storeId ?? '',
      storeName: parsed.storeName ?? '',
    }
  } catch {
    return null
  }
}

export const clearAuthStaffSession = () => {
  sessionStorage.removeItem(authSessionStorageKey)
}
