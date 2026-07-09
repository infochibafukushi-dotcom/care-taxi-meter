import type { ActiveTripSnapshot } from './activeTripSnapshot'
import type {
  DriverReservationDetail,
  QuoteSnapshot,
  ReservationConsent,
} from '../types/reservation'
import { isProtectedOperationStatus } from '../utils/meterConstants'
import { resolveReservationIsTest } from '../utils/testReservation'

export const reservationTripContextStorageKey = 'careTaxiMeterReservationTripContext'

export type ReservationTripContext = {
  reservationId: string
  estimateNo: string
  confirmedFareYen: number
  fixedFareTotalYen: number
  snapshotHash: string
  consentAt: string
  pickupAddress: string
  dropoffAddress: string
  isTest?: boolean
  /** 予約 trip.usageSummary（往復/片道判定に使用） */
  usageSummary: string[]
  quoteSnapshot: QuoteSnapshot
  routePlan: unknown | null
  consent: ReservationConsent
  customerName: string
  scheduledAt: string
}

export const buildReservationTripContext = (
  reservation: DriverReservationDetail,
): ReservationTripContext => ({
  reservationId: reservation.reservationId,
  estimateNo: reservation.estimateNo,
  isTest: resolveReservationIsTest(reservation),
  confirmedFareYen: reservation.fixedFare.confirmedFareYen,
  fixedFareTotalYen: reservation.fixedFare.fixedFareTotalYen,
  snapshotHash: reservation.consent.snapshotHash,
  consentAt: reservation.consent.consentAt,
  pickupAddress: reservation.trip.pickupAddress,
  dropoffAddress: reservation.trip.destinationAddress,
  usageSummary: Array.isArray(reservation.trip.usageSummary)
    ? reservation.trip.usageSummary
    : [],
  quoteSnapshot: reservation.quoteSnapshot,
  routePlan: reservation.routePlan,
  consent: reservation.consent,
  customerName: reservation.customer.name,
  scheduledAt: reservation.scheduledAt,
})

/** 既存の同意日時がある場合は上書きせず、未同意時のみ現場同意日時を付与する */
export const buildReservationTripContextForMeterStart = (
  reservation: DriverReservationDetail,
  consentChecked: boolean,
): ReservationTripContext => {
  const baseContext = buildReservationTripContext(reservation)
  const existingConsentAt = baseContext.consentAt.trim()

  if (existingConsentAt || !consentChecked) {
    return baseContext
  }

  const agreedAt = new Date().toISOString()
  return {
    ...baseContext,
    consentAt: agreedAt,
    consent: {
      ...baseContext.consent,
      consentAt: agreedAt,
    },
  }
}

const toFiniteFareYen = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(Math.round(value), 0) : 0

const emptyQuoteSnapshot = (): QuoteSnapshot => ({
  fixedFareTotal: 0,
  serviceFees: [],
  fareMode: 'pre_fixed_fare',
  selectedRouteId: '',
  selectedUsesToll: false,
  distanceMeters: 0,
  durationSeconds: 0,
  preFixedFareConfirmable: true,
})

const emptyConsent = (): ReservationConsent => ({
  consentAt: '',
  consentTextVersion: '',
  snapshotHash: '',
  quotedFareYen: 0,
  source: '',
})

/** sessionStorage / snapshot 由来の旧形式も許容して正規化する */
export const normalizeReservationTripContext = (value: unknown): ReservationTripContext | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const raw = value as Partial<ReservationTripContext>
  const reservationId = typeof raw.reservationId === 'string' ? raw.reservationId.trim() : ''
  if (!reservationId) {
    return null
  }

  const confirmedFareYen = toFiniteFareYen(raw.confirmedFareYen)
  const fixedFareTotalYen = toFiniteFareYen(raw.fixedFareTotalYen) || confirmedFareYen
  const resolvedConfirmedFareYen = confirmedFareYen || fixedFareTotalYen
  const quoteSnapshot =
    raw.quoteSnapshot && typeof raw.quoteSnapshot === 'object'
      ? {
          ...emptyQuoteSnapshot(),
          ...raw.quoteSnapshot,
          serviceFees: Array.isArray(raw.quoteSnapshot.serviceFees)
            ? raw.quoteSnapshot.serviceFees
            : [],
        }
      : {
          ...emptyQuoteSnapshot(),
          fixedFareTotal: resolvedConfirmedFareYen,
        }
  const consentSource =
    raw.consent && typeof raw.consent === 'object' ? raw.consent : emptyConsent()
  const snapshotHash =
    typeof raw.snapshotHash === 'string'
      ? raw.snapshotHash
      : typeof consentSource.snapshotHash === 'string'
        ? consentSource.snapshotHash
        : ''

  return {
    reservationId,
    estimateNo: typeof raw.estimateNo === 'string' ? raw.estimateNo : '',
    confirmedFareYen: resolvedConfirmedFareYen,
    fixedFareTotalYen,
    snapshotHash,
    consentAt: typeof raw.consentAt === 'string' ? raw.consentAt : consentSource.consentAt ?? '',
    pickupAddress: typeof raw.pickupAddress === 'string' ? raw.pickupAddress : '',
    dropoffAddress: typeof raw.dropoffAddress === 'string' ? raw.dropoffAddress : '',
    usageSummary: Array.isArray(raw.usageSummary)
      ? raw.usageSummary.filter((item): item is string => typeof item === 'string')
      : [],
    quoteSnapshot,
    routePlan: raw.routePlan ?? null,
    consent: {
      ...emptyConsent(),
      ...consentSource,
      snapshotHash: snapshotHash || consentSource.snapshotHash || '',
      quotedFareYen:
        toFiniteFareYen(consentSource.quotedFareYen) || fixedFareTotalYen || resolvedConfirmedFareYen,
    },
    customerName: typeof raw.customerName === 'string' ? raw.customerName : '',
    scheduledAt: typeof raw.scheduledAt === 'string' ? raw.scheduledAt : '',
    ...(raw.isTest ? { isTest: true } : {}),
  }
}

export const saveReservationTripContext = (context: ReservationTripContext) => {
  try {
    sessionStorage.setItem(reservationTripContextStorageKey, JSON.stringify(context))
  } catch (error) {
    console.warn('Failed to save reservation trip context.', error)
  }
}

export const readReservationTripContext = (
  reservationId?: string,
): ReservationTripContext | null => {
  try {
    const stored = sessionStorage.getItem(reservationTripContextStorageKey)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored) as unknown
    const normalized = normalizeReservationTripContext(parsed)
    if (!normalized) {
      return null
    }

    if (reservationId && normalized.reservationId !== reservationId) {
      return null
    }

    return normalized
  } catch (error) {
    console.warn('Failed to read reservation trip context.', error)
    return null
  }
}

export const clearReservationTripContext = () => {
  try {
    sessionStorage.removeItem(reservationTripContextStorageKey)
  } catch (error) {
    console.warn('Failed to clear reservation trip context.', error)
  }
}

export const resolvePreFixedConfirmedFareYen = ({
  context = null,
  snapshot = null,
  fixedFareRun = null,
}: {
  context?: ReservationTripContext | null
  snapshot?: ActiveTripSnapshot | null
  fixedFareRun?: { confirmedFareYen: number } | null
} = {}): number => {
  if (fixedFareRun && Number.isFinite(fixedFareRun.confirmedFareYen)) {
    const fromRun = Math.max(Math.round(fixedFareRun.confirmedFareYen), 0)
    if (fromRun > 0) {
      return fromRun
    }
  }

  if (context) {
    const fromConfirmed = Math.max(Math.round(context.confirmedFareYen), 0)
    const fromTotal = Math.max(Math.round(context.fixedFareTotalYen), 0)
    if (fromConfirmed > 0) {
      return fromConfirmed
    }
    if (fromTotal > 0) {
      return fromTotal
    }
  }

  if (snapshot) {
    return Math.max(
      Math.round(snapshot.confirmedFareYen ?? snapshot.fareTotalYen ?? 0),
      0,
    )
  }

  return 0
}

export const logPreFixedRestoreDiagnostics = ({
  fixedFareRun = null,
  reservationTripContext = null,
  operationStartedAt = '',
  status,
  restoredTripSnapshot = null,
}: {
  fixedFareRun?: { confirmedFareYen: number; reservationId: string; snapshotHash: string } | null
  reservationTripContext?: ReservationTripContext | null
  operationStartedAt?: string
  status: string
  restoredTripSnapshot?: ActiveTripSnapshot | null
}) => {
  console.info('[preFixedRestore]', {
    status,
    operationStartedAt: operationStartedAt || null,
    fixedFareRun,
    reservationId: reservationTripContext?.reservationId ?? restoredTripSnapshot?.reservationId ?? null,
    confirmedFareYen: resolvePreFixedConfirmedFareYen({
      context: reservationTripContext,
      snapshot: restoredTripSnapshot,
      fixedFareRun,
    }),
    hasReservationTripContext: Boolean(reservationTripContext),
    snapshotMeterMode: restoredTripSnapshot?.meterMode ?? null,
    snapshotFareTotalYen: restoredTripSnapshot?.fareTotalYen ?? null,
    snapshotHasEmbeddedContext: Boolean(restoredTripSnapshot?.reservationTripContext),
  })
}

/** 運行スナップショットから最低限の予約連携コンテキストを再構築する */
export const buildReservationTripContextFromActiveTripSnapshot = (
  snapshot: ActiveTripSnapshot,
): ReservationTripContext | null => {
  if (snapshot.meterMode !== 'fixed') {
    return null
  }

  if (snapshot.reservationTripContext) {
    return normalizeReservationTripContext(snapshot.reservationTripContext) ?? snapshot.reservationTripContext
  }

  const reservationId = snapshot.reservationId?.trim() ?? ''
  const confirmedFareYen = resolvePreFixedConfirmedFareYen({ snapshot })
  if (!reservationId && confirmedFareYen <= 0) {
    return null
  }

  if (!reservationId) {
    return null
  }
  const pickupAddress = snapshot.pickupLocation?.address?.trim() ?? ''
  const dropoffAddress = snapshot.dropoffLocation?.address?.trim() ?? ''
  const snapshotHash = snapshot.snapshotHash?.trim() ?? ''

  return {
    reservationId,
    estimateNo: '',
    confirmedFareYen,
    fixedFareTotalYen: Math.max(Math.round(snapshot.fareTotalYen ?? confirmedFareYen), 0),
    snapshotHash,
    consentAt: '',
    pickupAddress,
    dropoffAddress,
    usageSummary: [],
    quoteSnapshot: {
      ...emptyQuoteSnapshot(),
      fixedFareTotal: confirmedFareYen,
      selectedRouteId: '',
    },
    routePlan: null,
    consent: {
      ...emptyConsent(),
      snapshotHash,
      quotedFareYen: confirmedFareYen,
    },
    customerName: '',
    scheduledAt: snapshot.capturedAt,
  }
}

export type ResolveReservationTripContextOptions = {
  reservationIdFromQuery?: string
  restoredSnapshot?: ActiveTripSnapshot | null
  readStoredContext?: typeof readReservationTripContext
}

/** メーター画面表示時に sessionStorage・復元スナップショットから予約連携を解決する */
export const resolveReservationTripContextForCasePage = ({
  reservationIdFromQuery = '',
  restoredSnapshot = null,
  readStoredContext = readReservationTripContext,
}: ResolveReservationTripContextOptions = {}): ReservationTripContext | null => {
  const queryReservationId = reservationIdFromQuery.trim()
  const snapshotReservationId = restoredSnapshot?.reservationId?.trim() ?? ''

  if (queryReservationId) {
    return (
      readStoredContext(queryReservationId) ??
      (restoredSnapshot ? buildReservationTripContextFromActiveTripSnapshot(restoredSnapshot) : null)
    )
  }

  const storedContext = readStoredContext()
  if (storedContext) {
    if (!snapshotReservationId || storedContext.reservationId === snapshotReservationId) {
      return storedContext
    }

    return (
      readStoredContext(snapshotReservationId) ??
      buildReservationTripContextFromActiveTripSnapshot(restoredSnapshot!)
    )
  }

  if (restoredSnapshot?.meterMode === 'fixed') {
    return buildReservationTripContextFromActiveTripSnapshot(restoredSnapshot)
  }

  return null
}

export const shouldRestoreFixedFareRunFromSnapshot = (snapshot: ActiveTripSnapshot) =>
  snapshot.meterMode === 'fixed' &&
  typeof snapshot.reservationId === 'string' &&
  snapshot.reservationId.trim().length > 0 &&
  isProtectedOperationStatus(snapshot.status)

/** localStorage 永続化向け。routePlan は preFixedOverallStops と重複し得るため除外する */
export const compactReservationTripContextForSnapshot = (
  context: ReservationTripContext,
): ReservationTripContext => ({
  ...context,
  routePlan: null,
})
