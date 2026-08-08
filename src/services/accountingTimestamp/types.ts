/**
 * 認定タイムスタンプ事業者との接続抽象。
 * 秘密鍵・APIキーはクライアントに置かず、サーバー実装のみが実APIを呼ぶ。
 */

export type TimestampIssueInput = {
  receiptId: string
  version: number
  fileHash: string
  /** master の Storage path（サーバーが再取得して検証する場合に使用） */
  legalMasterStoragePath: string
  franchiseeId: string
  storeId: string
}

export type TimestampIssueResult =
  | {
      ok: true
      configured: true
      provider: string
      tokenId: string
      algorithm: string
      timestampedAt: string
      /** RFC3161 等のトークンバイト（Base64） */
      tokenBase64: string
    }
  | {
      ok: false
      configured: boolean
      provider: string
      code: string
      message: string
    }

export type TimestampVerifyInput = {
  receiptId: string
  version: number
  fileHash: string
  tokenBase64: string
  provider: string
  legalMasterStoragePath?: string
}

export type TimestampVerifyResult =
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

export interface AccountingTimestampProvider {
  readonly providerId: string
  isConfigured(): boolean
  issueTimestamp(input: TimestampIssueInput): Promise<TimestampIssueResult>
  verifyTimestamp(input: TimestampVerifyInput): Promise<TimestampVerifyResult>
}

export const TIMESTAMP_PROVIDER_NOT_CONFIGURED = 'TIMESTAMP_PROVIDER_NOT_CONFIGURED'
export const TIMESTAMP_PROVIDER_UNCONFIGURED_ID = 'unconfigured'
