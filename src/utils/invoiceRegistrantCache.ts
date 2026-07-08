import type { InvoiceRegistrantInfo } from '../types/invoiceRegistrant'

const CACHE_STORAGE_KEY = 'ctm.invoiceRegistrantCache.v1'
const memoryCache = new Map<string, InvoiceRegistrantInfo>()

const normalizeInvoiceNumberKey = (invoiceNumber: string) =>
  invoiceNumber.trim().toUpperCase().replace(/[^0-9T]/g, '')

const readPersistedCache = (): Record<string, InvoiceRegistrantInfo> => {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, InvoiceRegistrantInfo>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writePersistedCache = (entries: Record<string, InvoiceRegistrantInfo>) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.warn('[Invoice Registrant] cache write failed', error)
  }
}

export const getCachedInvoiceRegistrant = (
  invoiceNumber: string,
): InvoiceRegistrantInfo | undefined => {
  const key = normalizeInvoiceNumberKey(invoiceNumber)
  if (!key) {
    return undefined
  }

  const memoryHit = memoryCache.get(key)
  if (memoryHit) {
    return memoryHit
  }

  const persisted = readPersistedCache()[key]
  if (persisted) {
    memoryCache.set(key, persisted)
    return persisted
  }

  return undefined
}

export const setCachedInvoiceRegistrant = (registrant: InvoiceRegistrantInfo) => {
  const key = normalizeInvoiceNumberKey(registrant.invoiceNumber)
  if (!key) {
    return
  }

  const cached: InvoiceRegistrantInfo = {
    ...registrant,
    source: 'cache',
  }

  memoryCache.set(key, cached)
  const persisted = readPersistedCache()
  persisted[key] = cached
  writePersistedCache(persisted)
}

/** test helper */
export const clearInvoiceRegistrantCacheForTests = () => {
  memoryCache.clear()
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(CACHE_STORAGE_KEY)
  }
}
