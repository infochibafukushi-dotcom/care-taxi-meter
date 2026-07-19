import type { InvoiceCheckStatus } from '../types/accounting'
import type {
  InvoiceRegistrantInfo,
  InvoiceRegistrantLookupResult,
} from '../types/invoiceRegistrant'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import {
  getCachedInvoiceRegistrant,
  setCachedInvoiceRegistrant,
} from '../utils/invoiceRegistrantCache'
import {
  INVOICE_LOOKUP_HISTORY_SAVE_FAILURE_MESSAGE,
  recordAccountingInvoiceLookupHistory,
  type InvoiceLookupAuditContext,
} from './accountingInvoiceLookupHistory'

export type { InvoiceLookupAuditContext }

type NtaAnnouncement = {
  registratedNumber?: string
  name?: string
  address?: string
  registrationDate?: string
  updateDate?: string
  disposalDate?: string
  expireDate?: string
  kind?: string
  process?: string
  tradeName?: string
}

type NtaInvoiceApiResponse = {
  announcement?: NtaAnnouncement[]
  count?: string | number
  lastUpdateDate?: string
  registrant?: InvoiceRegistrantInfo
  status?: string
  message?: string
}

const NTA_PROCESS_LABELS: Record<string, string> = {
  '01': '登録',
  '02': '取消',
  '03': '失効',
}

/** 開発確認用。本番では NTA API を優先し、失敗時のみ使用する。 */
export const INVOICE_REGISTRANT_FALLBACKS: Record<
  string,
  Omit<InvoiceRegistrantInfo, 'lookedUpAt' | 'lookupMethod' | 'source'>
> = {
  T4200001013662: {
    invoiceNumber: 'T4200001013662',
    corporateNumber: '4200001013662',
    registeredName: '株式会社セリア',
    address: '岐阜県大垣市今宿６丁目５２番地１８',
    registrationStatus: '登録',
    registrationDate: '2023-10-01',
  },
}

export const normalizeInvoiceRegistrationNumber = (value: string) => {
  const half = value
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^0-9T]/g, '')

  if (/^T\d{13}$/.test(half)) {
    return half
  }

  if (/^\d{13}$/.test(half)) {
    return `T${half}`
  }

  return ''
}

export const corporateNumberFromInvoiceNumber = (invoiceNumber: string) => {
  const normalized = normalizeInvoiceRegistrationNumber(invoiceNumber)
  return normalized.startsWith('T') ? normalized.slice(1) : ''
}

export const resolveInvoiceApiBaseUrl = () => {
  const explicit = (import.meta.env.VITE_INVOICE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (explicit) {
    return explicit
  }

  const configured = (import.meta.env.VITE_RESERVATION_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (configured) {
    return `${configured}/api/invoice`
  }

  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  return `${base}/api/invoice`
}

const resolveRegistrationStatus = (announcement: NtaAnnouncement) => {
  if (announcement.disposalDate) {
    return '取消'
  }

  if (announcement.expireDate) {
    return '失効'
  }

  const processLabel = announcement.process
    ? NTA_PROCESS_LABELS[announcement.process] ?? announcement.process
    : ''

  return processLabel || '登録'
}

const mapAnnouncementToRegistrant = (
  invoiceNumber: string,
  announcement: NtaAnnouncement,
  source: InvoiceRegistrantInfo['source'],
): InvoiceRegistrantInfo => ({
  invoiceNumber,
  corporateNumber: corporateNumberFromInvoiceNumber(invoiceNumber),
  registeredName: (announcement.name ?? '').trim(),
  tradeName: announcement.tradeName?.trim() || undefined,
  address: announcement.address?.trim() || undefined,
  registrationStatus: resolveRegistrationStatus(announcement),
  registrationDate: announcement.registrationDate || undefined,
  updateDate: announcement.updateDate || undefined,
  disposalDate: announcement.disposalDate || undefined,
  expireDate: announcement.expireDate || undefined,
  kind: announcement.kind || undefined,
  process: announcement.process || undefined,
  lookupMethod: 'インボイス番号検索',
  lookedUpAt: new Date().toISOString(),
  source,
})

const buildFallbackRegistrant = (invoiceNumber: string): InvoiceRegistrantInfo | null => {
  const entry = INVOICE_REGISTRANT_FALLBACKS[invoiceNumber]
  if (!entry) {
    return null
  }

  return {
    ...entry,
    lookupMethod: 'fallback',
    lookedUpAt: new Date().toISOString(),
    source: 'fallback',
  }
}

const explainHttpFailure = (status: number, payloadMessage?: string) => {
  const upstream = (payloadMessage ?? '').trim()
  if (
    status === 503 ||
    /NTA_INVOICE_API_ID|not configured|API is not configured/i.test(upstream)
  ) {
    return '登録事業者名取得失敗：API設定未完了（Worker の NTA_INVOICE_API_ID 未設定）'
  }

  if (status === 404) {
    return '登録事業者名取得失敗：登録情報が見つかりませんでした'
  }

  if (status === 0 || status >= 500) {
    return upstream
      ? `登録事業者名取得失敗：サーバーエラー（${status || 'network'}） ${upstream}`
      : `登録事業者名取得失敗：サーバーエラー（HTTP ${status || 'network'}）`
  }

  if (status === 401 || status === 403) {
    return '登録事業者名取得失敗：API認証エラー'
  }

  return upstream
    ? `登録事業者名取得失敗：${upstream}`
    : `登録事業者名取得失敗：HTTP ${status}`
}

const tryFallbackSuccess = (
  invoiceNumber: string,
  failureMessage: string,
): InvoiceRegistrantLookupResult => {
  const fallback = buildFallbackRegistrant(invoiceNumber)
  if (!fallback) {
    return {
      status: 'error',
      invoiceNumber,
      invoiceCheckStatus: '未確認',
      message: failureMessage,
    }
  }

  // フォールバックはキャッシュしない（本番 API 復旧時に即切替できるようにする）
  return {
    status: 'success',
    registrant: fallback,
    invoiceCheckStatus: '確認済',
    usedFallback: true,
    fallbackReason: failureMessage,
  }
}

async function lookupInvoiceRegistrantCore(
  invoiceNumberRaw: string,
): Promise<InvoiceRegistrantLookupResult> {
  const invoiceNumber = normalizeInvoiceRegistrationNumber(invoiceNumberRaw)

  if (!invoiceNumber) {
    return {
      status: 'skipped',
      invoiceCheckStatus: '未確認',
      message: 'インボイス番号が不正のため事業者検索をスキップしました。',
    }
  }

  const cached = getCachedInvoiceRegistrant(invoiceNumber)
  if (cached?.registeredName && cached.source !== 'fallback') {
    return {
      status: 'success',
      registrant: { ...cached, source: 'cache', lookupMethod: cached.lookupMethod || 'インボイス番号検索' },
      invoiceCheckStatus: '確認済',
    }
  }

  if (isReviewDemoRuntimeEnabled()) {
    const demo = buildFallbackRegistrant(invoiceNumber)
    if (demo) {
      return {
        status: 'success',
        registrant: { ...demo, source: 'fallback', lookupMethod: 'fallback' },
        invoiceCheckStatus: '確認済',
        usedFallback: true,
        fallbackReason: 'レビューデモモードのためフォールバックを使用しました。',
      }
    }
  }

  try {
    const url = `${resolveInvoiceApiBaseUrl()}/registrant?number=${encodeURIComponent(invoiceNumber)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    let payload: NtaInvoiceApiResponse = {}
    try {
      payload = (await response.json()) as NtaInvoiceApiResponse
    } catch {
      payload = {}
    }

    if (!response.ok) {
      const failureMessage = explainHttpFailure(response.status, payload.message)
      console.warn('登録事業者名取得失敗', {
        status: response.status,
        reason: 'http_error',
      })
      return tryFallbackSuccess(invoiceNumber, failureMessage)
    }

    if (payload.registrant?.registeredName) {
      const registrant: InvoiceRegistrantInfo = {
        ...payload.registrant,
        lookupMethod: payload.registrant.lookupMethod || 'インボイス番号検索',
        source: payload.registrant.source === 'fallback' ? 'fallback' : 'nta-invoice-api',
      }
      setCachedInvoiceRegistrant(registrant)
      return {
        status: 'success',
        registrant,
        invoiceCheckStatus: '確認済',
      }
    }

    const announcement = payload.announcement?.[0]
    if (!announcement?.name?.trim()) {
      const failureMessage =
        payload.message?.trim() ||
        '登録事業者名取得失敗：登録情報が見つかりませんでした'
      console.warn('登録事業者名取得失敗', { reason: 'not_found' })
      return tryFallbackSuccess(invoiceNumber, failureMessage)
    }

    const registrant = mapAnnouncementToRegistrant(invoiceNumber, announcement, 'nta-invoice-api')
    setCachedInvoiceRegistrant(registrant)

    return {
      status: 'success',
      registrant,
      invoiceCheckStatus: '確認済',
    }
  } catch (error) {
    const networkMessage =
      error instanceof TypeError
        ? '登録事業者名取得失敗：通信エラー（CORS または API 到達不可）'
        : `登録事業者名取得失敗：${error instanceof Error ? error.message : '不明なエラー'}`
    console.warn('登録事業者名取得失敗', {
      reason: 'network_or_runtime',
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return tryFallbackSuccess(invoiceNumber, networkMessage)
  }
}

/**
 * インボイス登録事業者検索。
 * 第2引数 auditContext がある場合のみ、検索完了後に auditLogs へ履歴を1件保存する。
 * 履歴保存の成否は検索結果に影響しない。
 */
export async function lookupInvoiceRegistrant(
  invoiceNumberRaw: string,
  auditContext?: InvoiceLookupAuditContext,
): Promise<InvoiceRegistrantLookupResult> {
  const requestedAt = new Date().toISOString()
  const result = await lookupInvoiceRegistrantCore(invoiceNumberRaw)

  if (!auditContext) {
    return result
  }

  const completedAt = new Date().toISOString()
  const persist = await recordAccountingInvoiceLookupHistory({
    auditContext,
    result,
    requestedAt,
    completedAt,
  })

  if (!persist.ok) {
    auditContext.onHistoryPersistFailure?.()
    console.warn('[accounting] invoice lookup history unavailable', {
      message: INVOICE_LOOKUP_HISTORY_SAVE_FAILURE_MESSAGE,
    })
  }

  return result
}

export const applyInvoiceRegistrantLookupToParsedFields = <
  T extends {
    invoiceNumber?: string
    invoiceRegisteredName?: string
    invoiceCheckStatus?: InvoiceCheckStatus
    vendorName?: string
    invoiceCorporateNumber?: string
    invoiceAddress?: string
    invoiceRegistrationStatus?: string
    invoiceRegistrationDate?: string
    invoiceTradeName?: string
    invoiceLookupMethod?: string
    invoiceOcrNumber?: string
  },
>(
  parsed: T,
  lookup: InvoiceRegistrantLookupResult,
): T => {
  if (lookup.status !== 'success') {
    return {
      ...parsed,
      invoiceOcrNumber: parsed.invoiceNumber,
      invoiceLookupMethod: parsed.invoiceLookupMethod,
    }
  }

  const { registrant } = lookup

  return {
    ...parsed,
    invoiceNumber: registrant.invoiceNumber,
    invoiceOcrNumber: parsed.invoiceNumber || registrant.invoiceNumber,
    invoiceRegisteredName: registrant.registeredName,
    invoiceCheckStatus: '確認済',
    invoiceCorporateNumber: registrant.corporateNumber,
    invoiceAddress: registrant.address,
    invoiceRegistrationStatus: registrant.registrationStatus,
    invoiceRegistrationDate: registrant.registrationDate,
    invoiceTradeName: registrant.tradeName,
    invoiceLookupMethod: registrant.lookupMethod,
    // Prefer official registrant name over OCR vendor string for vendor display too.
    vendorName: registrant.registeredName || parsed.vendorName,
  }
}
