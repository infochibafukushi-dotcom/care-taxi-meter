import type { AssistItem } from './fare'
import type { ReservationTripContext } from './reservationTripContext'
import type {
  PreFixedMeterSession,
  PreFixedRouteCandidateId,
  PreFixedSourceFlow,
  PreFixedTripType,
  RoutePoint,
} from '../types/preFixedMeterSession'
import { PRE_FIXED_CONSENT_TERMS_VERSION } from '../types/preFixedMeterSession'
import type { PreFixedFareRouteStop } from '../types/preFixedFareRouteChange'

export const preFixedMeterSessionStorageKey = 'careTaxiMeterPreFixedSession'

const createSessionId = () =>
  `pfm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const createRoutePoint = (
  partial: Partial<RoutePoint> & Pick<RoutePoint, 'address' | 'source'>,
): RoutePoint => ({
  label: partial.label?.trim() || partial.address.trim() || partial.facilityName?.trim() || '未設定',
  address: partial.address.trim(),
  facilityName: partial.facilityName?.trim() || undefined,
  lat: partial.lat,
  lng: partial.lng,
  source: partial.source,
})

export const tripTypeToUsageSummary = (tripType: PreFixedTripType): string[] => {
  if (tripType === 'one_way') {
    return ['片道']
  }
  if (tripType === 'round_trip') {
    return ['往復']
  }
  return ['立ち寄りあり']
}

const buildRoutePlanFromSession = (session: PreFixedMeterSession) => {
  const stops: PreFixedFareRouteStop[] = [
    {
      id: 'pickup',
      role: 'S',
      label: session.pickup.label,
      address: session.pickup.address,
      latitude: session.pickup.lat ?? null,
      longitude: session.pickup.lng ?? null,
    },
    ...session.stops.map((stop, index) => ({
      id: `via-${index}`,
      role: 'via' as const,
      label: stop.label,
      address: stop.address,
      latitude: stop.lat ?? null,
      longitude: stop.lng ?? null,
    })),
    {
      id: 'destination',
      role: 'G' as const,
      label: session.destination.label,
      address: session.destination.address,
      latitude: session.destination.lat ?? null,
      longitude: session.destination.lng ?? null,
    },
  ]

  return { stops }
}

export const buildTripContextFromPreFixedSession = (
  session: PreFixedMeterSession,
  reservationMeta?: {
    estimateNo?: string
    customerName?: string
    scheduledAt?: string
  },
): ReservationTripContext => {
  const selectedRoute = session.routeCandidates.find((route) => route.id === session.selectedRouteId)
  const serviceFees = session.selectedServiceItems
    .filter((item) => item.enabled)
    .map((item) => ({
      key: item.id,
      label: item.name,
      amount: item.amount,
    }))

  return {
    reservationId: session.reservationId ?? `manual-${session.id}`,
    estimateNo:
      reservationMeta?.estimateNo?.trim() ||
      (session.reservationId ? '' : `現場-${session.id.slice(-8)}`),
    confirmedFareYen: session.fare.fixedFareYen,
    fixedFareTotalYen: session.fare.totalYen,
    snapshotHash: `manual-${session.id}`,
    consentAt: session.consent.agreedAt ?? session.updatedAt,
    pickupAddress: session.pickup.address,
    dropoffAddress: session.destination.address,
    usageSummary: tripTypeToUsageSummary(session.tripType),
    quoteSnapshot: {
      fixedFareTotal: session.fare.fixedFareYen,
      serviceFees,
      fareMode: 'pre_fixed_fare',
      selectedRouteId: session.selectedRouteId,
      selectedUsesToll: selectedRoute?.tollIncluded ?? false,
      distanceMeters: selectedRoute?.distanceMeters ?? 0,
      durationSeconds: selectedRoute?.durationSeconds ?? 0,
      preFixedFareConfirmable: true,
    },
    routePlan: buildRoutePlanFromSession(session),
    consent: {
      consentAt: session.consent.agreedAt ?? '',
      consentTextVersion: session.consent.termsVersion,
      snapshotHash: `manual-${session.id}`,
      quotedFareYen: session.fare.totalYen,
      source: session.sourceFlow,
    },
    customerName: reservationMeta?.customerName?.trim() ?? '',
    scheduledAt: reservationMeta?.scheduledAt?.trim() || session.createdAt,
    isTest: false,
  }
}

export const createPreFixedMeterSession = ({
  sourceFlow,
  tripType,
  pickup,
  stops,
  destination,
  selectedServiceItems,
  routeCandidates,
  selectedRouteId,
  reservationId,
}: {
  sourceFlow: PreFixedSourceFlow
  tripType: PreFixedTripType
  pickup: RoutePoint
  stops: RoutePoint[]
  destination: RoutePoint
  selectedServiceItems: AssistItem[]
  routeCandidates: PreFixedMeterSession['routeCandidates']
  selectedRouteId: PreFixedRouteCandidateId
  reservationId?: string
}): PreFixedMeterSession => {
  const selectedRoute = routeCandidates.find((route) => route.id === selectedRouteId) ?? routeCandidates[0]
  const now = new Date().toISOString()

  return {
    id: createSessionId(),
    meterMode: 'fixed',
    sourceFlow,
    tripType,
    reservationId,
    pickup,
    stops,
    destination,
    selectedServiceItems,
    routeCandidates,
    selectedRouteId,
    fare: {
      fixedFareYen: selectedRoute?.fixedFareYen ?? 0,
      serviceFeesYen: selectedRoute?.serviceFeesYen ?? 0,
      actualExpensesYen: 0,
      totalYen: selectedRoute?.totalYen ?? 0,
    },
    consent: {
      status: 'not_agreed',
      termsVersion: PRE_FIXED_CONSENT_TERMS_VERSION,
    },
    status: 'quoted',
    createdAt: now,
    updatedAt: now,
  }
}

const isPreFixedMeterSession = (value: unknown): value is PreFixedMeterSession => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const session = value as Partial<PreFixedMeterSession>
  return (
    typeof session.id === 'string' &&
    session.meterMode === 'fixed' &&
    typeof session.pickup === 'object' &&
    typeof session.destination === 'object' &&
    Array.isArray(session.routeCandidates)
  )
}

export const savePreFixedMeterSession = (session: PreFixedMeterSession) => {
  try {
    sessionStorage.setItem(preFixedMeterSessionStorageKey, JSON.stringify(session))
  } catch (error) {
    console.warn('Failed to save pre-fixed meter session.', error)
  }
}

export const readPreFixedMeterSession = (sessionId?: string): PreFixedMeterSession | null => {
  try {
    const stored = sessionStorage.getItem(preFixedMeterSessionStorageKey)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored) as unknown
    if (!isPreFixedMeterSession(parsed)) {
      return null
    }

    if (sessionId && parsed.id !== sessionId) {
      return null
    }

    return parsed
  } catch (error) {
    console.warn('Failed to read pre-fixed meter session.', error)
    return null
  }
}

export const clearPreFixedMeterSession = () => {
  try {
    sessionStorage.removeItem(preFixedMeterSessionStorageKey)
  } catch (error) {
    console.warn('Failed to clear pre-fixed meter session.', error)
  }
}

export const agreePreFixedMeterSession = (
  session: PreFixedMeterSession,
  agreedBy?: string,
): PreFixedMeterSession => {
  const agreedAt = new Date().toISOString()
  return {
    ...session,
    consent: {
      status: 'agreed',
      agreedAt,
      agreedBy,
      termsVersion: session.consent.termsVersion,
    },
    status: 'agreed',
    updatedAt: agreedAt,
  }
}
