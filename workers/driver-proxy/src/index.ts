// CORS alone cannot block direct curl access to this Worker.
// Next phase: verify Firebase ID Token / JWT before proxying upstream.
import { evaluateAdminProxyRoute } from './adminRouting'
import { fetchNtaInvoiceRegistrant } from './invoiceLookup'
import { evaluateInvoiceProxyRoute } from './invoiceRouting'
import { evaluateDriverProxyRoute } from './routing'

export interface Env {
  METER_DRIVER_TOKEN: string
  RESERVATION_V4_ORIGIN: string
  ALLOWED_ORIGIN: string
  RESERVATION_V4?: Fetcher
  /** 国税庁インボイス公表システム Web-API アプリケーションID */
  NTA_INVOICE_API_ID?: string
}

const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type'] as const

const buildCorsHeaders = (request: Request, allowedOrigin: string) => {
  const headers = new Headers()
  const requestOrigin = request.headers.get('Origin')

  if (requestOrigin && requestOrigin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin)
    headers.set('Vary', 'Origin')
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type')
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

const mergeCorsHeaders = (response: Response, corsHeaders: Headers) => {
  const headers = new Headers(response.headers)
  ;[
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Headers',
    'Access-Control-Max-Age',
    'Vary',
  ].forEach((headerName) => {
    headers.delete(headerName)
  })
  corsHeaders.forEach((value, key) => {
    headers.set(key, value)
  })
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const jsonResponse = (body: unknown, status: number, corsHeaders: Headers) =>
  mergeCorsHeaders(
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    }),
    corsHeaders,
  )

const buildUpstreamHeaders = (request: Request, token: string) => {
  const headers = new Headers()
  headers.set('Authorization', `Bearer ${token}`)

  FORWARDED_REQUEST_HEADERS.forEach((headerName) => {
    const value = request.headers.get(headerName)
    if (value) {
      headers.set(headerName, value)
    }
  })

  return headers
}

const buildUpstreamUrl = (request: Request, reservationOrigin: string) => {
  const origin = reservationOrigin.trim().replace(/\/+$/, '')
  const requestUrl = new URL(request.url)
  return new URL(`${origin}${requestUrl.pathname}${requestUrl.search}`)
}

const hasUpstreamTarget = (env: Env) =>
  Boolean(env.RESERVATION_V4) || Boolean(env.RESERVATION_V4_ORIGIN?.trim())

const fetchUpstream = (
  request: Request,
  env: Env,
  fetchImpl: typeof fetch,
) => {
  const token = env.METER_DRIVER_TOKEN.trim()
  const headers = buildUpstreamHeaders(request, token)
  const method = request.method
  const body =
    method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD'
      ? undefined
      : request.body
  const requestUrl = new URL(request.url)

  if (env.RESERVATION_V4) {
    return env.RESERVATION_V4.fetch(
      new Request(`https://reservation-v4.internal${requestUrl.pathname}${requestUrl.search}`, {
        method,
        headers,
        body,
        redirect: 'manual',
      }),
    )
  }

  return fetchImpl(buildUpstreamUrl(request, env.RESERVATION_V4_ORIGIN), {
    method,
    headers,
    body,
    redirect: 'manual',
  })
}

const handleInvoiceProxyRequest = async (
  request: Request,
  env: Env,
  corsHeaders: Headers,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const requestUrl = new URL(request.url)
  const routeDecision = evaluateInvoiceProxyRoute(
    request.method,
    requestUrl.pathname,
    requestUrl.searchParams,
  )

  if (routeDecision.kind === 'not_found') {
    return new Response('Not Found', { status: 404, headers: corsHeaders })
  }

  if (routeDecision.kind === 'method_not_allowed') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  if (routeDecision.kind === 'bad_request') {
    return jsonResponse({ status: 'error', message: routeDecision.message }, 400, corsHeaders)
  }

  if (request.method.toUpperCase() === 'OPTIONS') {
    if (!request.headers.get('Origin') || request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return new Response(null, { status: 403 })
    }

    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const applicationId = env.NTA_INVOICE_API_ID?.trim() ?? ''
  if (!applicationId) {
    return jsonResponse(
      {
        status: 'error',
        message: 'Invoice API is not configured (NTA_INVOICE_API_ID)',
        invoiceNumber: routeDecision.invoiceNumber,
      },
      503,
      corsHeaders,
    )
  }

  const result = await fetchNtaInvoiceRegistrant({
    invoiceNumber: routeDecision.invoiceNumber,
    applicationId,
    fetchImpl,
  })

  return jsonResponse(result.body, result.status, corsHeaders)
}

const handleAdminProxyRequest = async (
  request: Request,
  env: Env,
  corsHeaders: Headers,
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const requestUrl = new URL(request.url)
  const routeDecision = evaluateAdminProxyRoute(request.method, requestUrl.pathname)

  if (routeDecision.kind === 'not_found') {
    return new Response('Not Found', { status: 404, headers: corsHeaders })
  }

  if (routeDecision.kind === 'method_not_allowed') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  if (request.method.toUpperCase() === 'OPTIONS') {
    if (!request.headers.get('Origin') || request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return new Response(null, { status: 403 })
    }

    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (!env.METER_DRIVER_TOKEN?.trim() || !hasUpstreamTarget(env)) {
    return new Response('Proxy is not configured', { status: 500, headers: corsHeaders })
  }

  const upstreamResponse = await fetchUpstream(request, env, fetchImpl)
  return mergeCorsHeaders(upstreamResponse, corsHeaders)
}

export const handleDriverProxyRequest = async (
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const requestUrl = new URL(request.url)
  const corsHeaders = buildCorsHeaders(request, env.ALLOWED_ORIGIN)

  if (requestUrl.pathname.startsWith('/api/invoice/')) {
    return handleInvoiceProxyRequest(request, env, corsHeaders, fetchImpl)
  }

  if (requestUrl.pathname.startsWith('/api/admin/')) {
    return handleAdminProxyRequest(request, env, corsHeaders, fetchImpl)
  }

  const routeDecision = evaluateDriverProxyRoute(
    request.method,
    requestUrl.pathname,
    requestUrl.searchParams,
  )

  if (routeDecision.kind === 'not_found') {
    return new Response('Not Found', { status: 404, headers: corsHeaders })
  }

  if (routeDecision.kind === 'method_not_allowed') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  if (request.method.toUpperCase() === 'OPTIONS') {
    if (!request.headers.get('Origin') || request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return new Response(null, { status: 403 })
    }

    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (!env.METER_DRIVER_TOKEN?.trim() || !hasUpstreamTarget(env)) {
    return new Response('Proxy is not configured', { status: 500, headers: corsHeaders })
  }

  const upstreamResponse = await fetchUpstream(request, env, fetchImpl)

  return mergeCorsHeaders(upstreamResponse, corsHeaders)
}

export default {
  fetch(request: Request, env: Env) {
    return handleDriverProxyRequest(request, env)
  },
}
