const postSettlementLockStorageKey = 'careTaxiMeterPostSettlementLock'

export type PostSettlementLock = {
  lockedAt: string
  caseNumber: string
}

export const readPostSettlementLock = (): PostSettlementLock | null => {
  try {
    const raw = window.sessionStorage.getItem(postSettlementLockStorageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as PostSettlementLock
    if (!parsed || typeof parsed.caseNumber !== 'string') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export const writePostSettlementLock = (caseNumber: string) => {
  const lock: PostSettlementLock = {
    caseNumber,
    lockedAt: new Date().toISOString(),
  }
  window.sessionStorage.setItem(postSettlementLockStorageKey, JSON.stringify(lock))
}

export const clearPostSettlementLock = () => {
  window.sessionStorage.removeItem(postSettlementLockStorageKey)
}
