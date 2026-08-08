import {
  TIMESTAMP_PROVIDER_NOT_CONFIGURED,
  TIMESTAMP_PROVIDER_UNCONFIGURED_ID,
  type TimestampIssueResult,
} from '../services/accountingTimestamp/types'

/** サーバー側 Secrets のキー（クライアントには置かない） */
export const ACCOUNTING_TIMESTAMP_ENV_KEYS = [
  'ACCOUNTING_TIMESTAMP_PROVIDER',
  'ACCOUNTING_TIMESTAMP_TSA_URL',
  'ACCOUNTING_TIMESTAMP_API_KEY',
] as const

export type TimestampEnvConfig = {
  provider?: string
  tsaUrl?: string
  apiKey?: string
}

/**
 * 環境変数が揃っているか（実 TSA 接続可能か）を判定する。
 * いずれか欠けていれば unconfigured 扱い。ダミー発行はしない。
 */
export function isTimestampProviderConfiguredFromEnv(
  config: TimestampEnvConfig,
): boolean {
  const providerName = (config.provider ?? '').trim().toLowerCase()
  const tsaUrl = (config.tsaUrl ?? '').trim()
  const apiKey = (config.apiKey ?? '').trim()
  if (!providerName || providerName === TIMESTAMP_PROVIDER_UNCONFIGURED_ID) {
    return false
  }
  return Boolean(tsaUrl && apiKey)
}

/** 未設定 provider が返す issue 結果（サーバー UnconfiguredTimestampProvider と同型） */
export function buildUnconfiguredTimestampIssueResult(): TimestampIssueResult {
  return {
    ok: false,
    configured: false,
    provider: TIMESTAMP_PROVIDER_UNCONFIGURED_ID,
    code: TIMESTAMP_PROVIDER_NOT_CONFIGURED,
    message:
      '認定タイムスタンプサービスが未設定です。正式スキャナ保存は完了していません。紙原本を保管してください。',
  }
}

/** ok:true かつ configured:true のみ「発行成功」。未設定は絶対に true にならない */
export function isSuccessfulTimestampIssue(
  result: Pick<TimestampIssueResult, 'ok' | 'configured'>,
): boolean {
  return result.ok === true && result.configured === true
}

/** タイムスタンプ発行成功後のみ legal_saved 系へ進められる */
export function canAdvanceLegalStatusAfterTimestampIssue(
  result: Pick<TimestampIssueResult, 'ok' | 'configured'>,
): boolean {
  return isSuccessfulTimestampIssue(result)
}
