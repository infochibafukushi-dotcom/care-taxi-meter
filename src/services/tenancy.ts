import type { QueryConstraint } from 'firebase/firestore'
import { where } from 'firebase/firestore'
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

/** Firestore custom claims / 旧データの role 表記をアプリ内 role に揃える */
export const normalizeTenantRole = (role?: string | null): StaffRole | '' => {
  if (!role) return ''
  if (role === 'superAdmin' || role === 'hq_admin') return 'hq_admin'
  if (role === 'franchisee_owner' || role === 'owner') return 'owner'
  if (role === 'store_manager' || role === 'manager') return 'manager'
  if (role === 'driver') return 'driver'
  return ''
}

export const isHqRole = (role?: string | null) => normalizeTenantRole(role) === 'hq_admin'

export const isFranchiseeOwnerRole = (role?: string | null) => normalizeTenantRole(role) === 'owner'

export const isStoreScopedTenantRole = (role?: string | null) => {
  const normalizedRole = normalizeTenantRole(role)
  return normalizedRole === 'manager' || normalizedRole === 'driver'
}

export const isDriverTenantRole = (role?: string | null) => normalizeTenantRole(role) === 'driver'

export const mergeTenantAccessScopes = (
  ...scopes: Array<TenantAccessScope | undefined | null>
): TenantAccessScope => {
  const merged: TenantAccessScope = {}

  for (const scope of scopes) {
    if (!scope) continue
    if (!merged.franchiseeId && scope.franchiseeId) merged.franchiseeId = scope.franchiseeId
    if (!merged.storeId && scope.storeId) merged.storeId = scope.storeId
    if (!merged.staffId && scope.staffId) merged.staffId = scope.staffId
    if (!merged.role && scope.role) merged.role = normalizeTenantRole(scope.role)
  }

  if (merged.role) {
    merged.role = normalizeTenantRole(merged.role)
  }

  return merged
}

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
  const role = normalizeTenantRole(sessionSource.staffRole ?? sessionSource.role ?? '')
  const staffId = sessionSource.staffId ?? sessionSource.id ?? ''

  return {
    franchiseeId: franchiseeId || undefined,
    storeId: storeId || undefined,
    role: role || undefined,
    staffId: staffId || undefined,
  }
}

export const matchesTenantScope = <T extends { companyId?: string; franchiseeId?: string; storeId?: string; staffId?: string }>(
  item: T,
  scope?: TenantAccessScope,
) => {
  const role = normalizeTenantRole(scope?.role ?? '')
  if (!scope || isHqRole(role)) return true
  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  if (franchiseeId && (item.franchiseeId || item.companyId) !== franchiseeId) return false
  // owner は加盟店全体。manager / driver のみ店舗で絞る
  if (
    scope.storeId &&
    isStoreScopedTenantRole(role) &&
    item.storeId &&
    item.storeId !== scope.storeId
  ) {
    return false
  }
  if (isDriverTenantRole(role) && scope.staffId && item.staffId !== scope.staffId) return false
  return true
}

/** AdminPage / SalesAnalyticsPage / caseRecords と同じテナント query 制約 */
export const createTenantQueryConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  const role = normalizeTenantRole(scope?.role ?? '')
  if (!scope || isHqRole(role)) {
    return []
  }

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  if (!franchiseeId) {
    throw new Error(
      'テナント情報が不足しているためデータを取得できません。一度ログアウトしてから再ログインしてください。',
    )
  }

  const constraints: QueryConstraint[] = [where('franchiseeId', '==', franchiseeId)]

  if (isStoreScopedTenantRole(role) && scope.storeId) {
    constraints.push(where('storeId', '==', scope.storeId))
  } else if (normalizeTenantRole(scope.role ?? '') === 'manager') {
    throw new Error(
      '店舗情報が不足しているため案件一覧を取得できません。一度ログアウトしてから再ログインしてください。',
    )
  }

  if (isDriverTenantRole(role) && scope.staffId) {
    constraints.push(where('staffId', '==', scope.staffId))
  } else if (isDriverTenantRole(role)) {
    throw new Error(
      'スタッフ情報が不足しているため案件一覧を取得できません。一度ログアウトしてから再ログインしてください。',
    )
  }

  return constraints
}

