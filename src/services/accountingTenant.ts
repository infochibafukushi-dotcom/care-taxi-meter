import { getAuth } from 'firebase/auth'
import type { QueryConstraint } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type { StaffRole } from '../types/work'
import { waitForFirebaseAuthUser } from './firebaseAuth'
import {
  createTenantQueryConstraints,
  tenantScopeFromSession,
  type TenantAccessScope,
  type TenantSessionSource,
} from './tenancy'

export type AccountingAuthTokenClaims = {
  role: string
  franchiseeId: string
  companyId: string
  storeId: string
  staffId: string
}

export const isAccountingDebugEnabled = (searchParams?: Pick<URLSearchParams, 'get'>) =>
  import.meta.env.DEV && searchParams?.get('debugAccounting') === '1'

export type AccountingSessionDiagnostics = {
  firebaseAuthUid: string
  firebaseAuthEmail: string
  tokenClaims: AccountingAuthTokenClaims | null
  appSessionRole: StaffRole | ''
  appSessionUserId: string
  appSessionCompanyId: string
  appSessionFranchiseeId: string
  appSessionStoreId: string
  accessScope: TenantAccessScope
  tenant: ReturnType<typeof tenantScopeFromSession>
  sessionSource: 'workSession' | 'authSession' | 'none'
}

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

const toClaimString = (value: unknown) => (typeof value === 'string' ? value : '')

export const readFirebaseAuthTokenClaims = async (): Promise<AccountingAuthTokenClaims | null> => {
  const user = getAuth(getFirebaseApp()).currentUser ?? (await waitForFirebaseAuthUser())
  if (!user) {
    return null
  }

  const token = await user.getIdTokenResult()
  return {
    role: toClaimString(token.claims.role),
    franchiseeId: toClaimString(token.claims.franchiseeId),
    companyId: toClaimString(token.claims.companyId),
    storeId: toClaimString(token.claims.storeId),
    staffId: toClaimString(token.claims.staffId),
  }
}

/** AdminPage / SalesAnalyticsPage と同じ session → scope 解決 */
export const resolveAccountingSessionContext = ({
  authSession,
  workSession,
}: {
  authSession?: TenantSessionSource | null
  workSession?: TenantSessionSource | null
}) => {
  const sessionSource = workSession ?? authSession ?? null
  const tenant = tenantScopeFromSession(sessionSource)
  const accessScope: TenantAccessScope = {
    franchiseeId: tenant.franchiseeId,
    storeId: tenant.storeId,
    role: (workSession?.staffRole ?? workSession?.role ?? authSession?.role ?? '') as StaffRole | '',
    staffId: workSession?.staffId ?? workSession?.id ?? authSession?.id ?? '',
  }

  return {
    sessionSource,
    tenant,
    accessScope,
    sessionSourceKind: workSession ? ('workSession' as const) : authSession ? ('authSession' as const) : ('none' as const),
  }
}

export const collectAccountingSessionDiagnostics = async ({
  authSession,
  workSession,
  logToConsole = false,
}: {
  authSession?: TenantSessionSource | null
  workSession?: TenantSessionSource | null
  logToConsole?: boolean
}): Promise<AccountingSessionDiagnostics> => {
  const { sessionSource, tenant, accessScope, sessionSourceKind } = resolveAccountingSessionContext({
    authSession,
    workSession,
  })
  const firebaseUser = getAuth(getFirebaseApp()).currentUser ?? (await waitForFirebaseAuthUser())
  const tokenClaims = firebaseUser ? await readFirebaseAuthTokenClaims() : null

  const diagnostics: AccountingSessionDiagnostics = {
    firebaseAuthUid: firebaseUser?.uid ?? '',
    firebaseAuthEmail: firebaseUser?.email ?? '',
    tokenClaims,
    appSessionRole: accessScope.role ?? '',
    appSessionUserId: accessScope.staffId ?? '',
    appSessionCompanyId: sessionSource?.companyId ?? '',
    appSessionFranchiseeId: tenant.franchiseeId,
    appSessionStoreId: tenant.storeId,
    accessScope,
    tenant,
    sessionSource: sessionSourceKind,
  }

  if (logToConsole) {
    console.info('[accounting] session diagnostics', diagnostics)
  }

  return diagnostics
}

export const validateAccountingFirebaseAuth = async ({
  authSession,
}: {
  authSession?: TenantSessionSource | null
}) => {
  const firebaseUser = getAuth(getFirebaseApp()).currentUser ?? (await waitForFirebaseAuthUser())

  if (authSession && !firebaseUser) {
    return 'Firebase Auth のセッションが無効です。一度ログアウトしてから再ログインしてください。'
  }

  if (!firebaseUser) {
    return 'Firebase Auth に未ログインです。ホームから再ログインしてください。'
  }

  const tokenClaims = await readFirebaseAuthTokenClaims()
  if (!tokenClaims?.role) {
    return 'Firebase Auth の role claim がありません。再ログインして custom token を更新してください。'
  }

  return ''
}

/** @deprecated resolveAccountingSessionContext().accessScope を使用 */
export const resolveAccountingAccessScope = (
  sessionSource?: TenantSessionSource | null,
): TenantAccessScope => resolveAccountingSessionContext({ authSession: sessionSource }).accessScope

export const createAccountingTenantConstraints = (scope?: TenantAccessScope): QueryConstraint[] =>
  createTenantQueryConstraints(scope)

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
