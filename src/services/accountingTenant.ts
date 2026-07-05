import type { QueryConstraint } from 'firebase/firestore'
import { where } from 'firebase/firestore'
import type { TenantAccessScope } from './tenancy'

export const createAccountingTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] => {
  if (!scope || scope.role === 'hq_admin') {
    return []
  }

  const franchiseeId = scope.franchiseeId || (scope as { companyId?: string }).companyId
  const constraints: QueryConstraint[] = []

  if (franchiseeId) {
    constraints.push(where('franchiseeId', '==', franchiseeId))
  }

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
