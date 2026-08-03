const INVOICE_API_PREFIX = '/api/invoice/'
const INVOICE_NUMBER_PATTERN = /^T\d{13}$/i

export type InvoiceRouteDecision =
  | { kind: 'registrant'; invoiceNumber: string }
  | { kind: 'registry_check' }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed' }
  | { kind: 'bad_request'; message: string }

export const evaluateInvoiceProxyRoute = (
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): InvoiceRouteDecision => {
  const normalizedMethod = method.toUpperCase()
  const path = pathname.replace(/\/+$/, '') || '/'

  if (
    !path.startsWith(INVOICE_API_PREFIX) &&
    path !== '/api/invoice/registrant' &&
    path !== '/api/invoice-registry/check'
  ) {
    return { kind: 'not_found' }
  }

  if (path === '/api/invoice-registry/check' || path === '/api/invoice/registry/check') {
    if (normalizedMethod === 'OPTIONS') {
      return { kind: 'registry_check' }
    }
    if (normalizedMethod !== 'POST') {
      return { kind: 'method_not_allowed' }
    }
    return { kind: 'registry_check' }
  }

  if (path !== '/api/invoice/registrant') {
    return { kind: 'not_found' }
  }

  if (normalizedMethod === 'OPTIONS') {
    return { kind: 'registrant', invoiceNumber: '' }
  }

  if (normalizedMethod !== 'GET') {
    return { kind: 'method_not_allowed' }
  }

  const number = (searchParams.get('number') ?? '').trim().toUpperCase()
  if (!INVOICE_NUMBER_PATTERN.test(number)) {
    return {
      kind: 'bad_request',
      message: 'number must be a T + 13 digit invoice registration number',
    }
  }

  return { kind: 'registrant', invoiceNumber: number }
}
