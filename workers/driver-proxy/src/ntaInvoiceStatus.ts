import type {
  InvoiceRegistryKind,
  InvoiceRegistryStatus,
  NtaInvoiceAnnouncement,
  NtaInvoiceResponse,
} from './ntaTypes.ts'

export type InvoiceStatusDecision = {
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
  registrationNumberFromNta: string | null
}

const asTrimmed = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

const parseCount = (count: unknown): number | null => {
  if (typeof count === 'number' && Number.isFinite(count)) {
    return count
  }
  if (typeof count === 'string' && count.trim() !== '') {
    const parsed = Number(count)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const resolveKind = (kind: string | null | undefined): InvoiceRegistryKind => {
  if (kind === '1') return 'individual'
  if (kind === '2') return 'corporation'
  return 'unknown'
}

/**
 * 日付境界: `eventDate <= basisDate` なら「その日時点で発生済み」。
 * basisDate が無い場合は日付による無効化判定を行わない（process を優先）。
 */
const isOnOrBefore = (eventDate: string | null, basisDate: string | null): boolean => {
  if (!eventDate || !basisDate) {
    return false
  }
  return eventDate <= basisDate
}

/**
 * 国税庁レスポンスから登録状態を判定する純粋関数。
 * `/1/valid` の応答を優先して解釈する（呼び出し側が valid API を使っている前提）。
 */
export const determineInvoiceRegistryStatus = (
  response: NtaInvoiceResponse | null | undefined,
  options?: { basisDate?: string | null },
): InvoiceStatusDecision => {
  const basisDate = options?.basisDate ?? null
  const ntaLastUpdateDate = asTrimmed(response?.lastUpdateDate)

  const emptyDecision = (status: InvoiceRegistryStatus): InvoiceStatusDecision => ({
    status,
    isQualifiedAtBasisDate: status === 'active',
    name: null,
    tradeName: null,
    address: null,
    kind: 'unknown',
    registrationDate: null,
    expirationDate: null,
    cancellationDate: null,
    ntaLastUpdateDate,
    registrationNumberFromNta: null,
  })

  if (!response) {
    return emptyDecision('unknown')
  }

  const announcements = Array.isArray(response.announcement) ? response.announcement : null
  if (announcements === null) {
    return emptyDecision('unknown')
  }

  const count = parseCount(response.count)
  if (count === 0 || announcements.length === 0) {
    return emptyDecision('not_found')
  }

  const announcement: NtaInvoiceAnnouncement = announcements[0] ?? {}
  const process = asTrimmed(announcement.process)
  const registrationDate = asTrimmed(announcement.registrationDate)
  const expirationDate = asTrimmed(announcement.expireDate)
  const cancellationDate = asTrimmed(announcement.disposalDate)
  const name = asTrimmed(announcement.name)
  const tradeName = asTrimmed(announcement.tradeName)
  const address = asTrimmed(announcement.address)
  const kind = resolveKind(asTrimmed(announcement.kind))
  const registrationNumberFromNta = asTrimmed(announcement.registratedNumber)

  const baseFields = {
    name,
    tradeName,
    address,
    kind,
    registrationDate,
    expirationDate,
    cancellationDate,
    ntaLastUpdateDate,
    registrationNumberFromNta,
  }

  if (process === '99') {
    return {
      ...baseFields,
      status: 'not_found',
      isQualifiedAtBasisDate: false,
    }
  }

  if (process === '03' || isOnOrBefore(expirationDate, basisDate)) {
    if (process === '03' || (expirationDate && basisDate && expirationDate <= basisDate)) {
      return {
        ...baseFields,
        status: 'expired',
        isQualifiedAtBasisDate: false,
      }
    }
  }

  if (process === '04' || isOnOrBefore(cancellationDate, basisDate)) {
    if (process === '04' || (cancellationDate && basisDate && cancellationDate <= basisDate)) {
      return {
        ...baseFields,
        status: 'cancelled',
        isQualifiedAtBasisDate: false,
      }
    }
  }

  // expire/disposal without process and without basisDate: treat as current status labels
  if (!basisDate) {
    if (expirationDate) {
      return { ...baseFields, status: 'expired', isQualifiedAtBasisDate: false }
    }
    if (cancellationDate) {
      return { ...baseFields, status: 'cancelled', isQualifiedAtBasisDate: false }
    }
  }

  if (process === '01' || process === '02') {
    const registeredOk =
      !basisDate || !registrationDate || registrationDate <= basisDate
    const notExpired = !(expirationDate && basisDate && expirationDate <= basisDate)
    const notCancelled = !(cancellationDate && basisDate && cancellationDate <= basisDate)

    if (registeredOk && notExpired && notCancelled) {
      return {
        ...baseFields,
        status: 'active',
        isQualifiedAtBasisDate: true,
      }
    }

    if (!registeredOk) {
      return {
        ...baseFields,
        status: 'not_found',
        isQualifiedAtBasisDate: false,
      }
    }
  }

  // /valid で announcement が返っており process が空でも名称がある場合は防御的に active
  if (!process && name && !expirationDate && !cancellationDate) {
    const registeredOk =
      !basisDate || !registrationDate || registrationDate <= basisDate
    if (registeredOk) {
      return {
        ...baseFields,
        status: 'active',
        isQualifiedAtBasisDate: true,
      }
    }
  }

  return {
    ...baseFields,
    status: 'unknown',
    isQualifiedAtBasisDate: false,
  }
}

export const INVOICE_REGISTRY_STATUS_LABELS: Record<InvoiceRegistryStatus, string> = {
  active: '登録有効',
  expired: '登録失効',
  cancelled: '登録取消',
  not_found: '登録情報なし',
  unknown: '状態を判定できません',
}
