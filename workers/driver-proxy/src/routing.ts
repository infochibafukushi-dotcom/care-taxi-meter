const DRIVER_API_PREFIX = '/api/driver/'
const DATE_QUERY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RESERVATION_ID_PATTERN = /^[^/]+$/

export type RouteDecision =
  | { kind: 'allowed' }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed' }

const isValidReservationId = (value: string) =>
  value.length > 0 && RESERVATION_ID_PATTERN.test(value)

export const evaluateDriverProxyRoute = (
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): RouteDecision => {
  const normalizedMethod = method.toUpperCase()

  if (!pathname.startsWith(DRIVER_API_PREFIX)) {
    return { kind: 'not_found' }
  }

  if (normalizedMethod === 'OPTIONS') {
    return evaluateOptionsRoute(pathname, searchParams)
  }

  if (normalizedMethod !== 'GET' && normalizedMethod !== 'POST') {
    if (matchesKnownPathShape(pathname, searchParams)) {
      return { kind: 'method_not_allowed' }
    }
    return { kind: 'not_found' }
  }

  if (pathname === '/api/driver/fare-master/active') {
    if (normalizedMethod === 'GET') {
      return { kind: 'allowed' }
    }
    if (normalizedMethod === 'POST' || normalizedMethod === 'PUT' || normalizedMethod === 'PATCH' || normalizedMethod === 'DELETE') {
      return { kind: 'method_not_allowed' }
    }
    return { kind: 'not_found' }
  }

  if (normalizedMethod === 'GET' && pathname === '/api/driver/reservations') {
    const date = searchParams.get('date')?.trim() ?? ''
    return date && DATE_QUERY_PATTERN.test(date)
      ? { kind: 'allowed' }
      : { kind: 'not_found' }
  }

  if (normalizedMethod === 'GET') {
    const match = pathname.match(/^\/api\/driver\/reservations\/([^/]+)$/)
    return match && isValidReservationId(match[1])
      ? { kind: 'allowed' }
      : { kind: 'not_found' }
  }

  const startMatch = pathname.match(/^\/api\/driver\/reservations\/([^/]+)\/start-fixed-fare$/)
  if (startMatch && isValidReservationId(startMatch[1])) {
    return { kind: 'allowed' }
  }

  const completeMatch = pathname.match(/^\/api\/driver\/reservations\/([^/]+)\/complete-fixed-fare$/)
  if (completeMatch && isValidReservationId(completeMatch[1])) {
    return { kind: 'allowed' }
  }

  const resetMatch = pathname.match(/^\/api\/driver\/reservations\/([^/]+)\/reset-fixed-fare$/)
  if (resetMatch && isValidReservationId(resetMatch[1])) {
    return { kind: 'allowed' }
  }

  return { kind: 'not_found' }
}

const evaluateOptionsRoute = (
  pathname: string,
  searchParams: URLSearchParams,
): RouteDecision => {
  if (evaluateDriverProxyRoute('GET', pathname, searchParams).kind === 'allowed') {
    return { kind: 'allowed' }
  }

  if (evaluateDriverProxyRoute('POST', pathname, searchParams).kind === 'allowed') {
    return { kind: 'allowed' }
  }

  return { kind: 'not_found' }
}

const matchesKnownPathShape = (pathname: string, searchParams: URLSearchParams) =>
  evaluateDriverProxyRoute('GET', pathname, searchParams).kind === 'allowed' ||
  evaluateDriverProxyRoute('POST', pathname, searchParams).kind === 'allowed'
