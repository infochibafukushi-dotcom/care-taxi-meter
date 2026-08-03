/** 国税庁適格請求書発行事業者公表システム Web-API の announcement 要素 */
export type NtaInvoiceAnnouncement = {
  sequenceNumber?: string
  /** NTA 公式スペル（registrated） */
  registratedNumber?: string
  process?: string
  correct?: string
  kind?: string
  country?: string
  latest?: string
  registrationDate?: string
  updateDate?: string
  disposalDate?: string
  expireDate?: string
  address?: string
  addressPrefectureCode?: string
  addressCityCode?: string
  addressRequest?: string
  addressRequestPrefectureCode?: string
  addressRequestCityCode?: string
  kana?: string
  name?: string
  addressInside?: string
  addressInsidePrefectureCode?: string
  addressInsideCityCode?: string
  tradeName?: string
  popularName_previousName?: string
}

export type NtaInvoiceResponse = {
  lastUpdateDate?: string
  count?: string
  divideNumber?: string
  divideSize?: string
  announcement?: NtaInvoiceAnnouncement[]
}

export type InvoiceRegistryStatus =
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'not_found'
  | 'unknown'

export type InvoiceRegistryKind = 'individual' | 'corporation' | 'unknown'

export type InvoiceRegistryCheckData = {
  registrationNumber: string
  basisDate: string | null
  status: InvoiceRegistryStatus
  isQualifiedAtBasisDate: boolean
  name: string | null
  tradeName: string | null
  address: string | null
  kind: InvoiceRegistryKind
  registrationDate: string | null
  expirationDate: string | null
  cancellationDate: string | null
  ntaLastUpdateDate: string | null
  checkedAt: string
  cacheHit: boolean
}

export type InvoiceRegistryErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NTA_ACCESS_RESTRICTED'
  | 'NTA_CONFIGURATION_ERROR'
  | 'NTA_UNAVAILABLE'
  | 'NTA_TIMEOUT'
  | 'NTA_INVALID_RESPONSE'
  | 'INTERNAL_ERROR'

export type InvoiceRegistryCheckSuccess = {
  ok: true
  data: InvoiceRegistryCheckData
}

export type InvoiceRegistryCheckFailure = {
  ok: false
  error: {
    code: InvoiceRegistryErrorCode
    message: string
    retryable: boolean
  }
}

export type InvoiceRegistryCheckResponse =
  | InvoiceRegistryCheckSuccess
  | InvoiceRegistryCheckFailure

export type NtaApiType = 'valid' | 'num'

export const NTA_PRODUCTION_BASE_URL = 'https://web-api.invoice-kohyo.nta.go.jp'
export const NTA_VERIFICATION_BASE_URL = 'https://kensyo.invoice-kohyo.nta.go.jp'
export const NTA_USER_AGENT = 'chiba-fukushi-support-accounting/1.0'
export const NTA_FETCH_TIMEOUT_MS = 8_000
export const NTA_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const NTA_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const NTA_RATE_LIMIT_MAX = 30
