/**
 * サーバー側タイムスタンプ provider 抽象。
 * Secrets は process.env のみ（VITE_ 禁止）。
 *
 * 未設定時は絶対にダミー発行しない。
 */

export type TimestampIssueRequest = {
  receiptId: string
  version: number
  fileHash: string
  legalMasterStoragePath: string
  franchiseeId: string
  storeId: string
}

export type TimestampIssueResponse =
  | {
      ok: true
      configured: true
      provider: string
      tokenId: string
      algorithm: string
      timestampedAt: string
      tokenBase64: string
    }
  | {
      ok: false
      configured: boolean
      provider: string
      code: string
      message: string
    }

export type TimestampVerifyRequest = {
  receiptId: string
  version: number
  fileHash: string
  tokenBase64: string
  provider: string
}

export type TimestampVerifyResponse =
  | {
      ok: true
      verifiedAt: string
      provider: string
      fileHashMatches: true
    }
  | {
      ok: false
      verifiedAt: string
      provider: string
      code: string
      message: string
      fileHashMatches?: boolean
    }

export interface ServerTimestampProvider {
  readonly providerId: string
  isConfigured(): boolean
  issue(input: TimestampIssueRequest): Promise<TimestampIssueResponse>
  verify(input: TimestampVerifyRequest): Promise<TimestampVerifyResponse>
}

const NOT_CONFIGURED = 'TIMESTAMP_PROVIDER_NOT_CONFIGURED'

class UnconfiguredTimestampProvider implements ServerTimestampProvider {
  readonly providerId = 'unconfigured'

  isConfigured() {
    return false
  }

  async issue(_input: TimestampIssueRequest): Promise<TimestampIssueResponse> {
    return {
      ok: false,
      configured: false,
      provider: this.providerId,
      code: NOT_CONFIGURED,
      message:
        '認定タイムスタンプサービスが未設定です。正式スキャナ保存は完了していません。紙原本を保管してください。',
    }
  }

  async verify(_input: TimestampVerifyRequest): Promise<TimestampVerifyResponse> {
    return {
      ok: false,
      verifiedAt: new Date().toISOString(),
      provider: this.providerId,
      code: NOT_CONFIGURED,
      message: '認定タイムスタンプサービスが未設定のため検証できません。',
      fileHashMatches: false,
    }
  }
}

/**
 * 将来: ACCOUNTING_TIMESTAMP_PROVIDER=rfc3161 等と
 * ACCOUNTING_TIMESTAMP_TSA_URL / ACCOUNTING_TIMESTAMP_API_KEY を読んで実装を差し替える。
 */
export function resolveServerTimestampProvider(): ServerTimestampProvider {
  const providerName = (process.env.ACCOUNTING_TIMESTAMP_PROVIDER || '').trim().toLowerCase()
  const tsaUrl = (process.env.ACCOUNTING_TIMESTAMP_TSA_URL || '').trim()
  const apiKey = (process.env.ACCOUNTING_TIMESTAMP_API_KEY || '').trim()

  // 実契約・接続情報が揃っていない限り Unconfigured のまま（ダミー発行禁止）
  if (!providerName || providerName === 'unconfigured' || !tsaUrl || !apiKey) {
    return new UnconfiguredTimestampProvider()
  }

  // 特定事業者実装は契約後に追加。現状は未接続として扱う。
  return new UnconfiguredTimestampProvider()
}
