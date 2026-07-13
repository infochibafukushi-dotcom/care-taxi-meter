import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  basicFareSettings,
  careOptionMaster,
  dispatchMenuMaster,
  formatFareYen,
  specialVehicleMenuMaster,
  type AssistItem,
} from '../services/fare'
import { subscribeMeterSettings, type MeterSettings } from '../services/meterSettings'
import { useWorkSession } from '../hooks/useWorkSession'
import { tenantAccessScopeFromSessionSource } from '../services/tenancy'
import {
  agreePreFixedMeterSession,
  buildTripContextFromPreFixedSession,
  createPreFixedMeterSession,
  createRoutePoint,
  savePreFixedMeterSession,
} from '../services/preFixedMeterSession'
import {
  calculatePreFixedRouteCandidates,
  formatRouteDistanceLabel,
  formatRouteDurationLabel,
  resolveSelectedRouteCandidate,
} from '../services/preFixedRouteQuote'
import {
  applyAssistFeesToRouteCandidates,
  areRequiredAssistStepsComplete,
  assistItemsFromSelectionState,
  buildAssistFeeLineItems,
  calculatePreFixedFareBreakdown,
  computeAssistFeeBreakdown,
  selectionStateFromAssistItems,
} from '../services/preFixedAssistSelection'
import {
  PreFixedAssistStepFlow,
} from '../components/preFixed/PreFixedAssistStepFlow'
import type { PreFixedAssistSelectionState } from '../types/preFixedAssistSelection'
import { createEmptyAssistSelectionState } from '../types/preFixedAssistSelection'
import {
  buildRouteSegmentsFromPoints,
  resolveTripTypeForCreateSession,
} from '../services/preFixedCreateRoute'
import {
  getPreFixedCreateStepAfterTripType,
  getPreFixedManualCreateBackStep,
  getPreFixedManualCreateForwardStep,
  isPreFixedManualCreateStep,
  type PreFixedManualCreateStep,
} from '../services/preFixedCreateFlow'
import {
  buildGpsRoutePoint,
  cloneRoutePoint,
  ensureRoutePointResolved,
  ensureRoutePointsResolved,
  formatRoutePointDisplayLines,
  GPS_ADDRESS_FETCH_ERROR_MESSAGE,
  GPS_POSITION_FETCH_ERROR_MESSAGE,
  isRoutePointResolved,
  LOCATION_RESOLVE_ERROR_MESSAGE,
  PLACE_SELECTION_REQUIRED_MESSAGE,
} from '../services/resolveRoutePoint'
import { PreFixedRouteMapPanel } from '../components/preFixed/PreFixedRouteMapPanel'
import { PreFixedLocationInput } from '../components/preFixed/PreFixedLocationInput'
import { fetchDriverReservation, startFixedFareRun } from '../services/reservationApi'
import { saveReservationTripContext } from '../services/reservationTripContext'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import type { DriverReservationDetail } from '../types/reservation'
import type { ReservationServiceFee } from '../types/reservation'
import type {
  PreFixedRouteCandidate,
  PreFixedRouteCandidateId,
  PreFixedSourceFlow,
  RoutePoint,
} from '../types/preFixedMeterSession'
import { captureAddressLocationFromCoordinates } from '../utils/reverseGeocode'
import { resolveReservationCategory } from '../utils/reservationCategory'
import {
  formatRoutePointOverviewLines,
  isCoordinatePairText,
} from '../utils/routePointDisplay'

type CreateStep = PreFixedManualCreateStep

type TripTypeChoice = 'one_way' | 'round_or_via'

const tripTypeChoiceLabels: Record<TripTypeChoice, string> = {
  one_way: '直行（経由なし）',
  round_or_via: '経由あり・複数区間',
}

const createEmptyStop = (): RoutePoint =>
  createRoutePoint({ label: '', address: '', source: 'manual' })

const ROUTE_FETCH_ERROR_MESSAGE =
  'ルートを取得できませんでした。もう一度検索してください。'

const FINAL_DESTINATION_REQUIRED_MESSAGE = '最終目的地を入力してください'

const cloneAssistItems = (items: AssistItem[]) =>
  items.map((item) => ({ ...item, enabled: false }))

const normalizeAssistItemName = (name: string) => name.replace(/\s+/g, '').trim()

/** 同一 id、または正規化名＋金額で重複を除去する（先勝ち） */
const dedupeAssistItems = (items: AssistItem[]): AssistItem[] => {
  const seenIds = new Set<string>()
  const seenNameAmount = new Set<string>()
  const result: AssistItem[] = []

  for (const item of items) {
    const id = item.id.trim()
    const nameAmountKey = `${normalizeAssistItemName(item.name)}::${item.amount}`

    if (id && seenIds.has(id)) {
      continue
    }
    if (item.name.trim() && seenNameAmount.has(nameAmountKey)) {
      continue
    }

    if (id) {
      seenIds.add(id)
    }
    if (item.name.trim()) {
      seenNameAmount.add(nameAmountKey)
    }
    result.push(item)
  }

  return result
}

type AssistItemSources = {
  assistItems: AssistItem[]
  dispatchMenuItems: AssistItem[]
  specialVehicleMenuItems: AssistItem[]
}

const defaultAssistItemSources = (): AssistItemSources => ({
  assistItems: careOptionMaster,
  dispatchMenuItems: dispatchMenuMaster,
  specialVehicleMenuItems: specialVehicleMenuMaster,
})

const buildAssistItemList = (sources: AssistItemSources = defaultAssistItemSources()): AssistItem[] =>
  dedupeAssistItems([
    ...cloneAssistItems(sources.assistItems.filter((item) => item.enabled)),
    ...cloneAssistItems(sources.dispatchMenuItems.filter((item) => item.enabled)),
    ...cloneAssistItems(sources.specialVehicleMenuItems.filter((item) => item.enabled)),
    {
      id: 'escortPlanned',
      name: '付き添い予定あり',
      amount: 0,
      enabled: false,
      sortOrder: 90,
    },
    {
      id: 'waitingPlanned',
      name: '待機予定あり',
      amount: 0,
      enabled: false,
      sortOrder: 91,
    },
  ])

const mergeAssistItemSelections = (
  nextItems: AssistItem[],
  previousItems: AssistItem[],
): AssistItem[] => {
  const previousById = new Map(previousItems.map((item) => [item.id, item]))
  return nextItems.map((item) => {
    const previous = previousById.get(item.id)
    if (!previous) {
      return item
    }
    return {
      ...item,
      enabled: previous.enabled,
    }
  })
}

const buildAssistItemsFromReservation = (
  serviceFees: ReservationServiceFee[],
  sources: AssistItemSources = defaultAssistItemSources(),
): AssistItem[] => {
  const baseItems = buildAssistItemList(sources)
  const matchedKeys = new Set<string>()

  const merged = baseItems.map((item) => {
    const fee = serviceFees.find((entry) => entry.key === item.id && entry.amount > 0)
    if (!fee) {
      return item
    }
    matchedKeys.add(fee.key)
    return {
      ...item,
      enabled: true,
      name: fee.label.trim() || item.name,
    }
  })

  const extraFees = serviceFees
    .filter((fee) => fee.amount > 0 && !matchedKeys.has(fee.key))
    .map((fee, index) => ({
      id: fee.key,
      name: fee.label.trim() || fee.key,
      amount: fee.amount,
      enabled: true,
      sortOrder: 100 + index,
    }))

  return [...merged, ...extraFees]
}

const resolveSourceFlow = (reservation: DriverReservationDetail | null): PreFixedSourceFlow => {
  if (!reservation) {
    return 'manual'
  }
  return resolveReservationCategory(reservation) === 'phone'
    ? 'phone_reservation'
    : 'normal_reservation'
}

export function PreFixedCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const workSession = useWorkSession()
  const accessScope = useMemo(
    () => tenantAccessScopeFromSessionSource(workSession.currentSession),
    [workSession.currentSession],
  )
  const vehicleId = searchParams.get('vehicleId')?.trim() ?? ''
  const reservationId = searchParams.get('reservationId')?.trim() ?? ''
  const isFromReservation = reservationId.length > 0
  const menuPath = vehicleId
    ? `/case/pre-fixed?vehicleId=${encodeURIComponent(vehicleId)}`
    : '/case/pre-fixed'
  const listPath = vehicleId
    ? `/case/pre-fixed/reservations?vehicleId=${encodeURIComponent(vehicleId)}`
    : '/case/pre-fixed/reservations'

  const [step, setStep] = useState<CreateStep>('trip-type')
  const [tripTypeChoice, setTripTypeChoice] = useState<TripTypeChoice>('one_way')
  const [assistItemSources, setAssistItemSources] = useState<AssistItemSources>(defaultAssistItemSources)
  const [currentBasicFareSettings, setCurrentBasicFareSettings] = useState(basicFareSettings)
  const [assistItems, setAssistItems] = useState<AssistItem[]>(() => buildAssistItemList())
  const [assistSelection, setAssistSelection] = useState<PreFixedAssistSelectionState>(() =>
    createEmptyAssistSelectionState(),
  )
  const [assistStepError, setAssistStepError] = useState('')
  const linkedReservationRef = useRef<DriverReservationDetail | null>(null)
  const assistItemSourcesRef = useRef(assistItemSources)
  const [pickup, setPickup] = useState<RoutePoint>(() =>
    createRoutePoint({ address: '', label: '', source: 'manual' }),
  )
  const [viaStops, setViaStops] = useState<RoutePoint[]>([])
  const [finalDestination, setFinalDestination] = useState<RoutePoint>(() => createEmptyStop())
  const [destinationLinkedToPickup, setDestinationLinkedToPickup] = useState(false)
  const [facilitySearchText, setFacilitySearchText] = useState('')
  const [pickupMessage, setPickupMessage] = useState('')
  const [isLocating, setIsLocating] = useState(false)
  const [locatingTarget, setLocatingTarget] = useState<'pickup' | 'via' | 'final' | null>(null)
  const [locatingViaIndex, setLocatingViaIndex] = useState(0)
  const [locationResolving, setLocationResolving] = useState(false)
  const [routeCandidates, setRouteCandidates] = useState<PreFixedRouteCandidate[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<PreFixedRouteCandidateId | ''>('')
  const [isCalculatingRoutes, setIsCalculatingRoutes] = useState(false)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeCalculated, setRouteCalculated] = useState(false)
  const [routeRendered, setRouteRendered] = useState(false)
  const [fareCalculated, setFareCalculated] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [routeRequestId, setRouteRequestId] = useState(0)
  const routeRequestIdRef = useRef(0)
  const draftHydratedRef = useRef(false)
  const [draftReady, setDraftReady] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [stepError, setStepError] = useState('')
  const [destinationFieldErrors, setDestinationFieldErrors] = useState<Record<string, string>>({})
  const [isStarting, setIsStarting] = useState(false)
  const [linkedReservation, setLinkedReservation] = useState<DriverReservationDetail | null>(null)
  const [reservationLoadError, setReservationLoadError] = useState('')
  const [isLoadingReservation, setIsLoadingReservation] = useState(isFromReservation)
  const [mapWarning, setMapWarning] = useState('')

  const createDraftStorageKey = useMemo(
    () =>
      `careTaxiMeterPreFixedCreateDraft:${vehicleId || 'none'}:${reservationId || 'manual'}`,
    [vehicleId, reservationId],
  )

  useEffect(() => {
    linkedReservationRef.current = linkedReservation
  }, [linkedReservation])

  useEffect(() => {
    assistItemSourcesRef.current = assistItemSources
  }, [assistItemSources])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(createDraftStorageKey)
      if (!raw) {
        return
      }
      const draft = JSON.parse(raw) as {
        step?: CreateStep
        assistSelection?: PreFixedAssistSelectionState
        assistItems?: AssistItem[]
        assistFeesYen?: number
        routeFareYen?: number
        totalEstimatedFareYen?: number
        routeCandidates?: PreFixedRouteCandidate[]
        selectedRouteId?: PreFixedRouteCandidateId | ''
        routeCalculated?: boolean
        routeRendered?: boolean
        fareCalculated?: boolean
        tripTypeChoice?: TripTypeChoice
        pickup?: RoutePoint
        viaStops?: RoutePoint[]
        finalDestination?: RoutePoint
        destinationLinkedToPickup?: boolean
      }

      // 旧下書きは assistItems のみの場合がある → 段階式 state へ変換
      let restoredSelection = draft.assistSelection
      let restoredItems = Array.isArray(draft.assistItems) ? draft.assistItems : undefined
      if (!restoredSelection && restoredItems) {
        restoredSelection = selectionStateFromAssistItems(restoredItems)
      }
      if (restoredSelection) {
        setAssistSelection(restoredSelection)
      }
      if (restoredItems) {
        setAssistItems(restoredItems)
      } else if (restoredSelection) {
        setAssistItems(
          assistItemsFromSelectionState(restoredSelection, buildAssistItemList()),
        )
      }

      if (Array.isArray(draft.routeCandidates) && draft.routeCandidates.length > 0) {
        const assistYen =
          typeof draft.assistFeesYen === 'number'
            ? draft.assistFeesYen
            : restoredSelection
              ? computeAssistFeeBreakdown(restoredSelection).serviceTotal
              : 0
        // fixedFareYen は維持し assist だけ差し替え（二重加算防止）
        const withFees = applyAssistFeesToRouteCandidates(draft.routeCandidates, assistYen)
        setRouteCandidates(withFees)
        setSelectedRouteId(draft.selectedRouteId || withFees[0]?.id || 'A')
        setRouteCalculated(Boolean(draft.routeCalculated))
        setRouteRendered(Boolean(draft.routeRendered))
        setFareCalculated(Boolean(draft.fareCalculated))
      }
      if (draft.tripTypeChoice) {
        setTripTypeChoice(draft.tripTypeChoice)
      }
      if (draft.pickup) {
        setPickup(draft.pickup)
      }
      if (Array.isArray(draft.viaStops)) {
        setViaStops(draft.viaStops)
      }
      if (draft.finalDestination) {
        setFinalDestination(draft.finalDestination)
      }
      if (typeof draft.destinationLinkedToPickup === 'boolean') {
        setDestinationLinkedToPickup(draft.destinationLinkedToPickup)
      }
      // 経由あり選択だけでは G=S にしない。下書きのリンク状態のみ尊重する。
      if (draft.tripTypeChoice === 'round_or_via') {
        if (!Array.isArray(draft.viaStops) || draft.viaStops.length === 0) {
          setViaStops([createEmptyStop()])
        }
      }
      if (isPreFixedManualCreateStep(draft.step)) {
        setStep(draft.step)
      }
    } catch {
      // 下書き復元失敗時は通常開始
    } finally {
      draftHydratedRef.current = true
      setDraftReady(true)
    }
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createDraftStorageKey])

  useEffect(() => {
    if (!draftReady) {
      return
    }
    try {
      const selected =
        routeCandidates.find((route) => route.id === selectedRouteId) ?? routeCandidates[0]
      const feesYen = computeAssistFeeBreakdown(assistSelection).serviceTotal
      const routeFareYen = selected?.fixedFareYen ?? 0
      const breakdown = calculatePreFixedFareBreakdown({
        routeFareYen,
        assistFeesYen: feesYen,
      })
      sessionStorage.setItem(
        createDraftStorageKey,
        JSON.stringify({
          step,
          assistSelection,
          assistItems,
          assistFeesYen: breakdown.assistFeesYen,
          routeFareYen: breakdown.routeFareYen,
          totalEstimatedFareYen: breakdown.totalEstimatedFareYen,
          selectedRouteId,
          routeCandidates,
          routeCalculated,
          routeRendered,
          fareCalculated,
          tripTypeChoice,
          pickup,
          viaStops,
          finalDestination,
          destinationLinkedToPickup,
        }),
      )
    } catch {
      // quota / private mode
    }
  }, [
    draftReady,
    createDraftStorageKey,
    step,
    assistSelection,
    assistItems,
    routeCandidates,
    selectedRouteId,
    routeCalculated,
    routeRendered,
    fareCalculated,
    tripTypeChoice,
    pickup,
    viaStops,
    finalDestination,
    destinationLinkedToPickup,
  ])

  useEffect(() => {
    const franchiseeId = accessScope.franchiseeId
    const storeId = accessScope.storeId
    if (!franchiseeId || !storeId) {
      return
    }

    const unsubscribe = subscribeMeterSettings(
      { franchiseeId, storeId },
      (settings: MeterSettings) => {
        const sources: AssistItemSources = {
          assistItems: settings.assistItems,
          dispatchMenuItems: settings.dispatchMenuItems,
          specialVehicleMenuItems: settings.specialVehicleMenuItems,
        }
        setAssistItemSources(sources)
        setCurrentBasicFareSettings(settings.basicFare)
        setAssistItems((current) => {
          const reservation = linkedReservationRef.current
          const next = reservation
            ? buildAssistItemsFromReservation(reservation.quoteSnapshot.serviceFees, sources)
            : mergeAssistItemSelections(buildAssistItemList(sources), current)
          setAssistSelection(selectionStateFromAssistItems(next))
          return next
        })
      },
    )

    return unsubscribe
  }, [accessScope.franchiseeId, accessScope.storeId])

  useEffect(() => {
    if (!isFromReservation) {
      return
    }

    let isMounted = true
    setIsLoadingReservation(true)
    setReservationLoadError('')

    fetchDriverReservation(reservationId)
      .then((detail) => {
        if (!isMounted) {
          return
        }
        setLinkedReservation(detail)
        const pickupAddress = detail.trip.pickupAddress.trim()
        if (pickupAddress) {
          setPickup(
            createRoutePoint({
              address: pickupAddress,
              label: pickupAddress,
              source: 'reservation',
            }),
          )
        } else {
          setPickupMessage('お迎え住所が予約データから取得できません。住所を手入力してください。')
        }
        setAssistItems(
          buildAssistItemsFromReservation(
            detail.quoteSnapshot.serviceFees,
            assistItemSourcesRef.current,
          ),
        )
        setAssistSelection(
          selectionStateFromAssistItems(
            buildAssistItemsFromReservation(
              detail.quoteSnapshot.serviceFees,
              assistItemSourcesRef.current,
            ),
          ),
        )
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }
        setReservationLoadError(
          error instanceof Error ? error.message : '予約詳細の取得に失敗しました。',
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingReservation(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isFromReservation, reservationId])

  const selectedRouteCandidate = useMemo(() => {
    return resolveSelectedRouteCandidate(routeCandidates, selectedRouteId || 'A')
  }, [routeCandidates, selectedRouteId])

  useEffect(() => {
    if (routeCandidates.length === 0) {
      return
    }
    const resolved = resolveSelectedRouteCandidate(routeCandidates, selectedRouteId || 'A')
    if (resolved && resolved.id !== selectedRouteId) {
      setSelectedRouteId(resolved.id)
    }
  }, [routeCandidates, selectedRouteId])

  const fareDisplayAllowed = useMemo(
    () =>
      routeCalculated &&
      routeRendered &&
      fareCalculated &&
      routeCandidates.length > 0 &&
      selectedRouteCandidate != null &&
      !routeError,
    [
      routeCalculated,
      routeRendered,
      fareCalculated,
      routeCandidates.length,
      selectedRouteCandidate,
      routeError,
    ],
  )

  const selectedRoute = useMemo(
    () => (fareDisplayAllowed ? selectedRouteCandidate : null),
    [fareDisplayAllowed, selectedRouteCandidate],
  )

  const markerPoints = useMemo(() => {
    const segments = buildRouteSegmentsFromPoints({
      pickup,
      viaStops,
      finalDestination,
    })
    if (!segments) {
      return [pickup].filter((point) => isRoutePointResolved(point))
    }
    return [segments.origin, ...segments.stops, segments.destination].filter((point) =>
      isRoutePointResolved(point),
    )
  }, [pickup, viaStops, finalDestination])

  const fallbackMapCenter = useMemo(() => {
    if (typeof pickup.lat === 'number' && typeof pickup.lng === 'number') {
      return { lat: pickup.lat, lng: pickup.lng }
    }
    return null
  }, [pickup.lat, pickup.lng])

  const clearRouteResults = useCallback(() => {
    setRouteCandidates([])
    setSelectedRouteId('')
    setRouteCalculated(false)
    setRouteRendered(false)
    setFareCalculated(false)
    setMapWarning('')
    setRouteError('')
  }, [])

  const applyPickupPoint = useCallback(
    (point: RoutePoint) => {
      clearRouteResults()
      setPickup(point)
      setPickupMessage('')
      if (destinationLinkedToPickup) {
        setFinalDestination(cloneRoutePoint(point))
      }
    },
    [clearRouteResults, destinationLinkedToPickup],
  )

  const copyPickupToFinalDestination = useCallback(() => {
    if (!isRoutePointResolved(pickup)) {
      setStepError('先に出発地（お迎え地）を入力してください。')
      return
    }
    clearRouteResults()
    setFinalDestination(cloneRoutePoint(pickup))
    setDestinationLinkedToPickup(true)
    setDestinationFieldErrors((current) => {
      const next = { ...current }
      delete next.final
      return next
    })
    setStepError('')
  }, [clearRouteResults, pickup])

  const assistFeesYen = useMemo(
    () => computeAssistFeeBreakdown(assistSelection).serviceTotal,
    [assistSelection],
  )

  const assistFeeLineItems = useMemo(
    () => buildAssistFeeLineItems(assistSelection),
    [assistSelection],
  )

  const applyAssistSelection = useCallback(
    (next: PreFixedAssistSelectionState) => {
      const fees = computeAssistFeeBreakdown(next)
      const nextItems = assistItemsFromSelectionState(next, buildAssistItemList(assistItemSources))
      setAssistSelection(next)
      setAssistItems(nextItems)
      setAssistStepError('')
      // Directions 再取得なし。routeFareYen(fixedFareYen)は維持し assist だけ更新。
      setRouteCandidates((current) =>
        current.length === 0
          ? current
          : applyAssistFeesToRouteCandidates(current, fees.serviceTotal),
      )
    },
    [assistItemSources],
  )

  const captureCurrentLocation = useCallback(
    (target: 'pickup' | 'via' | 'final', viaIndex = 0) => {
      const fieldKey =
        target === 'via' ? `via-${viaIndex}` : target === 'final' ? 'final' : 'pickup'

      if (!('geolocation' in navigator)) {
        setDestinationFieldErrors((current) => ({
          ...current,
          [fieldKey]: 'この端末では現在地取得を利用できません。',
        }))
        return
      }

      setIsLocating(true)
      setLocatingTarget(target)
      setLocatingViaIndex(viaIndex)
      setStepError('')
      setDestinationFieldErrors((current) => {
        const next = { ...current }
        delete next[fieldKey]
        return next
      })

      // HEAD と同じ GPS 条件（enableHighAccuracy + timeout のみ。maximumAge は指定しない）
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude
          const longitude = position.coords.longitude

          const applyPoint = (point: RoutePoint) => {
            if (target === 'pickup') {
              applyPickupPoint(point)
            } else if (target === 'final') {
              setFinalDestination(point)
              setDestinationLinkedToPickup(false)
            } else {
              setViaStops((current) =>
                current.map((visit, index) => (index === viaIndex ? point : visit)),
              )
            }
          }

          // GPS 成功後にのみ逆ジオ（失敗は住所エラーとして分離）
          void (async () => {
            try {
              const geocoded = await captureAddressLocationFromCoordinates({
                capturedAt: new Date(position.timestamp).toISOString(),
                latitude,
                longitude,
              })
              const address = geocoded.address.trim()

              if (!address || isCoordinatePairText(address)) {
                applyPoint(buildGpsRoutePoint({ latitude, longitude }))
                setDestinationFieldErrors((current) => ({
                  ...current,
                  [fieldKey]: GPS_ADDRESS_FETCH_ERROR_MESSAGE,
                }))
                return
              }

              applyPoint(buildGpsRoutePoint({ latitude, longitude, address }))
              setDestinationFieldErrors((current) => {
                const next = { ...current }
                delete next[fieldKey]
                return next
              })
            } catch {
              applyPoint(buildGpsRoutePoint({ latitude, longitude }))
              setDestinationFieldErrors((current) => ({
                ...current,
                [fieldKey]: GPS_ADDRESS_FETCH_ERROR_MESSAGE,
              }))
            } finally {
              setIsLocating(false)
              setLocatingTarget(null)
            }
          })()
        },
        () => {
          setDestinationFieldErrors((current) => ({
            ...current,
            [fieldKey]: GPS_POSITION_FETCH_ERROR_MESSAGE,
          }))
          setIsLocating(false)
          setLocatingTarget(null)
        },
        { enableHighAccuracy: true, timeout: 10000 },
      )
    },
    [applyPickupPoint],
  )

  const applyFacilitySearch = async (target: 'pickup' | 'via' | 'final', viaIndex = 0) => {
    const query = facilitySearchText.trim()
    if (!query) {
      setStepError('施設名を入力してください。')
      return
    }

    setLocationResolving(true)
    setStepError('')
    try {
      const point = await ensureRoutePointResolved(
        createRoutePoint({
          address: query,
          label: query,
          facilityName: query,
          source: 'facility_search',
        }),
      )

      if (target === 'pickup') {
        applyPickupPoint(point)
        setPickupMessage('')
      } else if (target === 'final') {
        setFinalDestination(point)
        setDestinationLinkedToPickup(false)
      } else {
        setViaStops((current) =>
          current.map((visit, index) => (index === viaIndex ? point : visit)),
        )
      }
      setFacilitySearchText('')
    } catch {
      setStepError(LOCATION_RESOLVE_ERROR_MESSAGE)
    } finally {
      setLocationResolving(false)
    }
  }

  const updateManualPoint = (
    value: string,
    target: 'pickup' | 'via' | 'final',
    viaIndex = 0,
  ) => {
    clearRouteResults()
    const point = createRoutePoint({
      address: value,
      label: value,
      source: 'manual',
    })
    if (target === 'pickup') {
      applyPickupPoint(point)
      return
    }
    if (target === 'final') {
      setFinalDestination(point)
      setDestinationLinkedToPickup(false)
      return
    }
    setViaStops((current) =>
      current.map((item, itemIndex) => (itemIndex === viaIndex ? point : item)),
    )
  }

  const validatePickup = () => {
    if (!isRoutePointResolved(pickup)) {
      setStepError('お迎え地Sを入力してください。')
      return false
    }
    setStepError('')
    return true
  }

  const validateDestinations = () => {
    const errors: Record<string, string> = {}
    if (!destinationLinkedToPickup && !isRoutePointResolved(finalDestination)) {
      errors.final =
        finalDestination.address.trim() && !isCoordinatePairText(finalDestination.address)
          ? PLACE_SELECTION_REQUIRED_MESSAGE
          : FINAL_DESTINATION_REQUIRED_MESSAGE
    }
    viaStops.forEach((stop, index) => {
      if (!stop.address.trim() && !stop.facilityName?.trim() && !stop.label.trim()) {
        // 空の経由地はスキップ対象（追加したが未入力）→ エラーにしない／除外は loadRoutes 側
        return
      }
      if (!isRoutePointResolved(stop)) {
        errors[`via-${index}`] = PLACE_SELECTION_REQUIRED_MESSAGE
      }
    })
    if (tripTypeChoice === 'round_or_via') {
      const hasResolvedVia = viaStops.some((stop) => isRoutePointResolved(stop))
      if (!hasResolvedVia) {
        errors['via-0'] = '経由ありでは経由地を1つ以上入力してください。'
      }
    }
    setDestinationFieldErrors(errors)
    setStepError('')
    return Object.keys(errors).length === 0
  }

  const loadRoutes = async () => {
    // 古い routeError / 候補を先に消す（検証失敗時に前回エラーが残らないようにする）
    clearRouteResults()

    if (!validatePickup() || !validateDestinations()) {
      return
    }

    const requestId = routeRequestIdRef.current + 1
    routeRequestIdRef.current = requestId
    setRouteRequestId(requestId)
    setIsCalculatingRoutes(true)
    setRouteLoading(true)
    setLocationResolving(true)
    setStepError('')

    try {
      const activeViaStops =
        tripTypeChoice === 'one_way'
          ? []
          : viaStops.filter((stop) => isRoutePointResolved(stop))
      const effectiveDestination = destinationLinkedToPickup
        ? cloneRoutePoint(pickup)
        : finalDestination
      const resolveTargets = [pickup, ...activeViaStops, effectiveDestination]

      const unresolvedIndex = resolveTargets.findIndex((point) => !isRoutePointResolved(point))
      if (unresolvedIndex >= 0) {
        const fieldKey =
          unresolvedIndex === 0
            ? 'pickup'
            : unresolvedIndex === resolveTargets.length - 1
              ? 'final'
              : `via-${unresolvedIndex - 1}`
        if (fieldKey === 'pickup') {
          setStepError(PLACE_SELECTION_REQUIRED_MESSAGE)
        } else {
          setDestinationFieldErrors({ [fieldKey]: PLACE_SELECTION_REQUIRED_MESSAGE })
        }
        return
      }

      const { resolved, failedIndex } = await ensureRoutePointsResolved(resolveTargets)
      if (requestId !== routeRequestIdRef.current) {
        return
      }

      if (failedIndex != null) {
        const fieldKey =
          failedIndex === 0
            ? 'pickup'
            : failedIndex === resolveTargets.length - 1
              ? 'final'
              : `via-${failedIndex - 1}`
        if (fieldKey === 'pickup') {
          setStepError(LOCATION_RESOLVE_ERROR_MESSAGE)
          setDestinationFieldErrors({})
        } else {
          setDestinationFieldErrors({ [fieldKey]: PLACE_SELECTION_REQUIRED_MESSAGE })
          setStepError('')
        }
        return
      }

      setDestinationFieldErrors({})

      const [resolvedPickup, ...rest] = resolved
      const resolvedDestination = rest[rest.length - 1]
      const resolvedVias = rest.slice(0, -1)

      setPickup(resolvedPickup)
      setViaStops(tripTypeChoice === 'one_way' ? [] : resolvedVias)
      if (destinationLinkedToPickup) {
        setFinalDestination(cloneRoutePoint(resolvedPickup))
      } else {
        setFinalDestination(resolvedDestination)
      }

      const segments = buildRouteSegmentsFromPoints({
        pickup: resolvedPickup,
        viaStops: tripTypeChoice === 'one_way' ? [] : resolvedVias,
        finalDestination: destinationLinkedToPickup
          ? cloneRoutePoint(resolvedPickup)
          : resolvedDestination,
      })
      if (!segments) {
        setStepError(FINAL_DESTINATION_REQUIRED_MESSAGE)
        return
      }

      setLocationResolving(false)

      const candidates = await calculatePreFixedRouteCandidates({
        pickup: segments.origin,
        stops: segments.stops,
        destination: segments.destination,
        // ルート運賃のみ算定。介助料金は別途 applyAssistFeesToRouteCandidates で加算する。
        serviceItems: assistItems.map((item) => ({ ...item, enabled: false })),
        basicFare: currentBasicFareSettings,
        allowFallback: false,
        requirePolyline: true,
      })

      if (requestId !== routeRequestIdRef.current) {
        return
      }

      if (candidates.length === 0) {
        clearRouteResults()
        setRouteError(ROUTE_FETCH_ERROR_MESSAGE)
        // 入力画面に留まり、API失敗を下部へ表示
        return
      }

      const assistFees = computeAssistFeeBreakdown(assistSelection)
      const withAssistFees = applyAssistFeesToRouteCandidates(
        candidates,
        assistFees.serviceTotal,
      )
      setRouteCandidates(withAssistFees)
      const initial = resolveSelectedRouteCandidate(withAssistFees, 'A')
      setSelectedRouteId(initial?.id ?? withAssistFees[0]?.id ?? 'A')
      setRouteCalculated(true)
      setRouteRendered(false)
      setFareCalculated(false)
      setRouteError('')
      setStep('routes')
    } catch (error) {
      if (requestId !== routeRequestIdRef.current) {
        return
      }
      clearRouteResults()
      setRouteError(
        error instanceof Error && error.message
          ? error.message
          : ROUTE_FETCH_ERROR_MESSAGE,
      )
    } finally {
      if (requestId === routeRequestIdRef.current) {
        setIsCalculatingRoutes(false)
        setRouteLoading(false)
        setLocationResolving(false)
      }
    }
  }

  const handleMapRenderResult = useCallback(
    (result: { success: boolean; message?: string; requestId?: number }) => {
      if (result.requestId != null && result.requestId !== routeRequestIdRef.current) {
        return
      }
      if (!routeCalculated) {
        return
      }
      if (result.success) {
        setRouteRendered(true)
        setFareCalculated(true)
        setMapWarning('')
        setRouteError('')
        return
      }
      setRouteRendered(false)
      setFareCalculated(false)
      setRouteCalculated(false)
      setMapWarning(result.message || 'ルート線を表示できませんでした')
      setRouteError(ROUTE_FETCH_ERROR_MESSAGE)
      setRouteCandidates([])
      setSelectedRouteId('')
    },
    [routeCalculated],
  )

  const handleAgreeAndProceed = async () => {
    if (!consentChecked) {
      setConsentError('ルートと金額への同意を確認してください。')
      return
    }

    if (!fareDisplayAllowed || !selectedRoute) {
      setConsentError('ルートを選択してください。')
      return
    }

    if (readActiveTripSnapshot()) {
      setConsentError(
        '未終了の運行があります。開始前にメーター画面で運行を終了または復元してください。',
      )
      return
    }

    setIsStarting(true)
    setConsentError('')

    try {
      const segments = buildRouteSegmentsFromPoints({
        pickup,
        viaStops: tripTypeChoice === 'one_way' ? [] : viaStops,
        finalDestination: destinationLinkedToPickup
          ? cloneRoutePoint(pickup)
          : finalDestination,
      })
      if (!segments) {
        setConsentError('訪問先を確認してください。')
        return
      }

      if (!fareDisplayAllowed || !selectedRoute) {
        setConsentError('ルート描画が完了してから同意してください。')
        return
      }

      const resolvedTripType = resolveTripTypeForCreateSession({
        tripTypeChoice,
        destinationLinkedToPickup,
        viaCount: segments.stops.length,
      })

      const session = createPreFixedMeterSession({
        sourceFlow: resolveSourceFlow(linkedReservation),
        tripType: resolvedTripType,
        pickup: segments.origin,
        stops: segments.stops,
        destination: segments.destination,
        selectedServiceItems: assistItems.filter((item) => item.enabled),
        routeCandidates,
        selectedRouteId: selectedRoute.id,
        reservationId: linkedReservation?.reservationId,
      })

      const agreedSession = agreePreFixedMeterSession(session)
      savePreFixedMeterSession(agreedSession)
      saveReservationTripContext(
        buildTripContextFromPreFixedSession(
          agreedSession,
          linkedReservation
            ? {
                estimateNo: linkedReservation.estimateNo,
                customerName: linkedReservation.customer.name,
                scheduledAt: linkedReservation.scheduledAt,
              }
            : undefined,
        ),
      )

      if (linkedReservation) {
        try {
          await startFixedFareRun(linkedReservation.reservationId)
        } catch {
          // 予約APIが未対応でも、同意済みセッションでメーター開始を継続する。
        }

        const query = new URLSearchParams({
          reservationId: linkedReservation.reservationId,
          meterMode: 'fixed',
          preFixedSessionId: agreedSession.id,
        })
        if (vehicleId) {
          query.set('vehicleId', vehicleId)
        }
        navigate(`/case?${query.toString()}`)
        return
      }

      const query = new URLSearchParams({
        meterMode: 'fixed',
        preFixedSessionId: agreedSession.id,
      })
      if (vehicleId) {
        query.set('vehicleId', vehicleId)
      }

      navigate(`/case?${query.toString()}`)
    } finally {
      setIsStarting(false)
    }
  }

  const isMultiStopChoice = tripTypeChoice === 'round_or_via'
  const returnsToOrigin = destinationLinkedToPickup

  const ensureMultiStopViaSlot = useCallback(() => {
    setViaStops((current) => (current.length === 0 ? [createEmptyStop()] : current))
  }, [])

  const handleTripTypeNext = () => {
    if (isFromReservation && !pickup.address.trim()) {
      setStepError('予約のお迎え地が取得できません。予約内容を確認してください。')
      return
    }
    if (tripTypeChoice === 'round_or_via') {
      ensureMultiStopViaSlot()
    } else {
      setViaStops([])
    }
    setStepError('')
    setStep(getPreFixedCreateStepAfterTripType(isFromReservation))
  }

  const renderBackLink = () => {
    if (isFromReservation) {
      return (
        <Link className="text-link" to={listPath}>
          ← 予約一覧に戻る
        </Link>
      )
    }
    return (
      <Link className="text-link" to={menuPath}>
        ← 事前確定運賃メニューへ
      </Link>
    )
  }

  const renderTripTypeStep = () => (
    <section className="content-card pre-fixed-flow-card">
      {renderBackLink()}
      <p className="eyebrow">Trip Type</p>
      <h1>{isFromReservation ? 'ルート種別を選択' : '送迎タイプを選択'}</h1>

      {isLoadingReservation ? <p className="empty-note">予約情報を読み込み中です。</p> : null}
      {reservationLoadError ? (
        <p className="case-error" role="alert">
          {reservationLoadError}
        </p>
      ) : null}

      {linkedReservation ? (
        <dl className="pre-fixed-detail-grid">
          <div>
            <dt>利用者名</dt>
            <dd>{linkedReservation.customer.name || '未設定'}</dd>
          </div>
          <div>
            <dt>お迎え地 S</dt>
            <dd>{pickup.address || '未設定'}</dd>
          </div>
        </dl>
      ) : null}

      <div className="pre-fixed-choice-list">
        {(Object.keys(tripTypeChoiceLabels) as TripTypeChoice[]).map((choice) => (
          <button
            key={choice}
            className={`pre-fixed-choice-button${tripTypeChoice === choice ? ' is-selected' : ''}`}
            type="button"
            onClick={() => {
              setTripTypeChoice(choice)
              if (choice === 'round_or_via') {
                ensureMultiStopViaSlot()
              } else {
                setViaStops([])
                // 直行へ切り替えたときは帰着リンクも外す
                setDestinationLinkedToPickup(false)
              }
            }}
          >
            {tripTypeChoiceLabels[choice]}
          </button>
        ))}
      </div>

      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          disabled={isFromReservation && (isLoadingReservation || Boolean(reservationLoadError))}
          onClick={handleTripTypeNext}
        >
          次へ
        </button>
      </div>
    </section>
  )

  const renderAssistItemsStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <button
        className="text-link"
        type="button"
        onClick={() => {
          const back = getPreFixedManualCreateBackStep('assist-items')
          if (back) {
            setStep(back)
          }
        }}
      >
        ← 送迎タイプに戻る
      </button>
      <p className="eyebrow">Service Items</p>
      <h1>介助・サービス項目</h1>
      <PreFixedAssistStepFlow
        value={assistSelection}
        onChange={applyAssistSelection}
        isRoundTrip={isMultiStopChoice || returnsToOrigin}
        error={assistStepError}
      />
      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            if (!areRequiredAssistStepsComplete(assistSelection)) {
              setAssistStepError('移動方法・介助内容・階段介助を選択してください。')
              return
            }
            setAssistStepError('')
            const next = getPreFixedManualCreateForwardStep('assist-items')
            if (next) {
              setStep(next)
            }
          }}
        >
          次へ（地点入力）
        </button>
      </div>
    </section>
  )

  const renderPickupStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <button
        className="text-link"
        type="button"
        onClick={() => {
          const back = getPreFixedManualCreateBackStep('pickup')
          if (back) {
            setStep(back)
          }
        }}
      >
        ← 介助・サービスに戻る
      </button>
      <p className="eyebrow">Pickup</p>
      <h1>お迎え地 S</h1>
      {pickupMessage ? <p className="save-note" role="status">{pickupMessage}</p> : null}

      <div className="pre-fixed-inline-actions">
        <button
          className="secondary-action"
          type="button"
          disabled={isLocating}
          onClick={() => {
            void captureCurrentLocation('pickup')
          }}
        >
          {destinationFieldErrors.pickup?.includes('住所を取得できませんでした')
            ? '住所を再取得'
            : '現在地から取得'}
        </button>
      </div>

      {locatingTarget === 'pickup' && isLocating ? (
        <p className="save-note" role="status">
          住所を取得しています…
        </p>
      ) : null}

      <label className="pre-fixed-full-width">
        住所を手入力
        <input
          value={
            isCoordinatePairText(pickup.address)
              ? ''
              : pickup.formattedAddress || pickup.address
          }
          placeholder={
            isLocating && locatingTarget === 'pickup'
              ? '住所を取得しています…'
              : '住所を入力'
          }
          disabled={isLocating && locatingTarget === 'pickup'}
          onChange={(event) => {
            updateManualPoint(event.target.value, 'pickup')
            setDestinationFieldErrors((current) => {
              const next = { ...current }
              delete next.pickup
              return next
            })
          }}
        />
      </label>

      {isRoutePointResolved(pickup) ? (
        <div className="pre-fixed-location-resolved" role="status">
          {formatRoutePointDisplayLines(pickup).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      <div className="pre-fixed-facility-search">
        <label className="pre-fixed-full-width">
          施設名から検索
          <input
            value={facilitySearchText}
            onChange={(event) => setFacilitySearchText(event.target.value)}
            placeholder="施設名を入力"
          />
        </label>
        <button
          className="secondary-action"
          type="button"
          disabled={locationResolving}
          onClick={() => {
            void applyFacilitySearch('pickup')
          }}
        >
          {locationResolving ? '住所を確定中...' : '施設名を適用'}
        </button>
      </div>

      {destinationFieldErrors.pickup ? (
        <p className="case-error" role="alert">
          {destinationFieldErrors.pickup}
        </p>
      ) : null}
      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            if (validatePickup()) {
              const next = getPreFixedManualCreateForwardStep('pickup')
              if (next) {
                setStep(next)
              }
            }
          }}
        >
          次へ
        </button>
      </div>
    </section>
  )

  const renderDestinationsStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <button
        className="text-link"
        type="button"
        onClick={() =>
          setStep(isFromReservation ? 'trip-type' : getPreFixedManualCreateBackStep('destinations') ?? 'pickup')
        }
      >
        {isFromReservation ? '← ルート種別に戻る' : '← お迎え地に戻る'}
      </button>
      <p className="eyebrow">Route</p>
      <h1>目的地・経由地</h1>

      <div className="pre-fixed-route-visual" aria-label="ルート概要">
        <div className="pre-fixed-route-visual__row">
          <span className="pre-fixed-route-badge pre-fixed-route-badge--s" aria-hidden>
            S
          </span>
          <p>
            <strong>出発地</strong>
            <span>{formatRoutePointOverviewLines(pickup).join(' / ')}</span>
          </p>
        </div>
        {isMultiStopChoice ? (
          <>
            {viaStops.map((visit, index) => (
              <div key={`visit-preview-${index}`} className="pre-fixed-route-visual__row">
                <span className="pre-fixed-route-badge pre-fixed-route-badge--via" aria-hidden>
                  {index + 1}
                </span>
                <p>
                  <strong>経由地{index + 1}</strong>
                  <span>
                    {formatRoutePointOverviewLines(visit).map((line, lineIndex) => (
                      <span key={`${index}-${lineIndex}`}>
                        {lineIndex > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </span>
                </p>
              </div>
            ))}
          </>
        ) : null}
        <div className="pre-fixed-route-visual__row">
          <span className="pre-fixed-route-badge pre-fixed-route-badge--g" aria-hidden>
            G
          </span>
          <p>
            <strong>{returnsToOrigin ? '帰着地' : '最終目的地'}</strong>
            <span>
              {returnsToOrigin
                ? `${formatRoutePointOverviewLines(pickup).join(' / ')}（出発地と同じ）`
                : formatRoutePointOverviewLines(finalDestination).map((line, lineIndex) => (
                    <span key={`final-${lineIndex}`}>
                      {lineIndex > 0 ? <br /> : null}
                      {line}
                    </span>
                  ))}
            </span>
          </p>
        </div>
      </div>

      <ol className="pre-fixed-route-timeline">
        <li className="pre-fixed-route-timeline__item">
          <span className="pre-fixed-route-badge pre-fixed-route-badge--s" aria-hidden>
            S
          </span>
          <fieldset className="pre-fixed-destination-fieldset">
            <legend>S 出発地</legend>
            <div className="pre-fixed-location-resolved" role="status">
              {formatRoutePointDisplayLines(pickup).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <p className="save-note">この画面では読み取り専用です</p>
          </fieldset>
        </li>

        {isMultiStopChoice
          ? viaStops.map((visit, index) => (
              <li key={`via-${index}`} className="pre-fixed-route-timeline__item">
                <span className="pre-fixed-route-badge pre-fixed-route-badge--via" aria-hidden>
                  {index + 1}
                </span>
                <fieldset className="pre-fixed-destination-fieldset">
                  <legend>経由地 {index + 1}</legend>
                  <PreFixedLocationInput
                    point={visit}
                    error={destinationFieldErrors[`via-${index}`]}
                    placeholder="例: 千葉メディカルセンター"
                    isLocating={isLocating && locatingTarget === 'via' && locatingViaIndex === index}
                    showDelete
                    onChangePoint={(point) => {
                      clearRouteResults()
                      setViaStops((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? point : item)),
                      )
                      setDestinationFieldErrors((current) => {
                        const next = { ...current }
                        delete next[`via-${index}`]
                        return next
                      })
                    }}
                    onCurrentLocation={() => {
                      void captureCurrentLocation('via', index)
                    }}
                    onDelete={() => {
                      clearRouteResults()
                      setViaStops((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      setDestinationFieldErrors((current) => {
                        const next = { ...current }
                        delete next[`via-${index}`]
                        return next
                      })
                    }}
                  />
                </fieldset>
              </li>
            ))
          : null}

        {isMultiStopChoice ? (
          <li className="pre-fixed-route-timeline__add">
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                clearRouteResults()
                setViaStops((current) => [...current, createEmptyStop()])
              }}
            >
              ＋ 経由地を追加
            </button>
          </li>
        ) : null}

        <li className="pre-fixed-route-timeline__item">
          <span className="pre-fixed-route-badge pre-fixed-route-badge--g" aria-hidden>
            G
          </span>
          <fieldset className="pre-fixed-destination-fieldset">
            <legend>
              {returnsToOrigin ? 'G 帰着地（出発地と同じ）' : 'G 最終目的地'}
            </legend>
            <PreFixedLocationInput
              point={returnsToOrigin ? pickup : finalDestination}
              error={destinationFieldErrors.final}
              placeholder="例: 千葉メディカルセンター"
              isLocating={isLocating && locatingTarget === 'final'}
              linkedToOrigin={returnsToOrigin}
              showSameAsOrigin
              onChangePoint={(point) => {
                clearRouteResults()
                setFinalDestination(point)
                setDestinationLinkedToPickup(false)
                setDestinationFieldErrors((current) => {
                  const next = { ...current }
                  delete next.final
                  return next
                })
              }}
              onSameAsOrigin={copyPickupToFinalDestination}
              onUnlinkOrigin={() => {
                clearRouteResults()
                setDestinationLinkedToPickup(false)
              }}
              onCurrentLocation={() => {
                void captureCurrentLocation('final')
              }}
            />
          </fieldset>
        </li>
      </ol>

      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}
      {routeError ? <p className="case-error" role="alert">{routeError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          disabled={isCalculatingRoutes || locationResolving || routeLoading}
          onClick={() => {
            if (!validatePickup() || !validateDestinations()) {
              return
            }
            // 地点未変更で候補が残っている場合は再検索せずルート画面へ戻る
            if (routeCalculated && routeCandidates.length > 0) {
              const fees = computeAssistFeeBreakdown(assistSelection)
              setRouteCandidates((current) =>
                applyAssistFeesToRouteCandidates(current, fees.serviceTotal),
              )
              setStep('routes')
              return
            }
            void loadRoutes()
          }}
        >
          {isCalculatingRoutes || locationResolving || routeLoading
            ? 'ルート検索中...'
            : routeCalculated && routeCandidates.length > 0
              ? 'ルート候補へ'
              : 'ルートを検索'}
        </button>
      </div>
    </section>
  )

  const renderRoutesStep = () => (
    <section className="content-card pre-fixed-flow-card pre-fixed-routes-step">
      <button
        className="text-link"
        type="button"
        onClick={() => {
          // 候補・地図は保持したまま地点入力へ戻る（地点変更時のみ clearRouteResults）
          const back = getPreFixedManualCreateBackStep('routes')
          if (back) {
            setStep(back)
          }
        }}
      >
        ← 目的地・経由地入力に戻る
      </button>
      <p className="eyebrow">Routes</p>
      <h1>ルート候補</h1>
      <p className="save-note">
        {returnsToOrigin
          ? '帰着までの全区間の距離・時間・ルート運賃に、介助・サービス料金を加算した総額で比較できます。'
          : isMultiStopChoice
            ? '複数区間の合計距離・時間・ルート運賃に、介助・サービス料金を加算した総額で比較できます。'
            : `介助・サービス料金（${formatFareYen(assistFeesYen)}円）を各ルート運賃に加算した総額で比較できます。`}
      </p>

      <PreFixedRouteMapPanel
        candidates={routeCalculated ? routeCandidates : []}
        selectedRouteId={selectedRouteId || 'A'}
        fallbackCenter={fallbackMapCenter}
        markerPoints={markerPoints}
        requestId={routeRequestId}
        onRenderResult={handleMapRenderResult}
      />
      {mapWarning ? (
        <p className="case-error" role="alert">
          ※{mapWarning}
        </p>
      ) : null}

      {routeError ? (
        <div className="pre-fixed-route-error-panel" role="alert">
          <p className="case-error">{routeError}</p>
          <button
            className="secondary-action"
            type="button"
            disabled={isCalculatingRoutes || locationResolving}
            onClick={() => {
              void loadRoutes()
            }}
          >
            再検索
          </button>
        </div>
      ) : null}

      {fareDisplayAllowed ? (
        <>
          <div className="pre-fixed-route-card-list">
            {routeCandidates.map((route) => {
              const breakdown = calculatePreFixedFareBreakdown({
                routeFareYen: route.fixedFareYen,
                assistFeesYen,
              })
              const isSelected = selectedRouteId === route.id
              return (
                <button
                  key={route.id}
                  className={`pre-fixed-route-card${isSelected ? ' is-selected' : ''}`}
                  type="button"
                  onClick={() => setSelectedRouteId(route.id)}
                >
                  <div className="pre-fixed-route-card__header">
                    <strong>
                      {route.id} {route.label}
                    </strong>
                    <span className="pre-fixed-amount">
                      {formatFareYen(breakdown.totalEstimatedFareYen)}円
                    </span>
                  </div>
                  <p>
                    {returnsToOrigin ? '全区間合計 ' : isMultiStopChoice ? '複数区間合計 ' : ''}
                    {formatRouteDurationLabel(route.durationSeconds)}
                    {' / '}
                    {formatRouteDistanceLabel(route.distanceMeters)}
                  </p>
                  <dl className="pre-fixed-route-card__breakdown">
                    <div>
                      <dt>ルート運賃</dt>
                      <dd>{formatFareYen(breakdown.routeFareYen)}円</dd>
                    </div>
                    <div>
                      <dt>介助・サービス料金</dt>
                      <dd>{formatFareYen(breakdown.assistFeesYen)}円</dd>
                    </div>
                    <div className="pre-fixed-route-card__total">
                      <dt>請求予定総額</dt>
                      <dd>{formatFareYen(breakdown.totalEstimatedFareYen)}円</dd>
                    </div>
                  </dl>
                  <span className="pre-fixed-route-card__select-label">
                    {isSelected ? '選択中' : 'このルートを選択'}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="pre-fixed-flow-actions">
            <button
              className="primary-action"
              type="button"
              disabled={!selectedRoute}
              onClick={() => {
                const next = getPreFixedManualCreateForwardStep('routes')
                if (next) {
                  setStep(next)
                }
              }}
            >
              この内容で確認へ
            </button>
          </div>
        </>
      ) : null}
    </section>
  )

  const renderConsentStep = () => {
    const selectedBreakdown = selectedRoute
      ? calculatePreFixedFareBreakdown({
          routeFareYen: selectedRoute.fixedFareYen,
          assistFeesYen,
        })
      : null

    return (
    <section className="content-card pre-fixed-flow-card">
      <button
        className="text-link"
        type="button"
        onClick={() => {
          const back = getPreFixedManualCreateBackStep('consent')
          if (back) {
            setStep(back)
          }
        }}
      >
        ← ルート候補に戻る
      </button>
      <p className="eyebrow">Consent</p>
      <h1>事前確定運賃の確認</h1>

      <dl className="pre-fixed-consent-summary">
        <div>
          <dt>送迎タイプ</dt>
          <dd>{tripTypeChoiceLabels[tripTypeChoice]}</dd>
        </div>
        <div>
          <dt>S 出発地</dt>
          <dd>{formatRoutePointDisplayLines(pickup).join(' / ')}</dd>
        </div>
        {viaStops
          .filter((visit) => visit.address.trim())
          .map((visit, index) => (
            <div key={`consent-via-${index}`}>
              <dt>経由地{index + 1}</dt>
              <dd>{formatRoutePointDisplayLines(visit).join(' / ')}</dd>
            </div>
          ))}
        <div>
          <dt>
            {returnsToOrigin ? 'G 帰着地（出発地と同じ）' : 'G 最終目的地'}
          </dt>
          <dd>
            {returnsToOrigin
              ? `${formatRoutePointDisplayLines(pickup).join(' / ')}（出発地と同じ）`
              : formatRoutePointDisplayLines(finalDestination).join(' / ')}
          </dd>
        </div>
        <div>
          <dt>選択ルート</dt>
          <dd>
            {selectedRoute
              ? `${returnsToOrigin ? '帰着まで合計 ' : isMultiStopChoice ? '複数区間合計 ' : ''}${selectedRoute.id} ${selectedRoute.label} / ${formatRouteDistanceLabel(selectedRoute.distanceMeters)} / ${formatRouteDurationLabel(selectedRoute.durationSeconds)}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>ルート運賃</dt>
          <dd>{formatFareYen(selectedBreakdown?.routeFareYen ?? 0)}円</dd>
        </div>
        <div>
          <dt>介助・サービス料金</dt>
          <dd>{formatFareYen(selectedBreakdown?.assistFeesYen ?? 0)}円</dd>
        </div>
        <div className="pre-fixed-consent-summary__total">
          <dt>請求予定総額</dt>
          <dd className="pre-fixed-amount">
            {formatFareYen(selectedBreakdown?.totalEstimatedFareYen ?? 0)}円
          </dd>
        </div>
      </dl>

      {assistFeeLineItems.length > 0 ? (
        <div className="pre-fixed-assist-consent-lines">
          <p className="pre-fixed-assist-step__eyebrow">介助・サービス内訳</p>
          <dl className="pre-fixed-consent-summary">
            {assistFeeLineItems.map((line) => (
              <div key={`${line.label}-${line.amount}`}>
                <dt>{line.label}</dt>
                <dd>{formatFareYen(line.amount)}円</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <label className="pre-fixed-consent-checkbox">
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(event) => {
            setConsentChecked(event.target.checked)
            if (event.target.checked) {
              setConsentError('')
            }
          }}
        />
        上記のルート・金額で同意しました
      </label>

      {consentError ? <p className="case-error" role="alert">{consentError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          disabled={isStarting || !fareDisplayAllowed || !selectedRoute}
          onClick={() => {
            void handleAgreeAndProceed()
          }}
        >
          {isStarting ? '開始処理中...' : '同意してメーターへ進む'}
        </button>
      </div>
    </section>
    )
  }

  return (
    <main className="page pre-fixed-flow-page">
      {step === 'trip-type' ? renderTripTypeStep() : null}
      {step === 'assist-items' ? renderAssistItemsStep() : null}
      {step === 'pickup' ? renderPickupStep() : null}
      {step === 'destinations' ? renderDestinationsStep() : null}
      {step === 'routes' ? renderRoutesStep() : null}
      {step === 'consent' ? renderConsentStep() : null}
    </main>
  )
}
