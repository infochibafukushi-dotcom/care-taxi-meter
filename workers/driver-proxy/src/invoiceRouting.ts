const INVOICE_API_PREFIX = '/api/invoice/'
const INVOICE_NUMBER_PATTERN = /^T\d{13}$/i

export type InvoiceRouteDecision =
  | { kind: 'allowed'; invoiceNumber: string }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed' }
  | { kind: 'bad_request'; message: string }

export const evaluateInvoiceProxyRoute = (
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): InvoiceRouteDecision => {
  const normalizedMethod = method.toUpperCase()

  if (!pathname.startsWith(INVOICE_API_PREFIX) && pathname !== '/api/invoice/registrant') {
    return { kind: 'not_found' }
  }

  if (pathname !== '/api/invoice/registrant') {
    return { kind: 'not_found' }
  }

  if (normalizedMethod === 'OPTIONS') {
    return { kind: 'allowed', invoiceNumber: '' }
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

  return { kind: 'allowed', invoiceNumber: number }
}
