import type { InvoiceRegistryCheckData, InvoiceRegistryStatus, NtaApiType } from './ntaTypes.ts'
import { NTA_CACHE_TTL_MS } from './ntaTypes.ts'

export type InvoiceCacheRecord = {
  cacheKey: string
  registrationNumber: string
  basisDate: string | null
  apiType: NtaApiType
  status: InvoiceRegistryStatus
  responseJson: string
  ntaLastUpdateDate: string | null
  fetchedAt: string
  expiresAt: string
}

export type InvoiceCacheStore = {
  get(cacheKey: string, nowIso: string): Promise<InvoiceCacheRecord | null>
  put(record: InvoiceCacheRecord): Promise<void>
}

/** テスト・D1未バインド時用のメモリキャッシュ */
export class MemoryInvoiceCacheStore implements InvoiceCacheStore {
  private readonly map = new Map<string, InvoiceCacheRecord>()

  async get(cacheKey: string, nowIso: string): Promise<InvoiceCacheRecord | null> {
    const row = this.map.get(cacheKey)
    if (!row) return null
    if (row.expiresAt <= nowIso) {
      this.map.delete(cacheKey)
      return null
    }
    return row
  }

  async put(record: InvoiceCacheRecord): Promise<void> {
    this.map.set(record.cacheKey, record)
  }

  clear() {
    this.map.clear()
  }
}

export class D1InvoiceCacheStore implements InvoiceCacheStore {
  constructor(private readonly db: D1Database) {}

  async get(cacheKey: string, nowIso: string): Promise<InvoiceCacheRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT cache_key, registration_number, basis_date, api_type, status, response_json,
                nta_last_update_date, fetched_at, expires_at
         FROM nta_invoice_registry_cache
         WHERE cache_key = ? AND expires_at > ?`,
      )
      .bind(cacheKey, nowIso)
      .first<{
        cache_key: string
        registration_number: string
        basis_date: string | null
        api_type: string
        status: string
        response_json: string
        nta_last_update_date: string | null
        fetched_at: string
        expires_at: string
      }>()

    if (!row) return null

    return {
      cacheKey: row.cache_key,
      registrationNumber: row.registration_number,
      basisDate: row.basis_date,
      apiType: row.api_type === 'valid' ? 'valid' : 'num',
      status: row.status as InvoiceRegistryStatus,
      responseJson: row.response_json,
      ntaLastUpdateDate: row.nta_last_update_date,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    }
  }

  async put(record: InvoiceCacheRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO nta_invoice_registry_cache (
           cache_key, registration_number, basis_date, api_type, status, response_json,
           nta_last_update_date, fetched_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           registration_number = excluded.registration_number,
           basis_date = excluded.basis_date,
           api_type = excluded.api_type,
           status = excluded.status,
           response_json = excluded.response_json,
           nta_last_update_date = excluded.nta_last_update_date,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
      )
      .bind(
        record.cacheKey,
        record.registrationNumber,
        record.basisDate,
        record.apiType,
        record.status,
        record.responseJson,
        record.ntaLastUpdateDate,
        record.fetchedAt,
        record.expiresAt,
      )
      .run()
  }
}

export const buildExpiresAt = (fetchedAtIso: string, ttlMs = NTA_CACHE_TTL_MS): string =>
  new Date(new Date(fetchedAtIso).getTime() + ttlMs).toISOString()

export const parseCachedCheckData = (
  record: InvoiceCacheRecord,
  checkedAt: string,
): InvoiceRegistryCheckData | null => {
  try {
    const parsed = JSON.parse(record.responseJson) as InvoiceRegistryCheckData
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return {
      ...parsed,
      cacheHit: true,
      checkedAt,
    }
  } catch {
    return null
  }
}
