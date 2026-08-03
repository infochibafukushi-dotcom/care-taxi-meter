import { getAuth } from 'firebase/auth'
import { getFirebaseApp } from '../lib/firebase'
import type {
  InvoiceRegistryCheckData,
  InvoiceRegistryCheckResponse,
} from '../types/invoiceRegistry'
import {
  INVOICE_REGISTRATION_NUMBER_ERROR,
  normalizeInvoiceRegistrationNumberForUi,
  normalizeBasisDateForUi,
} from '../utils/invoiceRegistryNormalize'
import { getDatePartsInJapan } from '../utils/japanDate'

export { INVOICE_REGISTRATION_NUMBER_ERROR }

const resolveInvoiceRegistryApiUrl = () => {
  const explicit = (import.meta.env.VITE_INVOICE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (explicit) {
    // If pointing at /api/invoice, use sibling registry path on same origin host
    if (explicit.endsWith('/api/invoice')) {
      return `${explicit.replace(/\/api\/invoice$/, '')}/api/invoice-registry/check`
    }
    return `${explicit}/check`
  }

  const configured = (import.meta.env.VITE_RESERVATION_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (configured) {
    return `${configured}/api/invoice-registry/check`
  }

  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  return `${base}/api/invoice-registry/check`
}

const getFirebaseIdToken = async (): Promise<string | null> => {
  try {
    const user = getAuth(getFirebaseApp()).currentUser
    if (!user) {
      return null
    }
    return await user.getIdToken()
  } catch {
    return null
  }
}

export const getTodayYmdInJapan = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInJapan(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type CheckInvoiceRegistryInput = {
  registrationNumber: string
  basisDate?: string
}

export async function checkInvoiceRegistry(
  input: CheckInvoiceRegistryInput,
): Promise<InvoiceRegistryCheckResponse> {
  const registrationNumber = normalizeInvoiceRegistrationNumberForUi(input.registrationNumber)
  if (!registrationNumber) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: INVOICE_REGISTRATION_NUMBER_ERROR,
        retryable: false,
      },
    }
  }

  const basis = normalizeBasisDateForUi(input.basisDate, getTodayYmdInJapan())
  if (!basis.ok) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: basis.message,
        retryable: false,
      },
    }
  }

  const idToken = await getFirebaseIdToken()
  if (!idToken) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'ログインが必要です。',
        retryable: false,
      },
    }
  }

  try {
    const response = await fetch(resolveInvoiceRegistryApiUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        registrationNumber,
        basisDate: basis.date ?? undefined,
      }),
    })

    let payload: InvoiceRegistryCheckResponse | null = null
    try {
      payload = (await response.json()) as InvoiceRegistryCheckResponse
    } catch {
      payload = null
    }

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      return payload
    }

    if (response.status === 401) {
      return {
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'ログインが必要です。',
          retryable: false,
        },
      }
    }

    if (response.status === 403) {
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: '経理機能を利用する権限がありません。',
          retryable: false,
        },
      }
    }

    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'インボイス登録確認に失敗しました。',
        retryable: true,
      },
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'NTA_UNAVAILABLE',
        message: '国税庁の照会サービスに接続できませんでした。しばらくしてから再度お試しください。',
        retryable: true,
      },
    }
  }
}

/** Map registry check result into legacy registrant fields used by expense form. */
export const mapRegistryDataToLegacyRegistrant = (data: InvoiceRegistryCheckData) => {
  const statusLabel =
    data.status === 'active'
      ? '登録'
      : data.status === 'expired'
        ? '失効'
        : data.status === 'cancelled'
          ? '取消'
          : data.status === 'not_found'
            ? '登録なし'
            : '不明'

  return {
    invoiceNumber: data.registrationNumber,
    corporateNumber: data.registrationNumber.replace(/^T/i, ''),
    registeredName: data.name ?? '',
    tradeName: data.tradeName ?? undefined,
    address: data.address ?? undefined,
    registrationStatus: statusLabel,
    registrationDate: data.registrationDate ?? undefined,
    updateDate: data.ntaLastUpdateDate ?? undefined,
    disposalDate: data.cancellationDate ?? undefined,
    expireDate: data.expirationDate ?? undefined,
    kind: data.kind === 'unknown' ? undefined : data.kind === 'individual' ? '1' : '2',
    lookupMethod: 'インボイス番号検索' as const,
    lookedUpAt: data.checkedAt,
    source: data.cacheHit ? ('cache' as const) : ('nta-invoice-api' as const),
  }
}
