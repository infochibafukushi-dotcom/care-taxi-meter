import { evaluateAdminProxyRoute } from './adminRouting.ts'
import { fetchNtaInvoiceRegistrant } from './invoiceLookup.ts'
import { evaluateInvoiceProxyRoute } from './invoiceRouting.ts'
import {
  isAllowedOrigin,
  parseAllowedOrigins,
  resolveCorsOrigin,
} from './originPolicy.ts'
import { evaluateDriverProxyRoute } from './routing.ts'
import { extractBearerToken, verifyFirebaseIdToken } from './ntaInvoiceAuth.ts'
import type { VerifyFirebaseIdTokenOptions, InvoiceAuthResult } from './ntaInvoiceAuth.ts'
import { D1InvoiceCacheStore, MemoryInvoiceCacheStore } from './ntaInvoiceCache.ts'
import { D1InvoiceAuditStore, MemoryInvoiceAuditStore, runInvoiceRegistryCheck } from './ntaInvoiceCheck.ts'
import { D1RateLimitStore, MemoryRateLimitStore } from './ntaInvoiceRateLimit.ts'
import { getTodayYmdInJapan, resolveNtaApplicationId } from './ntaEnv.ts'

export interface Env {
  METER_DRIVER_TOKEN: string
  RESERVATION_V4_ORIGIN: string
  ALLOWED_ORIGIN: string
  ALLOWED_ORIGINS?: string
  RESERVATION_V4?: Fetcher
  /** Preferred secret name for NTA application ID */
  NTA_APPLICATION_ID?: string
  /** Legacy secret name (backward compatible) */
  NTA_INVOICE_API_ID?: string
  /** Production default if unset */
  NTA_API_BASE_URL?: string
  FIREBASE_PROJECT_ID?: string
  DB?: D1Database
}

const FORWARDED_REQUEST_HEADERS = ['accept'] as const

const memoryCacheStore = new MemoryInvoiceCacheStore()
const memoryRateLimitStore = new MemoryRateLimitStore()
const memoryAuditStore = new MemoryInvoiceAuditStore()

const buildCorsHeaders = (request: Request, allowedOrigins: string[]) => {
  const headers = new Headers()
  const requestOrigin = request.headers.get('Origin')
  const corsOrigin = resolveCorsOrigin(requestOrigin, allowedOrigins)

  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin)
    headers.set('Vary', 'Origin')
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set(
    'Access-Control-Allow-Headers',
    'Accept, Content-Type, Authorization',
  )
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

const rejectDisallowedOrigin = (request: Request, allowedOrigins: string[]) => {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  if (isAllowedOrigin(origin, allowedOrigins)) return null
  return new Response('Forbidden', { status: 403 })
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

  if (request.method.toUpperCase() === 'POST') {
    const contentType = request.headers.get('content-type')
    if (contentType) {
      headers.set('content-type', contentType)
    }
  }

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

const resolveStores = (env: Env) => {
  if (env.DB) {
    return {
      cacheStore: new D1InvoiceCacheStore(env.DB),
      rateLimitStore: new D1RateLimitStore(env.DB),
      auditStore: new D1InvoiceAuditStore(env.DB),
    }
  }
  return {
    cacheStore: memoryCacheStore,
    rateLimitStore: memoryRateLimitStore,
    auditStore: memoryAuditStore,
  }
}

const logInvoiceCheckSafe = (meta: {
  requestId: string
  userId: string
  tenantId: string
  registrationNumber?: string
  basisDate?: string | null
  upstreamStatus?: number
  durationMs: number
  cacheHit: boolean
  errorCode?: string
}) => {
  console.info('[invoice-registry]', {
    requestId: meta.requestId,
    userId: meta.userId,
    tenantId: meta.tenantId,
    registrationNumber: meta.registrationNumber,
    basisDate: meta.basisDate ?? null,
    upstreamStatus: meta.upstreamStatus ?? null,
    durationMs: meta.durationMs,
    cacheHit: meta.cacheHit,
    errorCode: meta.errorCode ?? null,
  })
}

type InvoiceAuthVerifier = (
  options: VerifyFirebaseIdTokenOptions,
) => Promise<InvoiceAuthResult>

export type HandleDriverProxyOptions = {
  verifyAuth?: InvoiceAuthVerifier
}

const handleInvoiceRegistryCheck = async (
  request: Request,
  env: Env,
  corsHeaders: Headers,
  fetchImpl: typeof fetch,
  verifyAuth: InvoiceAuthVerifier = verifyFirebaseIdToken,
): Promise<Response> => {
  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const idToken = extractBearerToken(request)
  const auth = await verifyAuth({
    idToken,
    projectId: env.FIREBASE_PROJECT_ID ?? 'care-taxi-meter',
    fetchImpl,
  })

  if (!auth.ok) {
    const status = auth.code === 'FORBIDDEN' ? 403 : 401
    return jsonResponse(
      {
        ok: false,
        error: {
          code: auth.code,
          message: auth.message,
          retryable: false,
        },
      },
      status,
      corsHeaders,
    )
  }

  let body: {
    registrationNumber?: unknown
    basisDate?: unknown
    tenantId?: unknown
    franchiseeId?: unknown
    storeId?: unknown
  } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'リクエスト本文が不正です。',
          retryable: false,
        },
      },
      400,
      corsHeaders,
    )
  }

  // Ignore any client-supplied tenant/franchise/store IDs — auth.actor only.
  void body.tenantId
  void body.franchiseeId
  void body.storeId

  const stores = resolveStores(env)
  const result = await runInvoiceRegistryCheck({
    registrationNumberRaw: body.registrationNumber,
    basisDateRaw: body.basisDate,
    actor: auth.actor,
    applicationId: resolveNtaApplicationId(env),
    ntaApiBaseUrl: env.NTA_API_BASE_URL,
    todayYmd: getTodayYmdInJapan(),
    cacheStore: stores.cacheStore,
    rateLimitStore: stores.rateLimitStore,
    auditStore: stores.auditStore,
    fetchImpl,
  })

  logInvoiceCheckSafe(result.meta)

  const responseBody =
    result.body.ok && result.meta.verificationEnv
      ? {
          ...result.body,
          data: {
            ...result.body.data,
            // Soft marker for verification environment (no secrets)
            environment: 'verification' as const,
          },
        }
      : result.body

  return jsonResponse(responseBody, result.httpStatus, corsHeaders)
}

const handleInvoiceProxyRequest = async (
  request: Request,
  env: Env,
  allowedOrigins: string[],
  corsHeaders: Headers,
  fetchImpl: typeof fetch,
  verifyAuth: InvoiceAuthVerifier = verifyFirebaseIdToken,
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

  const originRejected = rejectDisallowedOrigin(request, allowedOrigins)
  if (originRejected) return originRejected

  if (routeDecision.kind === 'registry_check') {
    return handleInvoiceRegistryCheck(request, env, corsHeaders, fetchImpl, verifyAuth)
  }

  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const idToken = extractBearerToken(request)
  const auth = await verifyAuth({
    idToken,
    projectId: env.FIREBASE_PROJECT_ID ?? 'care-taxi-meter',
    fetchImpl,
  })
  if (!auth.ok) {
    const status = auth.code === 'FORBIDDEN' ? 403 : 401
    return jsonResponse(
      {
        status: 'error',
        message: auth.message,
        code: auth.code,
      },
      status,
      corsHeaders,
    )
  }

  const applicationId = resolveNtaApplicationId(env)
  if (!applicationId) {
    return jsonResponse(
      {
        status: 'error',
        message: 'Invoice API is not configured (NTA_APPLICATION_ID)',
        invoiceNumber: routeDecision.invoiceNumber,
      },
      503,
      corsHeaders,
    )
  }

  const result = await fetchNtaInvoiceRegistrant({
    invoiceNumber: routeDecision.invoiceNumber,
    applicationId,
    baseUrl: env.NTA_API_BASE_URL,
    fetchImpl,
  })

  return jsonResponse(result.body, result.status, corsHeaders)
}

const handleAdminProxyRequest = async (
  request: Request,
  env: Env,
  allowedOrigins: string[],
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

  const originRejected = rejectDisallowedOrigin(request, allowedOrigins)
  if (originRejected) return originRejected

  if (request.method.toUpperCase() === 'OPTIONS') {
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
  options: HandleDriverProxyOptions = {},
): Promise<Response> => {
  const requestUrl = new URL(request.url)
  const allowedOrigins = parseAllowedOrigins(env)
  const corsHeaders = buildCorsHeaders(request, allowedOrigins)
  const verifyAuth = options.verifyAuth ?? verifyFirebaseIdToken

  if (
    requestUrl.pathname.startsWith('/api/invoice/') ||
    requestUrl.pathname.startsWith('/api/invoice-registry/')
  ) {
    return handleInvoiceProxyRequest(
      request,
      env,
      allowedOrigins,
      corsHeaders,
      fetchImpl,
      verifyAuth,
    )
  }

  if (requestUrl.pathname.startsWith('/api/admin/')) {
    return handleAdminProxyRequest(request, env, allowedOrigins, corsHeaders, fetchImpl)
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

  const originRejected = rejectDisallowedOrigin(request, allowedOrigins)
  if (originRejected) return originRejected

  if (request.method.toUpperCase() === 'OPTIONS') {
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
