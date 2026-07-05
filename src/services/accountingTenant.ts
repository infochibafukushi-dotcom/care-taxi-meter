import type { QueryConstraint } from 'firebase/firestore'
import { where } from 'firebase/firestore'
import type { TenantAccessScope, TenantSessionSource } from './tenancy'
import { tenantAccessScopeFromSessionSource, tenantScopeFromSession } from './tenancy'

export const describeAccountingQueryScope = (scope?: TenantAccessScope) => ({
  role: scope?.role ?? '',
  franchiseeId: scope?.franchiseeId ?? '',
  storeId: scope?.storeId ?? '',
  staffId: scope?.staffId ?? '',
})

export const logAccountingQueryFailure = (
  collectionName: string,
  scope: TenantAccessScope | undefined,
  error: unknown,
  extra?: Record<string, unknown>,
) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''

  console.error(`[accounting] ${collectionName} query failed`, {
    collection: collectionName,
    query: describeAccountingQueryScope(scope),
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error ?? ''),
    ...extra,
  })
}

export const formatAccountingQueryErrorMessage = (collectionName: string, error: unknown) => {
  const message = error instanceof Error ? error.message : '経理データの取得に失敗しました。'
  return `${collectionName}: ${message}`
}

export const resolveAccountingAccessScope = (
  sessionSource?: TenantSessionSource | null,
): TenantAccessScope => {
  const scope = tenantAccessScopeFromSessionSource(sessionSource)

  if (scope.role === 'hq_admin') {
    return scope
  }

  const tenant = tenantScopeFromSession(sessionSource)

  return {
    ...scope,
    franchiseeId: scope.franchiseeId || tenant.franchiseeId,
    storeId: scope.storeId || tenant.storeId,
  }
}

export const createAccountingTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || scope.role === 'hq_admin') {
    return []
  }

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  if (!franchiseeId) {
    const error = new Error('加盟店IDが取得できません。再ログインしてください。')
    logAccountingQueryFailure('accounting', scope, error)
    throw error
  }

  const constraints: QueryConstraint[] = [where('franchiseeId', '==', franchiseeId)]

  if (scope.storeId && scope.role !== 'owner') {
    constraints.push(where('storeId', '==', scope.storeId))
  }

  return constraints
}

export const resolveAccountingTenantFields = ({
  franchiseeId,
  storeId,
}: {
  franchiseeId: string
  storeId: string
}) => ({
  franchiseeId,
  companyId: franchiseeId,
  storeId,
})
