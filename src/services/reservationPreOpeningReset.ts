import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'

const functionsRegion = 'asia-northeast1'

export type PreOpeningResetTargetCounts = {
  firestore: Record<string, number>
  reservation: Record<string, number>
}

export type PreOpeningReservationTargetCounts = {
  reservation: Record<string, number>
}

export type PreOpeningReservationDashboardCounts = {
  totalReservations: number
  unhandledReservations: number
  confirmedReservations: number
}

export type PreOpeningResetCategorySummary = {
  salesOperations: number
  reservationsCustomers: number
  attendance: number
}

export type PreOpeningResetPreservedPayload = {
  categories: string[]
  accountingProtected: boolean
  reservationBlocksProtected: boolean
  mastersProtected: boolean
  auditLogsProtected: boolean
  note: string
}

export type PreOpeningResetCapabilityResult = {
  supported: boolean
  franchiseeId: string
  storeId: string
  companyStatus: string
  locked: boolean
  reason: string
  targets: PreOpeningResetTargetCounts
  categories: PreOpeningResetCategorySummary
  dashboard: PreOpeningReservationDashboardCounts
  reservationSupported: boolean
  reservationMessage: string
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
  locked: boolean
  targets: PreOpeningResetTargetCounts
  deleted: PreOpeningResetTargetCounts
  failed: PreOpeningResetTargetCounts
  categories: PreOpeningResetCategorySummary
  dashboard: PreOpeningReservationDashboardCounts
  reservationSupported: boolean
  reservationError: string
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
  'workSessions',
  'staffAttendance',
  'caseCounters',
  'storageFiles',
] as const

export const DEFAULT_PRESERVED_CATEGORIES = [
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
  'franchisees',
  'stores',
  'employees',
  'vehicles',
  'fareSettings',
  'meterSettings',
  'companySettings',
  'shiftSettings',
  'workCategories',
  'reservationBlocks',
  'businessHours',
  'firebaseAuth',
  'auditLogs',
  'adminActionLogs',
  'loginAttempts',
  'maintenanceLogs',
  'operationLogs',
  'debugLogs',
  'errorLogs',
] as const

const emptyCountMap = (keys: readonly string[]) =>
  keys.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0
    return accumulator
  }, {})

const emptyCategories = (): PreOpeningResetCategorySummary => ({
  salesOperations: 0,
  reservationsCustomers: 0,
  attendance: 0,
})

const emptyPreserved = (): PreOpeningResetPreservedPayload => ({
  categories: [...DEFAULT_PRESERVED_CATEGORIES],
  accountingProtected: true,
  reservationBlocksProtected: true,
  mastersProtected: true,
  auditLogsProtected: true,
  note: '経理・加盟店・店舗・スタッフ・予約ブロック・料金/車両/設定・監査/認証ログは削除しません。',
})

const emptyTargets = (): PreOpeningResetTargetCounts => ({
  firestore: emptyCountMap(DEFAULT_FIRESTORE_KEYS),
  reservation: emptyCountMap(DEFAULT_RESERVATION_KEYS),
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
    reservation: normalizeCountMap(source.reservation, DEFAULT_RESERVATION_KEYS),
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

const normalizeCategories = (value: unknown): PreOpeningResetCategorySummary => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    salesOperations: Number(source.salesOperations) || 0,
    reservationsCustomers: Number(source.reservationsCustomers) || 0,
    attendance: Number(source.attendance) || 0,
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
    reservationBlocksProtected: source.reservationBlocksProtected !== false,
    mastersProtected: source.mastersProtected !== false,
    auditLogsProtected: source.auditLogsProtected !== false,
    note:
      typeof source.note === 'string' && source.note.trim()
        ? source.note
        : emptyPreserved().note,
  }
}

const parseCapabilityResult = (data: unknown): PreOpeningResetCapabilityResult => {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const targets = normalizeTargetCounts(payload.targets)
  return {
    supported: payload.supported === true,
    franchiseeId: String(payload.franchiseeId ?? ''),
    storeId: String(payload.storeId ?? ''),
    companyStatus: String(payload.companyStatus ?? ''),
    locked: payload.locked === true,
    reason: String(payload.reason ?? ''),
    targets,
    categories: normalizeCategories(payload.categories),
    dashboard: normalizeDashboardCounts(payload.dashboard),
    reservationSupported: payload.reservationSupported === true,
    reservationMessage: String(payload.reservationMessage ?? ''),
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
    locked: payload.locked === true,
    targets: normalizeTargetCounts(payload.targets),
    deleted: normalizeTargetCounts(payload.deleted),
    failed: normalizeTargetCounts(payload.failed),
    categories: normalizeCategories(payload.categories),
    dashboard: normalizeDashboardCounts(payload.dashboard),
    reservationSupported: payload.reservationSupported === true,
    reservationError: String(payload.reservationError ?? ''),
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
 * Browser-side entry point for selective pre-opening reset.
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
export const preOpeningResetEmptyCategories = emptyCategories
