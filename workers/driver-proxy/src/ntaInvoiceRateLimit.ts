import {
  NTA_RATE_LIMIT_MAX,
  NTA_RATE_LIMIT_WINDOW_MS,
} from './ntaTypes.ts'

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryable: true; remaining: 0 }

export type RateLimitStore = {
  consume(bucketKey: string, nowMs: number): Promise<RateLimitResult>
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, { windowStartedAt: number; hitCount: number }>()

  async consume(bucketKey: string, nowMs: number): Promise<RateLimitResult> {
    const current = this.map.get(bucketKey)
    if (!current || nowMs - current.windowStartedAt >= NTA_RATE_LIMIT_WINDOW_MS) {
      this.map.set(bucketKey, { windowStartedAt: nowMs, hitCount: 1 })
      return { allowed: true, remaining: NTA_RATE_LIMIT_MAX - 1 }
    }

    if (current.hitCount >= NTA_RATE_LIMIT_MAX) {
      return { allowed: false, retryable: true, remaining: 0 }
    }

    current.hitCount += 1
    this.map.set(bucketKey, current)
    return { allowed: true, remaining: NTA_RATE_LIMIT_MAX - current.hitCount }
  }

  clear() {
    this.map.clear()
  }
}

export class D1RateLimitStore implements RateLimitStore {
  constructor(private readonly db: D1Database) {}

  async consume(bucketKey: string, nowMs: number): Promise<RateLimitResult> {
    const nowIso = new Date(nowMs).toISOString()
    const row = await this.db
      .prepare(
        `SELECT bucket_key, hit_count, window_started_at
         FROM nta_invoice_rate_limit WHERE bucket_key = ?`,
      )
      .bind(bucketKey)
      .first<{ bucket_key: string; hit_count: number; window_started_at: string }>()

    const windowStartedMs = row ? Date.parse(row.window_started_at) : NaN
    const windowExpired =
      !row || !Number.isFinite(windowStartedMs) || nowMs - windowStartedMs >= NTA_RATE_LIMIT_WINDOW_MS

    if (windowExpired) {
      await this.db
        .prepare(
          `INSERT INTO nta_invoice_rate_limit (bucket_key, hit_count, window_started_at, updated_at)
           VALUES (?, 1, ?, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET
             hit_count = 1,
             window_started_at = excluded.window_started_at,
             updated_at = excluded.updated_at`,
        )
        .bind(bucketKey, nowIso, nowIso)
        .run()
      return { allowed: true, remaining: NTA_RATE_LIMIT_MAX - 1 }
    }

    if (row.hit_count >= NTA_RATE_LIMIT_MAX) {
      return { allowed: false, retryable: true, remaining: 0 }
    }

    await this.db
      .prepare(
        `UPDATE nta_invoice_rate_limit
         SET hit_count = hit_count + 1, updated_at = ?
         WHERE bucket_key = ?`,
      )
      .bind(nowIso, bucketKey)
      .run()

    return { allowed: true, remaining: NTA_RATE_LIMIT_MAX - (row.hit_count + 1) }
  }
}

export const buildUserRateLimitKey = (userId: string): string => `user:${userId}`
