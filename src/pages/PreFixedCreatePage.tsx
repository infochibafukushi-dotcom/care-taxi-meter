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
  formatRouteDurationLabel,
} from '../services/preFixedRouteQuote'
import { fetchDriverReservation, startFixedFareRun } from '../services/reservationApi'
import { saveReservationTripContext } from '../services/reservationTripContext'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import type { DriverReservationDetail } from '../types/reservation'
import type { ReservationServiceFee } from '../types/reservation'
import type {
  PreFixedRouteCandidate,
  PreFixedRouteCandidateId,
  PreFixedSourceFlow,
  PreFixedTripType,
  RoutePoint,
} from '../types/preFixedMeterSession'
import { captureAddressLocationFromCoordinates } from '../utils/reverseGeocode'
import { resolveReservationCategory } from '../utils/reservationCategory'

type CreateStep =
  | 'trip-type'
  | 'assist-items'
  | 'pickup'
  | 'destinations'
  | 'routes'
  | 'consent'

type TripTypeChoice = 'one_way' | 'round_or_via'

const tripTypeChoiceLabels: Record<TripTypeChoice, string> = {
  one_way: '片道',
  round_or_via: '往復・経由地あり',
}

const mapTripTypeChoice = (choice: TripTypeChoice): PreFixedTripType =>
  choice === 'one_way' ? 'one_way' : 'with_stops'

const createEmptyStop = (): RoutePoint =>
  createRoutePoint({ label: '', address: '', source: 'manual' })

const cloneAssistItems = (items: AssistItem[]) =>
  items.map((item) => ({ ...item, enabled: false }))

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

const buildAssistItemList = (sources: AssistItemSources = defaultAssistItemSources()): AssistItem[] => [
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
]

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
  const [tripType, setTripType] = useState<PreFixedTripType>('one_way')
  const [assistItemSources, setAssistItemSources] = useState<AssistItemSources>(defaultAssistItemSources)
  const [currentBasicFareSettings, setCurrentBasicFareSettings] = useState(basicFareSettings)
  const [assistItems, setAssistItems] = useState<AssistItem[]>(() => buildAssistItemList())
  const linkedReservationRef = useRef<DriverReservationDetail | null>(null)
  const assistItemSourcesRef = useRef(assistItemSources)
  const [pickup, setPickup] = useState<RoutePoint>(() =>
    createRoutePoint({ address: '', label: '', source: 'manual' }),
  )
  const [stops, setStops] = useState<RoutePoint[]>([])
  const [destination, setDestination] = useState<RoutePoint>(createEmptyStop)
  const [facilitySearchText, setFacilitySearchText] = useState('')
  const [pickupMessage, setPickupMessage] = useState('')
  const [isLocating, setIsLocating] = useState(false)
  const [routeCandidates, setRouteCandidates] = useState<PreFixedRouteCandidate[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<PreFixedRouteCandidateId>('A')
  const [isCalculatingRoutes, setIsCalculatingRoutes] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [stepError, setStepError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [linkedReservation, setLinkedReservation] = useState<DriverReservationDetail | null>(null)
  const [reservationLoadError, setReservationLoadError] = useState('')
  const [isLoadingReservation, setIsLoadingReservation] = useState(isFromReservation)

  useEffect(() => {
    linkedReservationRef.current = linkedReservation
  }, [linkedReservation])

  useEffect(() => {
    assistItemSourcesRef.current = assistItemSources
  }, [assistItemSources])

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
          if (reservation) {
            return buildAssistItemsFromReservation(reservation.quoteSnapshot.serviceFees, sources)
          }
          return mergeAssistItemSelections(buildAssistItemList(sources), current)
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

  const specialVehicleItemIds = useMemo(
    () => new Set(assistItemSources.specialVehicleMenuItems.map((item) => item.id)),
    [assistItemSources.specialVehicleMenuItems],
  )

  const selectedRoute = useMemo(
    () => routeCandidates.find((route) => route.id === selectedRouteId) ?? routeCandidates[0],
    [routeCandidates, selectedRouteId],
  )

  const serviceFeeItems = useMemo(
    () => assistItems.filter((item) => item.enabled && item.amount > 0),
    [assistItems],
  )

  const specialVehicleTotal = useMemo(
    () =>
      assistItems
        .filter((item) => item.enabled && specialVehicleItemIds.has(item.id))
        .reduce((sum, item) => sum + item.amount, 0),
    [assistItems, specialVehicleItemIds],
  )

  const assistFeeTotal = useMemo(
    () => serviceFeeItems.reduce((sum, item) => sum + item.amount, 0) - specialVehicleTotal,
    [serviceFeeItems, specialVehicleTotal],
  )

  const toggleAssistItem = (id: string) => {
    setAssistItems((current) =>
      current.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)),
    )
  }

  const captureCurrentLocation = useCallback(async (target: 'pickup' | 'destination') => {
    if (!('geolocation' in navigator)) {
      setStepError('この端末では現在地取得を利用できません。')
      return
    }

    setIsLocating(true)
    setStepError('')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const geocoded = await captureAddressLocationFromCoordinates({
            capturedAt: new Date(position.timestamp).toISOString(),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
          const address = geocoded.address.trim()
          const point = createRoutePoint({
            address: address || `${position.coords.latitude},${position.coords.longitude}`,
            label: address || '現在地',
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            source: 'gps',
          })

          if (target === 'pickup') {
            setPickup(point)
            setPickupMessage('')
          } else {
            setDestination(point)
          }
        } catch {
          setStepError('住所の取得に失敗しました。手入力してください。')
        } finally {
          setIsLocating(false)
        }
      },
      () => {
        setStepError('現在地の取得に失敗しました。')
        setIsLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])

  const applyFacilitySearch = (target: 'pickup' | 'stop' | 'destination', stopIndex?: number) => {
    const query = facilitySearchText.trim()
    if (!query) {
      setStepError('施設名を入力してください。')
      return
    }

    const point = createRoutePoint({
      address: query,
      label: query,
      facilityName: query,
      source: 'facility_search',
    })

    if (target === 'pickup') {
      setPickup(point)
      setPickupMessage('施設名のみ取得されています。正確な住所を確認して入力してください。')
    } else if (target === 'destination') {
      setDestination(point)
    } else if (typeof stopIndex === 'number') {
      setStops((current) =>
        current.map((stop, index) => (index === stopIndex ? point : stop)),
      )
    }

    setStepError('')
  }

  const handleReturnToPickup = () => {
    if (!pickup.address.trim()) {
      setStepError('先にお迎え地Sを入力してください。')
      return
    }

    setStepError('')
    setDestination(
      createRoutePoint({
        ...pickup,
        label: pickup.label || pickup.address,
        source: pickup.source,
      }),
    )
  }

  const validatePickup = () => {
    if (!pickup.address.trim()) {
      setStepError('お迎え地Sを入力してください。')
      return false
    }
    setStepError('')
    return true
  }

  const validateDestinations = () => {
    if (!destination.address.trim()) {
      setStepError('目的地Gを入力してください。')
      return false
    }
    if (stops.some((stop) => !stop.address.trim())) {
      setStepError('立ち寄り先の住所を入力してください。')
      return false
    }
    setStepError('')
    return true
  }

  const loadRoutes = async () => {
    if (!validatePickup() || !validateDestinations()) {
      return
    }

    setIsCalculatingRoutes(true)
    setRouteError('')

    try {
      const candidates = await calculatePreFixedRouteCandidates({
        pickup,
        stops,
        destination,
        serviceItems: assistItems,
        basicFare: currentBasicFareSettings,
      })

      if (candidates.length === 0) {
        setRouteError('ルートを計算できませんでした。住所を確認してください。')
        return
      }

      setRouteCandidates(candidates)
      setSelectedRouteId(candidates[0]?.id ?? 'A')
      setStep('routes')
    } catch (error) {
      setRouteError(
        error instanceof Error ? error.message : 'ルート計算に失敗しました。',
      )
    } finally {
      setIsCalculatingRoutes(false)
    }
  }

  const handleAgreeAndProceed = async () => {
    if (!consentChecked) {
      setConsentError('ルートと金額への同意を確認してください。')
      return
    }

    if (!selectedRoute) {
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
      const session = createPreFixedMeterSession({
        sourceFlow: resolveSourceFlow(linkedReservation),
        tripType,
        pickup,
        stops,
        destination,
        selectedServiceItems: assistItems.filter((item) => item.enabled),
        routeCandidates,
        selectedRouteId,
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

  const handleTripTypeNext = () => {
    if (isFromReservation && !pickup.address.trim()) {
      setStepError('予約のお迎え地が取得できません。予約内容を確認してください。')
      return
    }
    setStepError('')
    setStep(isFromReservation ? 'destinations' : 'assist-items')
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
              setTripType(mapTripTypeChoice(choice))
              if (choice === 'one_way') {
                setStops([])
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
      <button className="text-link" type="button" onClick={() => setStep('trip-type')}>
        ← 送迎タイプに戻る
      </button>
      <p className="eyebrow">Service Items</p>
      <h1>介助・サービス項目</h1>
      <div className="pre-fixed-assist-list">
        {assistItems.map((item) => (
          <label key={item.id} className="pre-fixed-assist-item">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={() => toggleAssistItem(item.id)}
            />
            <span>{item.name}</span>
            {item.amount > 0 ? <strong>{formatFareYen(item.amount)}円</strong> : null}
          </label>
        ))}
      </div>
      <div className="pre-fixed-flow-actions">
        <button className="primary-action" type="button" onClick={() => setStep('pickup')}>
          次へ
        </button>
      </div>
    </section>
  )

  const renderPickupStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <button className="text-link" type="button" onClick={() => setStep('assist-items')}>
        ← 介助項目に戻る
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
          現在地から取得
        </button>
      </div>

      <label className="pre-fixed-full-width">
        住所を手入力
        <input
          value={pickup.address}
          onChange={(event) => {
            setPickup(
              createRoutePoint({
                address: event.target.value,
                label: event.target.value,
                source: 'manual',
              }),
            )
          }}
        />
      </label>

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
          onClick={() => applyFacilitySearch('pickup')}
        >
          施設名を適用
        </button>
      </div>

      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            if (validatePickup()) {
              setStep('destinations')
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
        onClick={() => setStep(isFromReservation ? 'trip-type' : 'pickup')}
      >
        {isFromReservation ? '← ルート種別に戻る' : '← お迎え地に戻る'}
      </button>
      <p className="eyebrow">Route</p>
      <h1>目的地・立ち寄り</h1>

      <div className="pre-fixed-route-visual">
        <p><strong>S</strong> {pickup.label || pickup.address || '未入力'}</p>
        {stops.map((stop, index) => (
          <p key={`stop-preview-${index}`}><strong>{index + 1}.</strong> {stop.label || stop.address || '未入力'}</p>
        ))}
        <p><strong>G</strong> {destination.label || destination.address || '未入力'}</p>
      </div>

      {tripType === 'with_stops' && stops.map((stop, index) => (
        <fieldset key={`stop-${index}`} className="pre-fixed-destination-fieldset">
          <legend>立ち寄り {index + 1}</legend>
          <label className="pre-fixed-full-width">
            住所または施設名
            <input
              value={stop.address}
              onChange={(event) => {
                const value = event.target.value
                setStops((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? createRoutePoint({ address: value, label: value, source: 'manual' })
                      : item,
                  ),
                )
              }}
            />
          </label>
        </fieldset>
      ))}

      <fieldset className="pre-fixed-destination-fieldset">
        <legend>目的地 G</legend>
        <label className="pre-fixed-full-width">
          住所または施設名を入力
          <input
            value={destination.address}
            onChange={(event) => {
              const value = event.target.value
              setDestination(createRoutePoint({ address: value, label: value, source: 'manual' }))
            }}
          />
        </label>
        <button
          className="secondary-action"
          type="button"
          disabled={isLocating}
          onClick={() => {
            void captureCurrentLocation('destination')
          }}
        >
          住所取得（現在地）
        </button>
      </fieldset>

      {tripType === 'with_stops' ? (
        <button
          className="secondary-action"
          type="button"
          onClick={() => setStops((current) => [...current, createEmptyStop()])}
        >
          ＋ 経由地を追加
        </button>
      ) : null}

      {tripType === 'with_stops' ? (
        <button
          className="secondary-action"
          type="button"
          disabled={!pickup.address.trim()}
          onClick={handleReturnToPickup}
        >
          お迎え地に戻る
        </button>
      ) : null}

      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}
      {routeError ? <p className="case-error" role="alert">{routeError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          disabled={isCalculatingRoutes}
          onClick={() => {
            void loadRoutes()
          }}
        >
          {isCalculatingRoutes ? 'ルート計算中...' : 'ルート候補を表示'}
        </button>
      </div>
    </section>
  )

  const renderRoutesStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <button className="text-link" type="button" onClick={() => setStep('destinations')}>
        ← 目的地入力に戻る
      </button>
      <p className="eyebrow">Routes</p>
      <h1>ルート候補</h1>

      <div className="pre-fixed-route-card-list">
        {routeCandidates.map((route) => (
          <button
            key={route.id}
            className={`pre-fixed-route-card${selectedRouteId === route.id ? ' is-selected' : ''}`}
            type="button"
            onClick={() => setSelectedRouteId(route.id)}
          >
            <div className="pre-fixed-route-card__header">
              <strong>{route.id} {route.label}</strong>
              <span className="pre-fixed-amount">{formatFareYen(route.totalYen)}円</span>
            </div>
            <p>{formatRouteDurationLabel(route.durationSeconds)}</p>
            <dl className="pre-fixed-route-card__breakdown">
              <div>
                <dt>事前確定運賃</dt>
                <dd>{formatFareYen(route.fixedFareYen)}円</dd>
              </div>
              <div>
                <dt>介助料金</dt>
                <dd>{formatFareYen(assistFeeTotal)}円</dd>
              </div>
              {specialVehicleTotal > 0 ? (
                <div>
                  <dt>車両使用料</dt>
                  <dd>{formatFareYen(specialVehicleTotal)}円</dd>
                </div>
              ) : null}
              <div>
                <dt>請求予定合計</dt>
                <dd>{formatFareYen(route.totalYen)}円</dd>
              </div>
            </dl>
          </button>
        ))}
      </div>

      <div className="pre-fixed-flow-actions">
        <button className="primary-action" type="button" onClick={() => setStep('consent')}>
          選択して同意確認へ
        </button>
      </div>
    </section>
  )

  const renderConsentStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <button className="text-link" type="button" onClick={() => setStep('routes')}>
        ← ルート選択に戻る
      </button>
      <p className="eyebrow">Consent</p>
      <h1>事前確定運賃の確認</h1>

      <dl className="pre-fixed-consent-summary">
        <div>
          <dt>お迎え地</dt>
          <dd>{pickup.address}</dd>
        </div>
        {stops.length > 0 ? (
          <div>
            <dt>立ち寄り</dt>
            <dd>{stops.map((stop) => stop.address).join('\n')}</dd>
          </div>
        ) : null}
        <div>
          <dt>目的地</dt>
          <dd>{destination.address}</dd>
        </div>
        <div>
          <dt>選択ルート</dt>
          <dd>{selectedRoute ? `${selectedRoute.id} ${selectedRoute.label}` : '—'}</dd>
        </div>
        <div>
          <dt>事前確定運賃</dt>
          <dd className="pre-fixed-amount">{formatFareYen(selectedRoute?.fixedFareYen ?? 0)}円</dd>
        </div>
        <div>
          <dt>介助料金</dt>
          <dd>{formatFareYen(assistFeeTotal)}円</dd>
        </div>
        {specialVehicleTotal > 0 ? (
          <div>
            <dt>車両使用料</dt>
            <dd>{formatFareYen(specialVehicleTotal)}円</dd>
          </div>
        ) : null}
        <div className="pre-fixed-consent-summary__total">
          <dt>請求予定合計</dt>
          <dd className="pre-fixed-amount">{formatFareYen(selectedRoute?.totalYen ?? 0)}円</dd>
        </div>
      </dl>

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
          disabled={isStarting}
          onClick={() => {
            void handleAgreeAndProceed()
          }}
        >
          {isStarting ? '開始処理中...' : '同意してメーターへ進む'}
        </button>
      </div>
    </section>
  )

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
