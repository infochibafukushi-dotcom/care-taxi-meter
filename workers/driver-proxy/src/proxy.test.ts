import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleDriverProxyRequest } from './index.ts'
import { evaluateDriverProxyRoute } from './routing.ts'

const env = {
  METER_DRIVER_TOKEN: 'test-meter-token',
  RESERVATION_V4_ORIGIN: 'https://reservation-v4.example.com',
  ALLOWED_ORIGIN: 'https://pages.example.com',
}

describe('evaluateDriverProxyRoute', () => {
  it('allows reservation list GET with date query', () => {
    const decision = evaluateDriverProxyRoute(
      'GET',
      '/api/driver/reservations',
      new URLSearchParams({ date: '2026-06-26' }),
    )
    assert.equal(decision.kind, 'allowed')
  })

  it('rejects reservation list GET without date', () => {
    const decision = evaluateDriverProxyRoute('GET', '/api/driver/reservations', new URLSearchParams())
    assert.equal(decision.kind, 'not_found')
  })

  it('allows reservation detail GET', () => {
    const decision = evaluateDriverProxyRoute(
      'GET',
      '/api/driver/reservations/res-001',
      new URLSearchParams(),
    )
    assert.equal(decision.kind, 'allowed')
  })

  it('allows fixed fare POST actions', () => {
    assert.equal(
      evaluateDriverProxyRoute(
        'POST',
        '/api/driver/reservations/res-001/start-fixed-fare',
        new URLSearchParams(),
      ).kind,
      'allowed',
    )
    assert.equal(
      evaluateDriverProxyRoute(
        'POST',
        '/api/driver/reservations/res-001/complete-fixed-fare',
        new URLSearchParams(),
      ).kind,
      'allowed',
    )
  })

  it('rejects unknown paths', () => {
    assert.equal(
      evaluateDriverProxyRoute('GET', '/api/driver/admin', new URLSearchParams()).kind,
      'not_found',
    )
  })

  it('rejects unsupported methods on known paths', () => {
    assert.equal(
      evaluateDriverProxyRoute('DELETE', '/api/driver/reservations/res-001', new URLSearchParams()).kind,
      'method_not_allowed',
    )
  })
})

describe('handleDriverProxyRequest', () => {
  it('proxies allowed GET with bearer token and strips cookies', async () => {
    let upstreamRequest: Request | null = null
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamRequest = new Request(input, init)
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations/res-001', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer client-token',
          Cookie: 'session=abc',
          Origin: env.ALLOWED_ORIGIN,
        },
      }),
      env,
      fetchImpl,
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
    assert.ok(upstreamRequest)
    assert.equal(upstreamRequest.url, 'https://reservation-v4.example.com/api/driver/reservations/res-001')
    assert.equal(upstreamRequest.headers.get('Authorization'), 'Bearer test-meter-token')
    assert.equal(upstreamRequest.headers.get('Cookie'), null)
  })

  it('proxies allowed POST actions', async () => {
    let upstreamMethod = ''
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamMethod = init?.method ?? ''
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations/res-001/start-fixed-fare', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: env.ALLOWED_ORIGIN,
        },
        body: JSON.stringify({}),
      }),
      env,
      fetchImpl,
    )

    assert.equal(response.status, 200)
    assert.equal(upstreamMethod, 'POST')
  })

  it('returns 404 for disallowed paths', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/admin', {
        headers: { Origin: env.ALLOWED_ORIGIN },
      }),
      env,
      async () => new Response('should not be called', { status: 500 }),
    )

    assert.equal(response.status, 404)
  })

  it('returns 405 for disallowed methods', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations/res-001', {
        method: 'DELETE',
        headers: { Origin: env.ALLOWED_ORIGIN },
      }),
      env,
      async () => new Response('should not be called', { status: 500 }),
    )

    assert.equal(response.status, 405)
  })

  it('does not allow CORS for mismatched origins', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations?date=2026-06-26', {
        method: 'GET',
        headers: { Origin: 'https://evil.example.com' },
      }),
      env,
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    )

    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  })

  it('rejects OPTIONS preflight from mismatched origins', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations/res-001', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      }),
      env,
      async () => new Response('should not be called', { status: 500 }),
    )

    assert.equal(response.status, 403)
  })
})
