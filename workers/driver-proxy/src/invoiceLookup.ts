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
  '02': '取消',
  '03': '失効',
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
  fetchImpl = fetch,
}: {
  invoiceNumber: string
  applicationId: string
  fetchImpl?: typeof fetch
}) => {
  const upstreamUrl = new URL('https://web-api.invoice-kohyo.nta.go.jp/1/num')
  upstreamUrl.searchParams.set('id', applicationId)
  upstreamUrl.searchParams.set('number', invoiceNumber)
  upstreamUrl.searchParams.set('type', '21')
  upstreamUrl.searchParams.set('history', '0')

  const upstreamResponse = await fetchImpl(upstreamUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  if (!upstreamResponse.ok) {
    return {
      ok: false as const,
      status: upstreamResponse.status,
      body: {
        status: 'error',
        message: '登録事業者名取得失敗',
        invoiceNumber,
      },
    }
  }

  const payload = (await upstreamResponse.json()) as NtaInvoiceApiResponse
  const announcement = payload.announcement?.[0]

  if (!announcement?.name?.trim()) {
    return {
      ok: true as const,
      status: 200,
      body: {
        status: 'not_found',
        message: '登録事業者名取得失敗',
        invoiceNumber,
        announcement: payload.announcement ?? [],
      },
    }
  }

  return {
    ok: true as const,
    status: 200,
    body: {
      status: 'success',
      registrant: mapNtaAnnouncementToRegistrant(invoiceNumber, announcement),
      announcement: payload.announcement ?? [],
    },
  }
}
