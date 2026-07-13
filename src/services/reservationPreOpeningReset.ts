import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'

const functionsRegion = 'asia-northeast1'

export type PreOpeningResetTargetCounts = {
  firestore: Record<string, number>
}

export type PreOpeningReservationTargetCounts = {
  reservation: Record<string, number>
}

export type PreOpeningReservationDashboardCounts = {
  totalReservations: number
  unhandledReservations: number
  confirmedReservations: number
}

export type PreOpeningResetPreservedPayload = {
  categories: string[]
  accountingProtected: boolean
  reservationDataUntouched: boolean
  note: string
}

export type PreOpeningResetCapabilityResult = {
  supported: boolean
  franchiseeId: string
  storeId: string
  targets: PreOpeningResetTargetCounts
  preserved: PreOpeningResetPreservedPayload
}

export type PreOpeningReservationResetCapabilityResult = {
  supported: boolean
  franchiseeId: string
  storeId: string
  targets: PreOpeningReservationTargetCounts
  dashboard: PreOpeningReservationDashboardCounts
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
  preserved: PreOpeningResetPreservedPayload
}

export type PreOpeningReservationResetExecuteResult = {
  success: boolean
  franchiseeId: string
  storeId: string
  executedBy: string
  executedAt: string
  targets: PreOpeningReservationTargetCounts
  deleted: PreOpeningReservationTargetCounts
  failed: PreOpeningReservationTargetCounts
  dashboard: PreOpeningReservationDashboardCounts
  reservationLogId: number | null
  reservationSupported: boolean
}

const DEFAULT_RESERVATION_KEYS = [
  'reservations',
  'unhandled_reservations',
  'confirmed_reservations',
  'blocks',
  'quotes',
  'quote_consents',
  'meter_fixed_fare_runs',
  'email_logs',
  'pre_opening_reset_logs',
] as const

/** Must match functions/src/preOpeningResetAllowlist.ts firestore target keys. */
export const DEFAULT_FIRESTORE_KEYS = [
  'caseRecords',
  'caseCounters',
  'storageFiles',
] as const

export const DEFAULT_PRESERVED_CATEGORIES = [
  'reservations',
  'franchisees',
  'stores',
  'employees',
  'employeeAttendance',
  'workSessions',
  'vehicles',
  'fareSettings',
  'meterSettings',
  'companySettings',
  'firebaseAuth',
  'auditLogs',
  'adminActionLogs',
  'resetLogs',
  'loginAttempts',
  'staffAttendance',
  'accounting',
  'accountingReceipts',
  'accountingExpenses',
  'accountingAdjustments',
  'accountingFixedCosts',
  'accountingSales',
  'accountingExports',
  'accountingFixedAssets',
  'accountingSettlementAuxiliary',
  'accountingStorage',
] as const

const emptyCountMap = (keys: readonly string[]) =>
  keys.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0
    return accumulator
  }, {})

const emptyPreserved = (): PreOpeningResetPreservedPayload => ({
  categories: [...DEFAULT_PRESERVED_CATEGORIES],
  accountingProtected: true,
  reservationDataUntouched: true,
  note: '経理データおよび経理証憑は削除されません。予約データは削除されません。',
})

const emptyTargets = (): PreOpeningResetTargetCounts => ({
  firestore: emptyCountMap(DEFAULT_FIRESTORE_KEYS),
})

const emptyReservationOnlyTargets = (): PreOpeningReservationTargetCounts => ({
  reservation: emptyCountMap(DEFAULT_RESERVATION_KEYS),
})

const emptyDashboard = (): PreOpeningReservationDashboardCounts => ({
  totalReservations: 0,
  unhandledReservations: 0,
  confirmedReservations: 0,
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
  }
}

const normalizeReservationTargetCounts = (
  value: unknown,
): PreOpeningReservationTargetCounts => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    reservation: normalizeCountMap(source.reservation, DEFAULT_RESERVATION_KEYS),
  }
}

const normalizeDashboardCounts = (value: unknown): PreOpeningReservationDashboardCounts => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    totalReservations:
      Number(source.totalReservations ?? source.total_reservations) || 0,
    unhandledReservations:
      Number(source.unhandledReservations ?? source.unhandled_reservations) || 0,
    confirmedReservations:
      Number(source.confirmedReservations ?? source.confirmed_reservations) || 0,
  }
}

const normalizePreserved = (value: unknown): PreOpeningResetPreservedPayload => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const categories = Array.isArray(source.categories)
    ? source.categories.map((entry) => String(entry))
    : [...DEFAULT_PRESERVED_CATEGORIES]
  return {
    categories,
    accountingProtected: source.accountingProtected !== false,
    reservationDataUntouched: source.reservationDataUntouched !== false,
    note:
      typeof source.note === 'string' && source.note.trim()
        ? source.note
        : emptyPreserved().note,
  }
}

const parseCapabilityResult = (data: unknown): PreOpeningResetCapabilityResult => {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    supported: payload.supported !== false,
    franchiseeId: String(payload.franchiseeId ?? ''),
    storeId: String(payload.storeId ?? ''),
    targets: normalizeTargetCounts(payload.targets),
    preserved: normalizePreserved(payload.preserved),
  }
}

const parseReservationCapabilityResult = (
  data: unknown,
): PreOpeningReservationResetCapabilityResult => {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const targets = normalizeReservationTargetCounts(payload.targets)
  return {
    supported: payload.supported === true,
    franchiseeId: String(payload.franchiseeId ?? ''),
    storeId: String(payload.storeId ?? ''),
    targets,
    dashboard: normalizeDashboardCounts(
      payload.dashboard ?? {
        totalReservations: targets.reservation.reservations,
        unhandledReservations: targets.reservation.unhandled_reservations,
        confirmedReservations: targets.reservation.confirmed_reservations,
      },
    ),
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
    preserved: normalizePreserved(payload.preserved),
  }
}

const parseReservationExecuteResult = (
  data: unknown,
): PreOpeningReservationResetExecuteResult => {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    success: payload.success === true,
    franchiseeId: String(payload.franchiseeId ?? ''),
    storeId: String(payload.storeId ?? ''),
    executedBy: String(payload.executedBy ?? ''),
    executedAt: String(payload.executedAt ?? ''),
    targets: normalizeReservationTargetCounts(payload.targets),
    deleted: normalizeReservationTargetCounts(payload.deleted),
    failed: normalizeReservationTargetCounts(payload.failed),
    dashboard: normalizeDashboardCounts(payload.dashboard),
    reservationLogId:
      typeof payload.reservationLogId === 'number' ? payload.reservationLogId : null,
    reservationSupported: payload.reservationSupported === true,
  }
}

/**
 * Browser-side entry point for meter-side pre-opening reset.
 * Calls Firebase Callable Functions only. Never contacts reservation-v4 admin APIs.
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

export async function fetchPreOpeningReservationResetCapability(
  franchiseeId: string,
  storeId: string,
): Promise<PreOpeningReservationResetCapabilityResult> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    { franchiseeId: string; storeId: string },
    PreOpeningReservationResetCapabilityResult
  >(functions, 'getPreOpeningReservationResetCapability')

  const response = await callable({ franchiseeId, storeId })
  return parseReservationCapabilityResult(response.data)
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

export async function executePreOpeningReservationReset({
  franchiseeId,
  storeId,
  confirmText,
  executedBy,
}: {
  franchiseeId: string
  storeId: string
  confirmText: string
  executedBy: string
}): Promise<PreOpeningReservationResetExecuteResult> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<
    {
      franchiseeId: string
      storeId: string
      confirmText: string
      executedBy: string
    },
    PreOpeningReservationResetExecuteResult
  >(functions, 'executePreOpeningReservationReset')

  const response = await callable({
    franchiseeId,
    storeId,
    confirmText,
    executedBy,
  })
  return parseReservationExecuteResult(response.data)
}

export const preOpeningResetEmptyTargets = emptyTargets
export const preOpeningReservationResetEmptyTargets = emptyReservationOnlyTargets
export const preOpeningReservationDashboardEmptyCounts = emptyDashboard
export const preOpeningResetEmptyPreserved = emptyPreserved
