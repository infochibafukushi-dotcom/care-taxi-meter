import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateAdminProxyRoute } from './adminRouting.ts'
import { handleDriverProxyRequest } from './index.ts'
import { evaluateDriverProxyRoute } from './routing.ts'

const env = {
  METER_DRIVER_TOKEN: 'test-meter-token',
  RESERVATION_V4_ORIGIN: 'https://reservation-v4.example.com',
  ALLOWED_ORIGIN: 'https://pages.example.com',
  ALLOWED_ORIGINS: 'https://pages.example.com,http://localhost:5173',
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
    assert.equal(
      evaluateDriverProxyRoute(
        'POST',
        '/api/driver/reservations/res-001/reset-fixed-fare',
        new URLSearchParams(),
      ).kind,
      'allowed',
    )
  })

  it('allows fare master active GET', () => {
    const decision = evaluateDriverProxyRoute(
      'GET',
      '/api/driver/fare-master/active',
      new URLSearchParams(),
    )
    assert.equal(decision.kind, 'allowed')
  })

  it('rejects fare master POST', () => {
    const decision = evaluateDriverProxyRoute(
      'POST',
      '/api/driver/fare-master/active',
      new URLSearchParams(),
    )
    assert.equal(decision.kind, 'method_not_allowed')
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

describe('evaluateAdminProxyRoute', () => {
  it('allows pre-opening reset capability GET', () => {
    const decision = evaluateAdminProxyRoute(
      'GET',
      '/api/admin/reservations/pre-opening-reset/capability',
    )
    assert.equal(decision.kind, 'allowed')
  })

  it('allows pre-opening reset POST', () => {
    const decision = evaluateAdminProxyRoute('POST', '/api/admin/reservations/pre-opening-reset')
    assert.equal(decision.kind, 'allowed')
  })

  it('rejects unsupported methods on admin paths', () => {
    assert.equal(
      evaluateAdminProxyRoute('DELETE', '/api/admin/reservations/pre-opening-reset').kind,
      'method_not_allowed',
    )
  })
})

describe('evaluateInvoiceProxyRoute', () => {
  it('allows registrant GET with invoice number', async () => {
    const { evaluateInvoiceProxyRoute } = await import('./invoiceRouting.ts')
    const decision = evaluateInvoiceProxyRoute(
      'GET',
      '/api/invoice/registrant',
      new URLSearchParams({ number: 'T4200001013662' }),
    )
    assert.equal(decision.kind, 'allowed')
    if (decision.kind === 'allowed') {
      assert.equal(decision.invoiceNumber, 'T4200001013662')
    }
  })

  it('rejects invalid invoice numbers', async () => {
    const { evaluateInvoiceProxyRoute } = await import('./invoiceRouting.ts')
    const decision = evaluateInvoiceProxyRoute(
      'GET',
      '/api/invoice/registrant',
      new URLSearchParams({ number: '4200001013662' }),
    )
    assert.equal(decision.kind, 'bad_request')
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

  it('proxies reset-fixed-fare POST body', async () => {
    let upstreamUrl = ''
    let upstreamMethod = ''
    let upstreamBody = ''
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamMethod = init?.method ?? ''
      upstreamBody = init?.body ? await new Response(init.body as BodyInit).text() : ''
      return new Response(JSON.stringify({ success: true, run: { meterRunStatus: 'not_started' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const resetBody = {
      reason: 'missing_active_trip_snapshot',
      confirmReservationId: 'res-001',
      resetBy: 'meter_driver',
    }

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations/res-001/reset-fixed-fare', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: env.ALLOWED_ORIGIN,
        },
        body: JSON.stringify(resetBody),
      }),
      env,
      fetchImpl,
    )

    assert.equal(response.status, 200)
    assert.equal(new URL(upstreamUrl).pathname, '/api/driver/reservations/res-001/reset-fixed-fare')
    assert.equal(upstreamMethod, 'POST')
    assert.deepEqual(JSON.parse(upstreamBody), resetBody)
  })

  it('forwards complete-fixed-fare passenger-change completion body', async () => {
    let upstreamBody = ''
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamBody = init?.body ? await new Response(init.body as BodyInit).text() : ''
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    const completionBody = {
      completionStatus: 'completed_with_passenger_change',
      completionReason: 'passenger_requested_route_change',
      preFixedFareException: {
        type: 'passenger_requested_change',
        reasonLabel: '旅客都合によるルート変更・立ち寄り追加',
        endedAt: '2026-06-27T10:00:00.000Z',
        endedLocation: { lat: 35.0, lng: 135.0, accuracy: 10 },
        originalFixedFareYen: 12345,
        fareModeBeforeEnd: 'pre_fixed_fare',
        nextOperationRequired: 'start_new_meter_trip',
      },
    }

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations/res-001/complete-fixed-fare', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: env.ALLOWED_ORIGIN,
        },
        body: JSON.stringify(completionBody),
      }),
      env,
      fetchImpl,
    )

    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(upstreamBody), completionBody)
  })

  it('proxies fare master active GET with bearer token and no client secret leak', async () => {
    let upstreamRequest: Request | null = null
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamRequest = new Request(input, init)
      return new Response(
        JSON.stringify({
          success: true,
          fareSource: 'active_master',
          fareMasterId: 'fmv-headquarters-v1',
          meterSettings: { waitingFare: { unitFareYen: 800 } },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/fare-master/active', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer client-token',
          Origin: env.ALLOWED_ORIGIN,
        },
      }),
      env,
      fetchImpl,
    )

    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN)
    assert.equal(body.fareSource, 'active_master')
    assert.ok(upstreamRequest)
    assert.equal(
      upstreamRequest.url,
      'https://reservation-v4.example.com/api/driver/fare-master/active',
    )
    assert.equal(upstreamRequest.headers.get('Authorization'), 'Bearer test-meter-token')
    assert.equal(upstreamRequest.headers.get('Authorization')?.includes('client-token'), false)
    const serialized = JSON.stringify(body)
    assert.equal(serialized.includes('test-meter-token'), false)
  })

  it('returns 403 for disallowed browser origins on fare master GET', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/fare-master/active', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Origin: 'https://evil.example.com',
        },
      }),
      env,
      async () => new Response('should not be called', { status: 500 }),
    )

    assert.equal(response.status, 403)
  })

  it('returns 405 for fare master POST', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/fare-master/active', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: env.ALLOWED_ORIGIN,
        },
        body: JSON.stringify({}),
      }),
      env,
      async () => new Response('should not be called', { status: 500 }),
    )

    assert.equal(response.status, 405)
  })

  it('forwards upstream 401 for fare master GET', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/fare-master/active', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Origin: env.ALLOWED_ORIGIN,
        },
      }),
      env,
      fetchImpl,
    )

    assert.equal(response.status, 401)
    const body = await response.json()
    assert.equal(body.message, 'Unauthorized')
    assert.equal(JSON.stringify(body).includes('test-meter-token'), false)
  })

  it('forwards upstream 500 for fare master GET', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ success: false, message: 'upstream failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/fare-master/active', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Origin: env.ALLOWED_ORIGIN,
        },
      }),
      env,
      fetchImpl,
    )

    assert.equal(response.status, 500)
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

  it('rejects browser requests from mismatched origins', async () => {
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/driver/reservations?date=2026-06-26', {
        method: 'GET',
        headers: { Origin: 'https://evil.example.com' },
      }),
      env,
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    )

    assert.equal(response.status, 403)
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
