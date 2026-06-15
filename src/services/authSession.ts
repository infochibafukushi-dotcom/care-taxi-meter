import type { StaffMember, StaffRole } from '../types/work'

const authSessionStorageKey = 'careTaxiMeter.authStaff'
const hqViewingSessionStorageKey = 'careTaxiMeter.hqViewingMode'

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

export type HqViewingSession = {
  companyName: string
  hqSession: AuthStaffSession | null
  returnPath: string
}

const serializeAuthSession = (session: AuthStaffSession) => {
  const serializedSession = JSON.stringify(session)
  sessionStorage.setItem(authSessionStorageKey, serializedSession)
  localStorage.setItem(authSessionStorageKey, serializedSession)
  return session
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
  return serializeAuthSession(session)
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

export const saveHqViewingSession = (session: AuthStaffSession, companyName: string, hqSession: AuthStaffSession | null, returnPath = '/hq') => {
  serializeAuthSession(session)
  const viewingSession: HqViewingSession = { companyName, hqSession, returnPath }
  sessionStorage.setItem(hqViewingSessionStorageKey, JSON.stringify(viewingSession))
  localStorage.setItem(hqViewingSessionStorageKey, JSON.stringify(viewingSession))
  return viewingSession
}

export const loadHqViewingSession = (): HqViewingSession | null => {
  try {
    const raw = sessionStorage.getItem(hqViewingSessionStorageKey) ?? localStorage.getItem(hqViewingSessionStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<HqViewingSession>
    if (!parsed.companyName) return null
    return {
      companyName: parsed.companyName,
      hqSession: parsed.hqSession ?? null,
      returnPath: parsed.returnPath || '/hq',
    }
  } catch {
    return null
  }
}

export const restoreHqSessionFromViewingMode = () => {
  const viewingSession = loadHqViewingSession()
  sessionStorage.removeItem(hqViewingSessionStorageKey)
  localStorage.removeItem(hqViewingSessionStorageKey)
  if (viewingSession?.hqSession) serializeAuthSession(viewingSession.hqSession)
  return viewingSession?.returnPath || '/hq'
}

export const clearAuthStaffSession = () => {
  sessionStorage.removeItem(authSessionStorageKey)
  localStorage.removeItem(authSessionStorageKey)
  sessionStorage.removeItem(hqViewingSessionStorageKey)
  localStorage.removeItem(hqViewingSessionStorageKey)
}
