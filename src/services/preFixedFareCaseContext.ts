import type { PreFixedFareCaseContext } from '../types/preFixedFare'
import { FARE_MODE_PRE_FIXED } from '../types/preFixedFare'
import type { PreFixedMeterSession, PreFixedRouteCandidateId, PreFixedSourceFlow } from '../types/preFixedMeterSession'
import { preFixedRouteCandidateLabels } from '../types/preFixedMeterSession'
import type { ReservationTripContext } from './reservationTripContext'
import type { ReservationCategory } from '../utils/reservationCategory'

const VALID_SOURCE_FLOWS = new Set<PreFixedSourceFlow>([
  'fixed_reservation',
  'normal_reservation',
  'phone_reservation',
  'manual',
])

const SERVICE_FEE_KEYS_EXCLUDED_FROM_ASSIST = new Set(['specialVehicleFee'])

const readViaAddresses = (routePlan: unknown): string[] => {
  if (!routePlan || typeof routePlan !== 'object') {
    return []
  }

  const stops = (routePlan as { stops?: unknown }).stops
  if (!Array.isArray(stops)) {
    return []
  }

  return stops
    .filter((stop) => {
      if (!stop || typeof stop !== 'object') {
        return false
      }
      const role = String((stop as { role?: unknown }).role ?? '').toLowerCase()
      return role === 'via'
    })
    .map((stop) => String((stop as { address?: unknown }).address ?? '').trim())
    .filter((address) => address.length > 0)
}

const resolveRouteLabel = (routeId: string) => {
  const normalized = routeId.trim().toUpperCase()
  if (normalized === 'A' || normalized === 'B' || normalized === 'C' || normalized === 'D') {
    const id = normalized as PreFixedRouteCandidateId
    return `${id} ${preFixedRouteCandidateLabels[id]}`
  }
  return routeId.trim()
}

const resolveSourceFlow = (
  context: ReservationTripContext,
  session?: PreFixedMeterSession | null,
): PreFixedSourceFlow => {
  if (session?.sourceFlow) {
    return session.sourceFlow
  }

  if (VALID_SOURCE_FLOWS.has(context.consent.source as PreFixedSourceFlow)) {
    return context.consent.source as PreFixedSourceFlow
  }

  if (context.reservationId.startsWith('manual-')) {
    return 'manual'
  }

  if (context.quoteSnapshot.preFixedFareConfirmable && context.confirmedFareYen > 0) {
    return 'fixed_reservation'
  }

  return 'normal_reservation'
}

const sourceFlowToCategory = (sourceFlow: PreFixedSourceFlow): ReservationCategory | undefined => {
  if (sourceFlow === 'phone_reservation') {
    return 'phone'
  }
  if (sourceFlow === 'normal_reservation') {
    return 'normal'
  }
  if (sourceFlow === 'fixed_reservation') {
    return 'pre_fixed'
  }
  return undefined
}

const sumAssistFareYen = (context: ReservationTripContext) =>
  (context.quoteSnapshot.serviceFees ?? [])
    .filter((fee) => !SERVICE_FEE_KEYS_EXCLUDED_FROM_ASSIST.has(fee.key))
    .reduce((sum, fee) => sum + Math.max(Math.round(fee.amount), 0), 0)

const sumOtherFareYen = (context: ReservationTripContext) =>
  (context.quoteSnapshot.serviceFees ?? [])
    .filter((fee) => SERVICE_FEE_KEYS_EXCLUDED_FROM_ASSIST.has(fee.key))
    .reduce((sum, fee) => sum + Math.max(Math.round(fee.amount), 0), 0)

export const buildPreFixedFareCaseContext = ({
  tripContext,
  session,
  settlementTotalYen,
  assistFareYen,
  otherFareYen,
}: {
  tripContext: ReservationTripContext
  session?: PreFixedMeterSession | null
  settlementTotalYen?: number
  assistFareYen?: number
  otherFareYen?: number
}): PreFixedFareCaseContext => {
  const sourceFlow = resolveSourceFlow(tripContext, session)
  const selectedRouteId = tripContext.quoteSnapshot.selectedRouteId?.trim() ?? ''
  const consentAt = tripContext.consentAt.trim() || tripContext.consent.consentAt.trim()

  return {
    sourceFlow,
    reservationCategory: sourceFlowToCategory(sourceFlow),
    reservationId: tripContext.reservationId,
    estimateNo: tripContext.estimateNo.trim() || undefined,
    pickupAddress: tripContext.pickupAddress,
    dropoffAddress: tripContext.dropoffAddress,
    viaAddresses: readViaAddresses(tripContext.routePlan),
    selectedRouteId,
    selectedRouteLabel: selectedRouteId ? resolveRouteLabel(selectedRouteId) : undefined,
    preFixedFareYen: Math.max(Math.round(tripContext.confirmedFareYen), 0),
    assistFareYen: assistFareYen ?? sumAssistFareYen(tripContext),
    otherFareYen: otherFareYen ?? sumOtherFareYen(tripContext),
    billingTotalYen:
      settlementTotalYen ??
      (tripContext.fixedFareTotalYen > 0
        ? Math.round(tripContext.fixedFareTotalYen)
        : Math.round(tripContext.confirmedFareYen)),
    consentAt,
    consentAgreed: consentAt.length > 0,
    consentTermsVersion: tripContext.consent.consentTextVersion.trim() || undefined,
    meterMode: 'fixed',
    fareMode: FARE_MODE_PRE_FIXED,
  }
}
