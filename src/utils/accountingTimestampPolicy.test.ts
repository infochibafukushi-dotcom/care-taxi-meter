import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_TIMESTAMP_ENV_KEYS,
  buildUnconfiguredTimestampIssueResult,
  canAdvanceLegalStatusAfterTimestampIssue,
  isSuccessfulTimestampIssue,
  isTimestampProviderConfiguredFromEnv,
} from './accountingTimestampPolicy'
import { TIMESTAMP_PROVIDER_NOT_CONFIGURED } from '../services/accountingTimestamp/types'

describe('accountingTimestampPolicy', () => {
  it('lists server-only env keys', () => {
    expect(ACCOUNTING_TIMESTAMP_ENV_KEYS).toEqual([
      'ACCOUNTING_TIMESTAMP_PROVIDER',
      'ACCOUNTING_TIMESTAMP_TSA_URL',
      'ACCOUNTING_TIMESTAMP_API_KEY',
    ])
  })

  it('treats missing or unconfigured provider env as not configured', () => {
    expect(isTimestampProviderConfiguredFromEnv({})).toBe(false)
    expect(
      isTimestampProviderConfiguredFromEnv({
        provider: 'unconfigured',
        tsaUrl: 'https://tsa.example',
        apiKey: 'key',
      }),
    ).toBe(false)
    expect(
      isTimestampProviderConfiguredFromEnv({
        provider: 'rfc3161',
        tsaUrl: '',
        apiKey: 'key',
      }),
    ).toBe(false)
    expect(
      isTimestampProviderConfiguredFromEnv({
        provider: 'rfc3161',
        tsaUrl: 'https://tsa.example',
        apiKey: '',
      }),
    ).toBe(false)
  })

  it('requires provider name, tsa url, and api key together', () => {
    expect(
      isTimestampProviderConfiguredFromEnv({
        provider: 'rfc3161',
        tsaUrl: 'https://tsa.example',
        apiKey: 'secret',
      }),
    ).toBe(true)
  })

  it('unconfigured issue result never returns ok:true', () => {
    const result = buildUnconfiguredTimestampIssueResult()
    expect(result.ok).toBe(false)
    expect(result.configured).toBe(false)
    expect(result.code).toBe(TIMESTAMP_PROVIDER_NOT_CONFIGURED)
    expect(isSuccessfulTimestampIssue(result)).toBe(false)
    expect(canAdvanceLegalStatusAfterTimestampIssue(result)).toBe(false)
  })

  it('only ok:true and configured:true counts as successful issue', () => {
    expect(isSuccessfulTimestampIssue({ ok: true, configured: true })).toBe(true)
    expect(isSuccessfulTimestampIssue({ ok: true, configured: false })).toBe(false)
    expect(isSuccessfulTimestampIssue({ ok: false, configured: true })).toBe(false)
    expect(isSuccessfulTimestampIssue({ ok: false, configured: false })).toBe(false)
  })
})
