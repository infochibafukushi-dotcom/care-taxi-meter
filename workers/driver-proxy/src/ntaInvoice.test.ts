import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  INVOICE_REGISTRATION_NUMBER_ERROR,
  normalizeBasisDate,
  normalizeInvoiceRegistrationNumber,
  buildCacheKey,
} from './ntaInvoiceNormalize.ts'
import { determineInvoiceRegistryStatus } from './ntaInvoiceStatus.ts'
import { MemoryInvoiceCacheStore } from './ntaInvoiceCache.ts'
import { MemoryRateLimitStore } from './ntaInvoiceRateLimit.ts'
import { MemoryInvoiceAuditStore, runInvoiceRegistryCheck } from './ntaInvoiceCheck.ts'
import { canUseInvoiceRegistry, verifyFirebaseIdToken } from './ntaInvoiceAuth.ts'
import { NTA_USER_AGENT } from './ntaTypes.ts'

describe('normalizeInvoiceRegistrationNumber', () => {
  it('accepts normal T number', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('T1234567890123'), 'T1234567890123')
  })

  it('uppercases lowercase t', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('t1234567890123'), 'T1234567890123')
  })

  it('prefixes 13 digits with T', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('1234567890123'), 'T1234567890123')
  })

  it('converts full-width digits', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('Ｔ１２３４５６７８９０１２３'), 'T1234567890123')
  })

  it('strips spaces', () => {
    assert.equal(normalizeInvoiceRegistrationNumber(' T1234 5678 9012 3 '), 'T1234567890123')
  })

  it('strips hyphens', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('T1234-5678-9012-3'), 'T1234567890123')
  })

  it('rejects too short', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('T123'), '')
  })

  it('rejects too long', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('T12345678901234'), '')
  })

  it('rejects non-T letters', () => {
    assert.equal(normalizeInvoiceRegistrationNumber('X1234567890123'), '')
  })

  it('rejects empty', () => {
    assert.equal(normalizeInvoiceRegistrationNumber(''), '')
    assert.equal(INVOICE_REGISTRATION_NUMBER_ERROR.includes('T＋数字13桁'), true)
  })
})

describe('normalizeBasisDate', () => {
  it('accepts real past date', () => {
    const result = normalizeBasisDate('2026-08-01', { todayYmd: '2026-08-03' })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.date, '2026-08-01')
  })

  it('rejects future date', () => {
    const result = normalizeBasisDate('2026-08-04', { todayYmd: '2026-08-03' })
    assert.equal(result.ok, false)
  })

  it('rejects impossible calendar date', () => {
    const result = normalizeBasisDate('2026-02-30', { todayYmd: '2026-08-03' })
    assert.equal(result.ok, false)
  })

  it('allows empty as null', () => {
    const result = normalizeBasisDate('', { todayYmd: '2026-08-03' })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.date, null)
  })
})

describe('determineInvoiceRegistryStatus', () => {
  it('returns not_found for empty announcement', () => {
    const decision = determineInvoiceRegistryStatus({ count: '0', announcement: [] })
    assert.equal(decision.status, 'not_found')
    assert.equal(decision.isQualifiedAtBasisDate, false)
  })

  it('returns not_found for count string 0', () => {
    const decision = determineInvoiceRegistryStatus({ count: '0', announcement: [] })
    assert.equal(decision.status, 'not_found')
  })

  it('returns unknown when announcement is not array', () => {
    const decision = determineInvoiceRegistryStatus({
      count: '1',
      announcement: 'bad' as unknown as [],
    })
    assert.equal(decision.status, 'unknown')
  })

  it('treats process 01 as active', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        lastUpdateDate: '2026-07-01',
        announcement: [
          {
            registratedNumber: 'T1234567890123',
            process: '01',
            name: '株式会社テスト',
            registrationDate: '2023-10-01',
            kind: '2',
          },
        ],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'active')
    assert.equal(decision.isQualifiedAtBasisDate, true)
    assert.equal(decision.kind, 'corporation')
  })

  it('treats process 02 as active', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [{ process: '02', name: '個人事業主', registrationDate: '2023-01-01', kind: '1' }],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'active')
    assert.equal(decision.kind, 'individual')
  })

  it('treats process 03 as expired', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [{ process: '03', name: '失効社', expireDate: '2025-01-01' }],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'expired')
  })

  it('treats process 04 as cancelled', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [{ process: '04', name: '取消社', disposalDate: '2025-01-01' }],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'cancelled')
  })

  it('treats process 99 as not_found', () => {
    const decision = determineInvoiceRegistryStatus({
      count: '1',
      announcement: [{ process: '99', name: '削除' }],
    })
    assert.equal(decision.status, 'not_found')
  })

  it('uses expireDate boundary on basis date', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [
          {
            process: '01',
            name: '境界',
            registrationDate: '2023-01-01',
            expireDate: '2026-08-03',
          },
        ],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'expired')
  })

  it('uses disposalDate boundary on basis date', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [
          {
            process: '01',
            name: '境界',
            registrationDate: '2023-01-01',
            disposalDate: '2026-08-03',
          },
        ],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'cancelled')
  })

  it('registrationDate after basis is not_found', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [
          {
            process: '01',
            name: '未来登録',
            registrationDate: '2026-08-04',
          },
        ],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'not_found')
  })

  it('registrationDate equal to basis is active', () => {
    const decision = determineInvoiceRegistryStatus(
      {
        count: '1',
        announcement: [
          {
            process: '01',
            name: '当日登録',
            registrationDate: '2026-08-03',
          },
        ],
      },
      { basisDate: '2026-08-03' },
    )
    assert.equal(decision.status, 'active')
  })
})

describe('buildCacheKey', () => {
  it('builds valid and num keys', () => {
    assert.equal(buildCacheKey('valid', 'T1234567890123', '2026-08-03'), 'valid:T1234567890123:2026-08-03')
    assert.equal(buildCacheKey('num', 'T1234567890123', null), 'num:T1234567890123:current')
  })
})

describe('canUseInvoiceRegistry', () => {
  it('mirrors canAccessAccounting: owner / franchisee_owner / hq_admin allowed', () => {
    assert.equal(canUseInvoiceRegistry('owner'), true)
    assert.equal(canUseInvoiceRegistry('franchisee_owner'), true)
    assert.equal(canUseInvoiceRegistry('hq_admin'), true)
    assert.equal(canUseInvoiceRegistry('superAdmin'), true)
  })

  it('denies manager and driver (no accounting UI permission)', () => {
    assert.equal(canUseInvoiceRegistry('manager'), false)
    assert.equal(canUseInvoiceRegistry('store_manager'), false)
    assert.equal(canUseInvoiceRegistry('driver'), false)
    assert.equal(canUseInvoiceRegistry(''), false)
  })
})

describe('verifyFirebaseIdToken unsafe decode', () => {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  const buildToken = (claims: Record<string, unknown>) =>
    `${encode({ alg: 'none' })}.${encode({
      iss: 'https://securetoken.google.com/care-taxi-meter',
      aud: 'care-taxi-meter',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'uid-1',
      ...claims,
    })}.sig`

  it('rejects driver role with FORBIDDEN', async () => {
    const result = await verifyFirebaseIdToken({
      idToken: buildToken({
        role: 'driver',
        franchiseeId: 'fc-1',
        storeId: 's1',
        staffId: 'st1',
      }),
      projectId: 'care-taxi-meter',
      unsafeDecodeOnly: true,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'FORBIDDEN')
  })

  it('rejects manager role with FORBIDDEN', async () => {
    const result = await verifyFirebaseIdToken({
      idToken: buildToken({
        role: 'manager',
        franchiseeId: 'fc-1',
        storeId: 's1',
        staffId: 'st1',
      }),
      projectId: 'care-taxi-meter',
      unsafeDecodeOnly: true,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'FORBIDDEN')
  })

  it('accepts FC加盟店オーナー (owner)', async () => {
    const result = await verifyFirebaseIdToken({
      idToken: buildToken({
        role: 'owner',
        franchiseeId: 'fc-1',
        storeId: 's1',
        staffId: 'st1',
      }),
      projectId: 'care-taxi-meter',
      unsafeDecodeOnly: true,
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.actor.role, 'owner')
      assert.equal(result.actor.franchiseeId, 'fc-1')
    }
  })

  it('accepts FC加盟店オーナー alias franchisee_owner', async () => {
    const result = await verifyFirebaseIdToken({
      idToken: buildToken({
        role: 'franchisee_owner',
        franchiseeId: 'fc-2',
        storeId: 's2',
        staffId: 'st2',
      }),
      projectId: 'care-taxi-meter',
      unsafeDecodeOnly: true,
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.actor.role, 'owner')
      assert.equal(result.actor.franchiseeId, 'fc-2')
    }
  })

  it('accepts hq_admin', async () => {
    const result = await verifyFirebaseIdToken({
      idToken: buildToken({
        role: 'hq_admin',
        franchiseeId: 'hq',
        storeId: 'hq-s',
        staffId: 'hq-1',
      }),
      projectId: 'care-taxi-meter',
      unsafeDecodeOnly: true,
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.actor.role, 'hq_admin')
  })

  it('rejects missing token as UNAUTHENTICATED', async () => {
    const result = await verifyFirebaseIdToken({
      idToken: '',
      projectId: 'care-taxi-meter',
      unsafeDecodeOnly: true,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'UNAUTHENTICATED')
  })
})

describe('runInvoiceRegistryCheck', () => {
  const actor = {
    userId: 'uid-1',
    staffId: 'st1',
    role: 'owner',
    franchiseeId: 'fc-1',
    storeId: 's1',
  }

  it('returns success and caches', async () => {
    const cacheStore = new MemoryInvoiceCacheStore()
    const rateLimitStore = new MemoryRateLimitStore()
    const auditStore = new MemoryInvoiceAuditStore()
    let called = 0

    const fetchImpl: typeof fetch = async (input) => {
      called += 1
      const url = String(input)
      assert.equal(url.includes('id='), true)
      assert.equal(url.includes('/1/valid'), true)
      // ensure we do not accidentally log full URL in this test body
      return new Response(
        JSON.stringify({
          lastUpdateDate: '2026-07-01',
          count: '1',
          announcement: [
            {
              registratedNumber: 'T1234567890123',
              process: '01',
              name: '検証商事',
              registrationDate: '2023-10-01',
              kind: '2',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const first = await runInvoiceRegistryCheck({
      registrationNumberRaw: 'T1234567890123',
      basisDateRaw: '2026-08-01',
      actor,
      applicationId: 'test-app-id-not-for-production',
      ntaApiBaseUrl: 'https://kensyo.invoice-kohyo.nta.go.jp',
      todayYmd: '2026-08-03',
      cacheStore,
      rateLimitStore,
      auditStore,
      fetchImpl,
      now: () => new Date('2026-08-03T01:00:00.000Z'),
    })

    assert.equal(first.httpStatus, 200)
    assert.equal(first.body.ok, true)
    if (first.body.ok) {
      assert.equal(first.body.data.status, 'active')
      assert.equal(first.body.data.cacheHit, false)
      assert.equal(first.body.data.name, '検証商事')
    }
    assert.equal(called, 1)
    assert.equal(JSON.stringify(first.body).includes('test-app-id'), false)

    const second = await runInvoiceRegistryCheck({
      registrationNumberRaw: 'T1234567890123',
      basisDateRaw: '2026-08-01',
      actor,
      applicationId: 'test-app-id-not-for-production',
      ntaApiBaseUrl: 'https://kensyo.invoice-kohyo.nta.go.jp',
      todayYmd: '2026-08-03',
      cacheStore,
      rateLimitStore,
      auditStore,
      fetchImpl,
      now: () => new Date('2026-08-03T01:05:00.000Z'),
    })

    assert.equal(second.body.ok, true)
    if (second.body.ok) {
      assert.equal(second.body.data.cacheHit, true)
    }
    assert.equal(called, 1)
    assert.equal(auditStore.entries.length, 2)
  })

  it('maps upstream statuses', async () => {
    const cases: Array<{ status: number; code: string }> = [
      { status: 403, code: 'NTA_ACCESS_RESTRICTED' },
      { status: 404, code: 'NTA_CONFIGURATION_ERROR' },
      { status: 500, code: 'NTA_UNAVAILABLE' },
      { status: 400, code: 'NTA_INVALID_RESPONSE' },
    ]

    for (const item of cases) {
      const result = await runInvoiceRegistryCheck({
        registrationNumberRaw: 'T1234567890123',
        basisDateRaw: '2026-08-01',
        actor,
        applicationId: 'test-app-id',
        todayYmd: '2026-08-03',
        cacheStore: new MemoryInvoiceCacheStore(),
        rateLimitStore: new MemoryRateLimitStore(),
        auditStore: new MemoryInvoiceAuditStore(),
        fetchImpl: async () => new Response('nope', { status: item.status }),
      })
      assert.equal(result.body.ok, false)
      if (!result.body.ok) {
        assert.equal(result.body.error.code, item.code)
        assert.equal(JSON.stringify(result.body).includes('test-app-id'), false)
      }
    }
  })

  it('handles timeout', async () => {
    const result = await runInvoiceRegistryCheck({
      registrationNumberRaw: 'T1234567890123',
      basisDateRaw: '2026-08-01',
      actor,
      applicationId: 'test-app-id',
      todayYmd: '2026-08-03',
      cacheStore: new MemoryInvoiceCacheStore(),
      rateLimitStore: new MemoryRateLimitStore(),
      auditStore: new MemoryInvoiceAuditStore(),
      fetchImpl: async (_input, init) =>
        new Promise((_resolve, reject) => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          const signal = init?.signal
          if (signal?.aborted) {
            reject(err)
            return
          }
          signal?.addEventListener('abort', () => reject(err))
        }),
    })
    assert.equal(result.body.ok, false)
    if (!result.body.ok) assert.equal(result.body.error.code, 'NTA_TIMEOUT')
  })

  it('handles invalid JSON', async () => {
    const result = await runInvoiceRegistryCheck({
      registrationNumberRaw: 'T1234567890123',
      basisDateRaw: '2026-08-01',
      actor,
      applicationId: 'test-app-id',
      todayYmd: '2026-08-03',
      cacheStore: new MemoryInvoiceCacheStore(),
      rateLimitStore: new MemoryRateLimitStore(),
      auditStore: new MemoryInvoiceAuditStore(),
      fetchImpl: async () =>
        new Response('{not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    assert.equal(result.body.ok, false)
    if (!result.body.ok) assert.equal(result.body.error.code, 'NTA_INVALID_RESPONSE')
  })

  it('sets User-Agent on upstream request', async () => {
    let seenUa = ''
    await runInvoiceRegistryCheck({
      registrationNumberRaw: 'T1234567890123',
      basisDateRaw: '2026-08-01',
      actor,
      applicationId: 'test-app-id',
      todayYmd: '2026-08-03',
      cacheStore: new MemoryInvoiceCacheStore(),
      rateLimitStore: new MemoryRateLimitStore(),
      auditStore: new MemoryInvoiceAuditStore(),
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers)
        seenUa = headers.get('User-Agent') ?? ''
        return new Response(JSON.stringify({ count: '0', announcement: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    assert.equal(seenUa, NTA_USER_AGENT)
  })

  it('records audit with actor franchiseeId even if caller wanted another tenant', async () => {
    const auditStore = new MemoryInvoiceAuditStore()
    await runInvoiceRegistryCheck({
      registrationNumberRaw: 'T1234567890123',
      basisDateRaw: '2026-08-01',
      actor: { ...actor, franchiseeId: 'fc-from-token' },
      applicationId: 'test-app-id',
      todayYmd: '2026-08-03',
      cacheStore: new MemoryInvoiceCacheStore(),
      rateLimitStore: new MemoryRateLimitStore(),
      auditStore,
      fetchImpl: async () =>
        new Response(JSON.stringify({ count: '0', announcement: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    assert.equal(auditStore.entries.length, 1)
    assert.equal(auditStore.entries[0]?.tenantId, 'fc-from-token')
  })
})

describe('POST /api/invoice-registry/check auth gate', () => {
  const env = {
    METER_DRIVER_TOKEN: 'test-meter-token',
    RESERVATION_V4_ORIGIN: 'https://reservation-v4.example.com',
    ALLOWED_ORIGIN: 'https://pages.example.com',
    ALLOWED_ORIGINS: 'https://pages.example.com',
    FIREBASE_PROJECT_ID: 'care-taxi-meter',
    NTA_APPLICATION_ID: 'test-app-id',
  }

  const ntaOkFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        count: '1',
        announcement: [
          {
            registratedNumber: 'T1234567890123',
            process: '01',
            name: 'テスト',
            registrationDate: '2023-01-01',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  it('returns 401 when unauthenticated', async () => {
    const { handleDriverProxyRequest } = await import('./index.ts')
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/invoice-registry/check', {
        method: 'POST',
        headers: {
          Origin: 'https://pages.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ registrationNumber: 'T1234567890123', basisDate: '2026-08-01' }),
      }),
      env,
      ntaOkFetch,
    )
    assert.equal(response.status, 401)
    const body = (await response.json()) as { ok: boolean; error?: { code: string } }
    assert.equal(body.ok, false)
    assert.equal(body.error?.code, 'UNAUTHENTICATED')
  })

  it('returns 403 for manager (no accounting UI permission)', async () => {
    const { handleDriverProxyRequest } = await import('./index.ts')
    const { verifyFirebaseIdToken } = await import('./ntaInvoiceAuth.ts')
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/invoice-registry/check', {
        method: 'POST',
        headers: {
          Origin: 'https://pages.example.com',
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ registrationNumber: 'T1234567890123', basisDate: '2026-08-01' }),
      }),
      env,
      ntaOkFetch,
      {
        verifyAuth: async () =>
          verifyFirebaseIdToken({
            idToken: [
              Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
              Buffer.from(
                JSON.stringify({
                  iss: 'https://securetoken.google.com/care-taxi-meter',
                  aud: 'care-taxi-meter',
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  sub: 'uid-m',
                  role: 'manager',
                  franchiseeId: 'fc-1',
                  storeId: 's1',
                  staffId: 'st-m',
                }),
              ).toString('base64url'),
              'sig',
            ].join('.'),
            projectId: 'care-taxi-meter',
            unsafeDecodeOnly: true,
          }),
      },
    )
    assert.equal(response.status, 403)
    const body = (await response.json()) as { ok: boolean; error?: { code: string } }
    assert.equal(body.ok, false)
    assert.equal(body.error?.code, 'FORBIDDEN')
  })

  it('allows FC加盟店 owner and ignores forged franchiseeId in body', async () => {
    const { handleDriverProxyRequest } = await import('./index.ts')
    const { verifyFirebaseIdToken } = await import('./ntaInvoiceAuth.ts')

    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/invoice-registry/check', {
        method: 'POST',
        headers: {
          Origin: 'https://pages.example.com',
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          registrationNumber: 'T1234567890123',
          basisDate: '2026-08-01',
          franchiseeId: 'forged-other-fc',
          tenantId: 'forged-tenant',
        }),
      }),
      env,
      ntaOkFetch,
      {
        verifyAuth: async () =>
          verifyFirebaseIdToken({
            idToken: [
              Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
              Buffer.from(
                JSON.stringify({
                  iss: 'https://securetoken.google.com/care-taxi-meter',
                  aud: 'care-taxi-meter',
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  sub: 'uid-owner',
                  role: 'owner',
                  franchiseeId: 'fc-from-token',
                  storeId: 's1',
                  staffId: 'st-owner',
                }),
              ).toString('base64url'),
              'sig',
            ].join('.'),
            projectId: 'care-taxi-meter',
            unsafeDecodeOnly: true,
          }),
      },
    )
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      ok: boolean
      data?: { registrationNumber: string }
    }
    assert.equal(body.ok, true)
    assert.equal(body.data?.registrationNumber, 'T1234567890123')
    assert.equal(JSON.stringify(body).includes('forged-other-fc'), false)
    assert.equal(JSON.stringify(body).includes('test-app-id'), false)
  })

  it('allows hq_admin', async () => {
    const { handleDriverProxyRequest } = await import('./index.ts')
    const { verifyFirebaseIdToken } = await import('./ntaInvoiceAuth.ts')
    const response = await handleDriverProxyRequest(
      new Request('https://proxy.example.com/api/invoice-registry/check', {
        method: 'POST',
        headers: {
          Origin: 'https://pages.example.com',
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          registrationNumber: 'T1234567890123',
          basisDate: '2026-08-01',
        }),
      }),
      env,
      ntaOkFetch,
      {
        verifyAuth: async () =>
          verifyFirebaseIdToken({
            idToken: [
              Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
              Buffer.from(
                JSON.stringify({
                  iss: 'https://securetoken.google.com/care-taxi-meter',
                  aud: 'care-taxi-meter',
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  sub: 'uid-hq',
                  role: 'hq_admin',
                  franchiseeId: 'hq',
                  storeId: 'hq-s',
                  staffId: 'hq-1',
                }),
              ).toString('base64url'),
              'sig',
            ].join('.'),
            projectId: 'care-taxi-meter',
            unsafeDecodeOnly: true,
          }),
      },
    )
    assert.equal(response.status, 200)
    const body = (await response.json()) as { ok: boolean }
    assert.equal(body.ok, true)
  })
})
