import type {
  InvoiceRegistryCheckData,
  InvoiceRegistryCheckResponse,
  NtaApiType,
} from './ntaTypes.ts'
import {
  buildExpiresAt,
  parseCachedCheckData,
  type InvoiceCacheStore,
} from './ntaInvoiceCache.ts'
import {
  fetchNtaInvoiceRegistry,
  isNtaVerificationEnvironment,
  resolveNtaApiBaseUrl,
} from './ntaInvoiceClient.ts'
import {
  buildCacheKey,
  INVOICE_REGISTRATION_NUMBER_ERROR,
  normalizeBasisDate,
  normalizeInvoiceRegistrationNumber,
} from './ntaInvoiceNormalize.ts'
import { buildUserRateLimitKey, type RateLimitStore } from './ntaInvoiceRateLimit.ts'
import { determineInvoiceRegistryStatus } from './ntaInvoiceStatus.ts'
import type { InvoiceAuthActor } from './ntaInvoiceAuth.ts'

export type InvoiceAuditStore = {
  append(entry: {
    id: string
    tenantId: string
    userId: string
    registrationNumber: string
    basisDate: string | null
    resultStatus: string
    cacheHit: boolean
    ntaLastUpdateDate: string | null
    createdAt: string
  }): Promise<void>
}

export class MemoryInvoiceAuditStore implements InvoiceAuditStore {
  readonly entries: Array<Parameters<InvoiceAuditStore['append']>[0]> = []

  async append(entry: Parameters<InvoiceAuditStore['append']>[0]): Promise<void> {
    this.entries.push(entry)
  }
}

export class D1InvoiceAuditStore implements InvoiceAuditStore {
  constructor(private readonly db: D1Database) {}

  async append(entry: Parameters<InvoiceAuditStore['append']>[0]): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO nta_invoice_lookup_audit (
           id, tenant_id, user_id, registration_number, basis_date,
           result_status, cache_hit, nta_last_update_date, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        entry.tenantId,
        entry.userId,
        entry.registrationNumber,
        entry.basisDate,
        entry.resultStatus,
        entry.cacheHit ? 1 : 0,
        entry.ntaLastUpdateDate,
        entry.createdAt,
      )
      .run()
  }
}

export type RunInvoiceRegistryCheckInput = {
  registrationNumberRaw: unknown
  basisDateRaw?: unknown
  actor: InvoiceAuthActor
  applicationId: string
  ntaApiBaseUrl?: string | null
  todayYmd: string
  cacheStore: InvoiceCacheStore
  rateLimitStore: RateLimitStore
  auditStore: InvoiceAuditStore
  fetchImpl?: typeof fetch
  now?: () => Date
  requestId?: string
}

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `inv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const err = (
  code:
    | 'INVALID_INPUT'
    | 'RATE_LIMITED'
    | 'NTA_ACCESS_RESTRICTED'
    | 'NTA_CONFIGURATION_ERROR'
    | 'NTA_UNAVAILABLE'
    | 'NTA_TIMEOUT'
    | 'NTA_INVALID_RESPONSE'
    | 'INTERNAL_ERROR',
  message: string,
  retryable: boolean,
): InvoiceRegistryCheckResponse => ({
  ok: false,
  error: { code, message, retryable },
})

export const runInvoiceRegistryCheck = async (
  input: RunInvoiceRegistryCheckInput,
): Promise<{
  httpStatus: number
  body: InvoiceRegistryCheckResponse
  meta: {
    requestId: string
    cacheHit: boolean
    upstreamStatus?: number
    durationMs: number
    apiType?: NtaApiType
    verificationEnv: boolean
    registrationNumber?: string
    basisDate?: string | null
    userId: string
    tenantId: string
    errorCode?: string
  }
}> => {
  const started = Date.now()
  const requestId = input.requestId ?? createId()
  const now = input.now ?? (() => new Date())
  const checkedAt = now().toISOString()
  const resolvedBase = resolveNtaApiBaseUrl(input.ntaApiBaseUrl)
  const verificationEnv = isNtaVerificationEnvironment(resolvedBase)

  const baseMeta = {
    requestId,
    userId: input.actor.userId,
    tenantId: input.actor.franchiseeId,
    verificationEnv,
  }

  const registrationNumber = normalizeInvoiceRegistrationNumber(input.registrationNumberRaw)
  if (!registrationNumber) {
    return {
      httpStatus: 400,
      body: err('INVALID_INPUT', INVOICE_REGISTRATION_NUMBER_ERROR, false),
      meta: {
        ...baseMeta,
        cacheHit: false,
        durationMs: Date.now() - started,
        errorCode: 'INVALID_INPUT',
      },
    }
  }

  const basis = normalizeBasisDate(input.basisDateRaw, {
    todayYmd: input.todayYmd,
    allowEmpty: true,
  })
  if (!basis.ok) {
    return {
      httpStatus: 400,
      body: err('INVALID_INPUT', basis.message, false),
      meta: {
        ...baseMeta,
        cacheHit: false,
        durationMs: Date.now() - started,
        registrationNumber,
        errorCode: 'INVALID_INPUT',
      },
    }
  }

  const rate = await input.rateLimitStore.consume(
    buildUserRateLimitKey(input.actor.userId),
    now().getTime(),
  )
  if (!rate.allowed) {
    return {
      httpStatus: 429,
      body: err(
        'RATE_LIMITED',
        '照会回数の上限に達しました。10分ほど待ってから再度お試しください。',
        true,
      ),
      meta: {
        ...baseMeta,
        cacheHit: false,
        durationMs: Date.now() - started,
        registrationNumber,
        basisDate: basis.date,
        errorCode: 'RATE_LIMITED',
      },
    }
  }

  if (!input.applicationId.trim()) {
    return {
      httpStatus: 503,
      body: err(
        'NTA_CONFIGURATION_ERROR',
        '国税庁APIの設定を確認できませんでした。管理者へお問い合わせください。',
        false,
      ),
      meta: {
        ...baseMeta,
        cacheHit: false,
        durationMs: Date.now() - started,
        registrationNumber,
        basisDate: basis.date,
        errorCode: 'NTA_CONFIGURATION_ERROR',
      },
    }
  }

  const apiType: NtaApiType = basis.date ? 'valid' : 'num'
  const cacheKey = buildCacheKey(apiType, registrationNumber, basis.date)
  const cached = await input.cacheStore.get(cacheKey, checkedAt)
  if (cached) {
    const data = parseCachedCheckData(cached, checkedAt)
    if (data) {
      try {
        await input.auditStore.append({
          id: createId(),
          tenantId: input.actor.franchiseeId,
          userId: input.actor.userId,
          registrationNumber,
          basisDate: basis.date,
          resultStatus: data.status,
          cacheHit: true,
          ntaLastUpdateDate: data.ntaLastUpdateDate,
          createdAt: checkedAt,
        })
      } catch {
        // audit failure must not block lookup
      }

      return {
        httpStatus: 200,
        body: { ok: true, data },
        meta: {
          ...baseMeta,
          cacheHit: true,
          durationMs: Date.now() - started,
          apiType,
          registrationNumber,
          basisDate: basis.date,
        },
      }
    }
  }

  const ntaResult = await fetchNtaInvoiceRegistry({
    applicationId: input.applicationId,
    registrationNumber,
    basisDate: basis.date,
    baseUrl: resolvedBase,
    fetchImpl: input.fetchImpl,
  })

  if (!ntaResult.ok) {
    const httpStatus =
      ntaResult.code === 'NTA_ACCESS_RESTRICTED'
        ? 403
        : ntaResult.code === 'NTA_TIMEOUT'
          ? 504
          : 502

    return {
      httpStatus,
      body: err(ntaResult.code, ntaResult.message, ntaResult.retryable),
      meta: {
        ...baseMeta,
        cacheHit: false,
        upstreamStatus: ntaResult.upstreamStatus,
        durationMs: Date.now() - started,
        apiType,
        registrationNumber,
        basisDate: basis.date,
        errorCode: ntaResult.code,
      },
    }
  }

  const decision = determineInvoiceRegistryStatus(ntaResult.response, {
    basisDate: basis.date,
  })

  const data: InvoiceRegistryCheckData = {
    registrationNumber,
    basisDate: basis.date,
    status: decision.status,
    isQualifiedAtBasisDate: decision.isQualifiedAtBasisDate,
    name: decision.name,
    tradeName: decision.tradeName,
    address: decision.address,
    kind: decision.kind,
    registrationDate: decision.registrationDate,
    expirationDate: decision.expirationDate,
    cancellationDate: decision.cancellationDate,
    ntaLastUpdateDate: decision.ntaLastUpdateDate,
    checkedAt,
    cacheHit: false,
  }

  try {
    await input.cacheStore.put({
      cacheKey,
      registrationNumber,
      basisDate: basis.date,
      apiType,
      status: data.status,
      responseJson: JSON.stringify({ ...data, cacheHit: false }),
      ntaLastUpdateDate: data.ntaLastUpdateDate,
      fetchedAt: checkedAt,
      expiresAt: buildExpiresAt(checkedAt),
    })
  } catch {
    // cache write failure must not block lookup
  }

  try {
    await input.auditStore.append({
      id: createId(),
      tenantId: input.actor.franchiseeId,
      userId: input.actor.userId,
      registrationNumber,
      basisDate: basis.date,
      resultStatus: data.status,
      cacheHit: false,
      ntaLastUpdateDate: data.ntaLastUpdateDate,
      createdAt: checkedAt,
    })
  } catch {
    // audit failure must not block lookup
  }

  return {
    httpStatus: 200,
    body: { ok: true, data },
    meta: {
      ...baseMeta,
      cacheHit: false,
      upstreamStatus: ntaResult.upstreamStatus,
      durationMs: Date.now() - started,
      apiType,
      registrationNumber,
      basisDate: basis.date,
    },
  }
}
