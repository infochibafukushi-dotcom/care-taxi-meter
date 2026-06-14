import type { StaffMember, StaffRole } from '../types/work'

const authSessionStorageKey = 'careTaxiMeter.authStaff'

const getStoredAuthSession = () =>
  sessionStorage.getItem(authSessionStorageKey) ?? localStorage.getItem(authSessionStorageKey)

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
  const serializedSession = JSON.stringify(session)
  sessionStorage.setItem(authSessionStorageKey, serializedSession)
  localStorage.setItem(authSessionStorageKey, serializedSession)
  return session
}

export const loadAuthStaffSession = (): AuthStaffSession | null => {
  try {
    const raw = getStoredAuthSession()
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
  localStorage.removeItem(authSessionStorageKey)
}
