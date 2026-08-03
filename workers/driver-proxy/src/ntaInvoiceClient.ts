import {
  NTA_FETCH_TIMEOUT_MS,
  NTA_PRODUCTION_BASE_URL,
  NTA_USER_AGENT,
  type InvoiceRegistryErrorCode,
  type NtaApiType,
  type NtaInvoiceResponse,
} from './ntaTypes.ts'

export type NtaClientError = {
  ok: false
  code: InvoiceRegistryErrorCode
  message: string
  retryable: boolean
  upstreamStatus?: number
}

export type NtaClientSuccess = {
  ok: true
  apiType: NtaApiType
  response: NtaInvoiceResponse
  upstreamStatus: number
}

export type NtaClientResult = NtaClientSuccess | NtaClientError

const mapUpstreamStatus = (status: number): NtaClientError => {
  if (status === 400) {
    return {
      ok: false,
      code: 'NTA_INVALID_RESPONSE',
      message: '国税庁APIの応答を解釈できませんでした。入力内容をご確認ください。',
      retryable: false,
      upstreamStatus: status,
    }
  }
  if (status === 403) {
    return {
      ok: false,
      code: 'NTA_ACCESS_RESTRICTED',
      message:
        '国税庁の照会サービスが一時的に利用制限されています。10秒以上待ってから、もう一度お試しください。',
      retryable: true,
      upstreamStatus: status,
    }
  }
  if (status === 404) {
    return {
      ok: false,
      code: 'NTA_CONFIGURATION_ERROR',
      message: '国税庁APIの設定を確認できませんでした。管理者へお問い合わせください。',
      retryable: false,
      upstreamStatus: status,
    }
  }
  if (status >= 500) {
    return {
      ok: false,
      code: 'NTA_UNAVAILABLE',
      message: '国税庁の照会サービスに接続できませんでした。しばらくしてから再度お試しください。',
      retryable: true,
      upstreamStatus: status,
    }
  }
  return {
    ok: false,
    code: 'NTA_UNAVAILABLE',
    message: '国税庁の照会サービスに接続できませんでした。しばらくしてから再度お試しください。',
    retryable: true,
    upstreamStatus: status,
  }
}

export const resolveNtaApiBaseUrl = (configured?: string | null): string => {
  const trimmed = (configured ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    return NTA_PRODUCTION_BASE_URL
  }
  return trimmed
}

export const isNtaVerificationEnvironment = (baseUrl: string): boolean =>
  baseUrl.includes('kensyo.invoice-kohyo.nta.go.jp')

/**
 * 国税庁 API を呼び出す。URL は URL / URLSearchParams で構築し、完全 URL はログに出さない。
 */
export const fetchNtaInvoiceRegistry = async ({
  applicationId,
  registrationNumber,
  basisDate,
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = NTA_FETCH_TIMEOUT_MS,
}: {
  applicationId: string
  registrationNumber: string
  basisDate?: string | null
  baseUrl?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<NtaClientResult> => {
  const origin = resolveNtaApiBaseUrl(baseUrl)
  const apiType: NtaApiType = basisDate ? 'valid' : 'num'
  const path = apiType === 'valid' ? '/1/valid' : '/1/num'
  const upstreamUrl = new URL(path, `${origin}/`)
  upstreamUrl.searchParams.set('id', applicationId)
  upstreamUrl.searchParams.set('number', registrationNumber)
  upstreamUrl.searchParams.set('type', '21')
  if (apiType === 'valid' && basisDate) {
    upstreamUrl.searchParams.set('day', basisDate)
  } else {
    upstreamUrl.searchParams.set('history', '0')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const upstreamResponse = await fetchImpl(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': NTA_USER_AGENT,
      },
      signal: controller.signal,
    })

    if (!upstreamResponse.ok) {
      return mapUpstreamStatus(upstreamResponse.status)
    }

    let payload: unknown
    try {
      payload = await upstreamResponse.json()
    } catch {
      return {
        ok: false,
        code: 'NTA_INVALID_RESPONSE',
        message: '国税庁APIの応答を解釈できませんでした。',
        retryable: false,
        upstreamStatus: upstreamResponse.status,
      }
    }

    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        code: 'NTA_INVALID_RESPONSE',
        message: '国税庁APIの応答を解釈できませんでした。',
        retryable: false,
        upstreamStatus: upstreamResponse.status,
      }
    }

    return {
      ok: true,
      apiType,
      response: payload as NtaInvoiceResponse,
      upstreamStatus: upstreamResponse.status,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        code: 'NTA_TIMEOUT',
        message: '国税庁APIへの接続がタイムアウトしました。しばらくしてから再度お試しください。',
        retryable: true,
      }
    }
    return {
      ok: false,
      code: 'NTA_UNAVAILABLE',
      message: '国税庁の照会サービスに接続できませんでした。しばらくしてから再度お試しください。',
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}
