import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'

const functionsRegion = 'asia-northeast1'

export type PreOpeningResetTargetCounts = {
  firestore: Record<string, number>
  reservation: Record<string, number>
}

export type PreOpeningResetCapabilityResult = {
  supported: boolean
  franchiseeId: string
  storeId: string
  targets: PreOpeningResetTargetCounts
}

export type PreOpeningResetExecuteResult = {
  success: boolean
  franchiseeId: string
  storeId: string
  executedBy: string
  executedAt: string
  targets: PreOpeningResetTargetCounts
  deleted: PreOpeningResetTargetCounts
  failed: PreOpeningResetTargetCounts
  reservationLogId: number | null
  reservationSupported: boolean
}

const DEFAULT_RESERVATION_KEYS = [
  'reservations',
  'blocks',
  'quotes',
  'quote_consents',
  'meter_fixed_fare_runs',
  'email_logs',
  'pre_opening_reset_logs',
] as const

const DEFAULT_FIRESTORE_KEYS = [
  'caseRecords',
  'workSessions',
  'auditLogs',
  'accountingReceipts',
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'maintenanceLogs',
  'adminActionLogs',
  'operationLogs',
  'debugLogs',
  'errorLogs',
  'resetLogs',
  'caseCounters',
  'staffAttendance',
  'loginAttempts',
  'storageFiles',
] as const

const emptyCountMap = (keys: readonly string[]) =>
  keys.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0
    return accumulator
  }, {})

const emptyTargets = (): PreOpeningResetTargetCounts => ({
  firestore: emptyCountMap(DEFAULT_FIRESTORE_KEYS),
  reservation: emptyCountMap(DEFAULT_RESERVATION_KEYS),
})

const normalizeCountMap = (
  value: unknown,
  defaults: readonly string[],
): Record<string, number> => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const counts = emptyCountMap(defaults)
  for (const key of defaults) {
    counts[key] = Number(source[key]) || 0
  }
  for (const [key, raw] of Object.entries(source)) {
    if (!(key in counts)) {
      counts[key] = Number(raw) || 0
    }
  }
  return counts
}

const normalizeTargetCounts = (value: unknown): PreOpeningResetTargetCounts => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    firestore: normalizeCountMap(source.firestore, DEFAULT_FIRESTORE_KEYS),
    reservation: normalizeCountMap(source.reservation, DEFAULT_RESERVATION_KEYS),
  }
}

const parseCapabilityResult = (data: unknown): PreOpeningResetCapabilityResult => {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    supported: payload.supported === true,
    franchiseeId: String(payload.franchiseeId ?? ''),
    storeId: String(payload.storeId ?? ''),
    targets: normalizeTargetCounts(payload.targets),
  }
}

const parseExecuteResult = (data: unknown): PreOpeningResetExecuteResult => {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    success: payload.success === true,
    franchiseeId: String(payload.franchiseeId ?? ''),
    storeId: String(payload.storeId ?? ''),
    executedBy: String(payload.executedBy ?? ''),
    executedAt: String(payload.executedAt ?? ''),
    targets: normalizeTargetCounts(payload.targets),
    deleted: normalizeTargetCounts(payload.deleted),
    failed: normalizeTargetCounts(payload.failed),
    reservationLogId:
      typeof payload.reservationLogId === 'number' ? payload.reservationLogId : null,
    reservationSupported: payload.reservationSupported === true,
  }
}

/**
 * Browser-side entry point for pre-opening reset.
 * Calls Firebase Callable Functions only. Never contacts reservation-v4 admin APIs directly.
 */
export async function fetchPreOpeningResetCapability(
  franchiseeId: string,
  storeId: string,
): Promise<PreOpeningResetCapabilityResult> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    { franchiseeId: string; storeId: string },
    PreOpeningResetCapabilityResult
  >(functions, 'getPreOpeningResetCapability')

  const response = await callable({ franchiseeId, storeId })
  return parseCapabilityResult(response.data)
}

export async function executePreOpeningDataReset({
  franchiseeId,
  storeId,
  confirmText,
  executedBy,
}: {
  franchiseeId: string
  storeId: string
  confirmText: string
  executedBy: string
}): Promise<PreOpeningResetExecuteResult> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    {
      franchiseeId: string
      storeId: string
      confirmText: string
      executedBy: string
    },
    PreOpeningResetExecuteResult
  >(functions, 'executePreOpeningDataReset')

  const response = await callable({
    franchiseeId,
    storeId,
    confirmText,
    executedBy,
  })
  return parseExecuteResult(response.data)
}

export const preOpeningResetEmptyTargets = emptyTargets
