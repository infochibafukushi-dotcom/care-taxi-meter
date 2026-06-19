import type { StaffRole } from '../types/work'

export const defaultFranchiseeId = 'default-franchisee'
export const defaultStoreId = 'default-store'
export const defaultStoreName = '本店'

export type FranchiseRole = 'hq_admin' | 'franchisee_owner' | 'store_manager' | 'driver'

export type TenantScope = {
  franchiseeId: string
  storeId: string
}

export type TenantAccessScope = Partial<TenantScope> & {
  role?: StaffRole | ''
  staffId?: string
}

export const toFranchiseRole = (role: StaffRole | ''): FranchiseRole | '' => {
  if (role === 'hq_admin') return 'hq_admin'
  if (role === 'owner') return 'franchisee_owner'
  if (role === 'manager') return 'store_manager'
  if (role === 'driver') return 'driver'
  return ''
}

export const isHqRole = (role: StaffRole | '') => role === 'hq_admin'

export const getFranchiseeId = (data: Record<string, unknown>) =>
  typeof data.franchiseeId === 'string' && data.franchiseeId
    ? data.franchiseeId
    : typeof data.companyId === 'string' && data.companyId
      ? data.companyId
      : defaultFranchiseeId

export const getStoreId = (data: Record<string, unknown>) =>
  typeof data.storeId === 'string' && data.storeId ? data.storeId : defaultStoreId

export const tenantFields = ({ franchiseeId, storeId }: TenantScope) => ({
  companyId: franchiseeId,
  franchiseeId,
  storeId,
})

export type TenantSessionSource = {
  companyId?: string
  franchiseeId?: string
  storeId?: string
  staffId?: string
  staffRole?: StaffRole | ''
  id?: string
  role?: StaffRole
}

export const tenantScopeFromSession = (session?: TenantSessionSource | null): TenantScope => ({
  franchiseeId: session?.franchiseeId || session?.companyId || defaultFranchiseeId,
  storeId: session?.storeId || defaultStoreId,
})

export const tenantAccessScopeFromSessionSource = (
  sessionSource?: TenantSessionSource | null,
): TenantAccessScope => {
  if (!sessionSource) {
    return {}
  }

  const franchiseeId = sessionSource.franchiseeId || sessionSource.companyId || ''
  const storeId = sessionSource.storeId || ''
  const role = sessionSource.staffRole ?? sessionSource.role ?? ''
  const staffId = sessionSource.staffId ?? sessionSource.id ?? ''

  return {
    franchiseeId: franchiseeId || undefined,
    storeId: storeId || undefined,
    role,
    staffId: staffId || undefined,
  }
}

export const matchesTenantScope = <T extends { companyId?: string; franchiseeId?: string; storeId?: string; staffId?: string }>(
  item: T,
  scope?: TenantAccessScope,
) => {
  if (!scope || isHqRole(scope.role ?? '')) return true
  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  if (franchiseeId && (item.franchiseeId || item.companyId) !== franchiseeId) return false
  if (scope.storeId && item.storeId !== scope.storeId) return false
  if (scope.role === 'driver' && scope.staffId && item.staffId !== scope.staffId) return false
  return true
}
