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
  environment?: 'verification' | 'production'
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

export type InvoiceRegistryCheckResponse =
  | { ok: true; data: InvoiceRegistryCheckData }
  | {
      ok: false
      error: {
        code: InvoiceRegistryErrorCode
        message: string
        retryable: boolean
      }
    }

export const INVOICE_REGISTRY_STATUS_LABELS: Record<InvoiceRegistryStatus, string> = {
  active: '登録有効',
  expired: '登録失効',
  cancelled: '登録取消',
  not_found: '登録情報なし',
  unknown: '状態を判定できません',
}

export const INVOICE_REGISTRY_DISCLAIMER =
  'このサービスは、国税庁の適格請求書発行事業者公表システムWeb-APIで取得した情報を利用しています。内容を国税庁が保証するものではありません。'

export const INVOICE_REGISTRY_TAX_NOTE =
  '税務上の最終判断は、請求書・領収書の記載内容および最新の公表情報をご確認ください。'

export const INVOICE_REGISTRY_VENDOR_MISMATCH_WARNING =
  '入力された取引先名と、国税庁の公表名称が異なります。内容をご確認ください。'
