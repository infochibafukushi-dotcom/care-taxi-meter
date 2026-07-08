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
}

const NTA_PROCESS_LABELS: Record<string, string> = {
  '01': '登録',
  '02': '取消',
  '03': '失効',
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

const resolveInvoiceApiBaseUrl = () => {
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

const DEMO_REGISTRANTS: Record<string, InvoiceRegistrantInfo> = {
  T4200001013662: {
    invoiceNumber: 'T4200001013662',
    corporateNumber: '4200001013662',
    registeredName: '株式会社セリア',
    address: '岐阜県大垣市今宿６丁目５２番地１８',
    registrationStatus: '登録',
    registrationDate: '2023-10-01',
    lookupMethod: 'インボイス番号検索',
    lookedUpAt: new Date().toISOString(),
    source: 'nta-invoice-api',
  },
}

export async function lookupInvoiceRegistrant(
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
  if (cached?.registeredName) {
    return {
      status: 'success',
      registrant: { ...cached, source: 'cache' },
      invoiceCheckStatus: '確認済',
    }
  }

  if (isReviewDemoRuntimeEnabled()) {
    const demo = DEMO_REGISTRANTS[invoiceNumber]
    if (demo) {
      setCachedInvoiceRegistrant(demo)
      return {
        status: 'success',
        registrant: demo,
        invoiceCheckStatus: '確認済',
      }
    }
  }

  try {
    const url = `${resolveInvoiceApiBaseUrl()}/registrant?number=${encodeURIComponent(invoiceNumber)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      console.warn('登録事業者名取得失敗', {
        invoiceNumber,
        status: response.status,
      })
      return {
        status: 'error',
        invoiceNumber,
        invoiceCheckStatus: '未確認',
        message: '登録事業者名取得失敗',
      }
    }

    const payload = (await response.json()) as NtaInvoiceApiResponse & {
      registrant?: InvoiceRegistrantInfo
      status?: string
      message?: string
    }

    if (payload.registrant?.registeredName) {
      setCachedInvoiceRegistrant(payload.registrant)
      return {
        status: 'success',
        registrant: payload.registrant,
        invoiceCheckStatus: '確認済',
      }
    }

    const announcement = payload.announcement?.[0]
    if (!announcement?.name?.trim()) {
      console.warn('登録事業者名取得失敗', { invoiceNumber, reason: 'not_found' })
      return {
        status: 'not_found',
        invoiceNumber,
        invoiceCheckStatus: '登録なし',
        message: '登録事業者名取得失敗',
      }
    }

    const registrant = mapAnnouncementToRegistrant(invoiceNumber, announcement, 'nta-invoice-api')
    setCachedInvoiceRegistrant(registrant)

    return {
      status: 'success',
      registrant,
      invoiceCheckStatus: '確認済',
    }
  } catch (error) {
    console.warn('登録事業者名取得失敗', {
      invoiceNumber,
      error: error instanceof Error ? error.message : error,
    })
    return {
      status: 'error',
      invoiceNumber,
      invoiceCheckStatus: '未確認',
      message: '登録事業者名取得失敗',
    }
  }
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
