import { fetchNtaInvoiceRegistry, resolveNtaApiBaseUrl } from './ntaInvoiceClient.ts'
import { determineInvoiceRegistryStatus } from './ntaInvoiceStatus.ts'

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
}

const NTA_PROCESS_LABELS: Record<string, string> = {
  '01': '登録',
  '02': '登録',
  '03': '失効',
  '04': '取消',
}

const resolveRegistrationStatus = (announcement: NtaAnnouncement) => {
  if (announcement.process === '04' || announcement.disposalDate) {
    return '取消'
  }
  if (announcement.process === '03' || announcement.expireDate) {
    return '失効'
  }
  const processLabel = announcement.process
    ? NTA_PROCESS_LABELS[announcement.process] ?? announcement.process
    : ''
  return processLabel || '登録'
}

export const mapNtaAnnouncementToRegistrant = (
  invoiceNumber: string,
  announcement: NtaAnnouncement,
) => ({
  invoiceNumber,
  corporateNumber: invoiceNumber.replace(/^T/i, ''),
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
  lookupMethod: 'インボイス番号検索' as const,
  lookedUpAt: new Date().toISOString(),
  source: 'nta-invoice-api' as const,
})

export const fetchNtaInvoiceRegistrant = async ({
  invoiceNumber,
  applicationId,
  baseUrl,
  fetchImpl = fetch,
}: {
  invoiceNumber: string
  applicationId: string
  baseUrl?: string | null
  fetchImpl?: typeof fetch
}) => {
  const result = await fetchNtaInvoiceRegistry({
    applicationId,
    registrationNumber: invoiceNumber,
    basisDate: null,
    baseUrl: resolveNtaApiBaseUrl(baseUrl),
    fetchImpl,
  })

  if (!result.ok) {
    return {
      ok: false as const,
      status: result.upstreamStatus && result.upstreamStatus >= 400 ? result.upstreamStatus : 502,
      body: {
        status: 'error',
        message: '登録事業者名取得失敗',
        invoiceNumber,
      },
    }
  }

  const decision = determineInvoiceRegistryStatus(result.response, { basisDate: null })
  const announcement = Array.isArray(result.response.announcement)
    ? result.response.announcement[0]
    : undefined

  if (decision.status === 'not_found' || !announcement?.name?.trim()) {
    return {
      ok: true as const,
      status: 200,
      body: {
        status: 'not_found',
        message: '登録事業者名取得失敗',
        invoiceNumber,
        announcement: result.response.announcement ?? [],
      },
    }
  }

  return {
    ok: true as const,
    status: 200,
    body: {
      status: 'success',
      registrant: mapNtaAnnouncementToRegistrant(invoiceNumber, announcement),
      announcement: result.response.announcement ?? [],
    },
  }
}

// keep type export for tests that may reference payload shape
export type { NtaInvoiceApiResponse }
