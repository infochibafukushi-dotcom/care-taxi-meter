const ADMIN_API_PREFIX = '/api/admin/'
const DATE_QUERY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type AdminRouteDecision =
  | { kind: 'allowed' }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed' }

export const evaluateAdminProxyRoute = (
  method: string,
  pathname: string,
): AdminRouteDecision => {
  const normalizedMethod = method.toUpperCase()

  if (!pathname.startsWith(ADMIN_API_PREFIX)) {
    return { kind: 'not_found' }
  }

  if (normalizedMethod === 'OPTIONS') {
    return evaluateAdminOptionsRoute(pathname)
  }

  if (normalizedMethod === 'GET' && pathname === '/api/admin/reservations/pre-opening-reset/capability') {
    return { kind: 'allowed' }
  }

  if (normalizedMethod === 'POST' && pathname === '/api/admin/reservations/pre-opening-reset') {
    return { kind: 'allowed' }
  }

  if (matchesKnownAdminPathShape(pathname)) {
    return { kind: 'method_not_allowed' }
  }

  return { kind: 'not_found' }
}

const evaluateAdminOptionsRoute = (pathname: string): AdminRouteDecision => {
  if (evaluateAdminProxyRoute('GET', pathname).kind === 'allowed') {
    return { kind: 'allowed' }
  }

  if (evaluateAdminProxyRoute('POST', pathname).kind === 'allowed') {
    return { kind: 'allowed' }
  }

  return { kind: 'not_found' }
}

const matchesKnownAdminPathShape = (pathname: string) =>
  pathname === '/api/admin/reservations/pre-opening-reset' ||
  pathname === '/api/admin/reservations/pre-opening-reset/capability'

export const isValidReservationDateQuery = (value: string) =>
  Boolean(value) && DATE_QUERY_PATTERN.test(value)
