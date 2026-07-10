import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PreFixedManualFareSettingsPanel } from '../components/preFixed/PreFixedManualFareSettingsPanel'
import {
  PreFixedRouteMapPanel,
  buildRouteMapMarkers,
} from '../components/preFixed/PreFixedRouteMapPanel'
import { PreFixedRouteCandidateCard } from '../components/preFixed/PreFixedRouteCandidateCard'
import { useWorkSession } from '../hooks/useWorkSession'
import {
  buildDefaultFareSelection,
  calculateManualPreFixedServiceYen,
  calculateManualPreFixedTotalYen,
  isSpecialVehicleEligible,
} from '../services/preFixedManualFare'
import {
  METER_SETTINGS_FETCH_ERROR_MESSAGE,
  METER_SETTINGS_LOADING_MESSAGE,
  canCalculateManualFare,
  canProceedToManualFareSettings,
  resolveManualFlowMeterSettingsErrorMessage,
} from '../services/preFixedManualMeterSettings'
import { useStoreMeterSettings } from '../hooks/useStoreMeterSettings'
import {
  buildSegmentsFromOrderedPoints,
  buildStopOrderLabels,
  clonePickupAsDestination,
  moveArrayItem,
  resolveTripTypeFromPoints,
} from '../services/preFixedManualRoute'
import { formatFareYen } from '../services/fare'
import {
  agreePreFixedMeterSession,
  buildTripContextFromPreFixedSession,
  createManualPreFixedMeterSession,
  createRoutePoint,
  savePreFixedMeterSession,
} from '../services/preFixedMeterSession'
import {
  calculatePreFixedRouteCandidates,
  formatRouteDistanceLabel,
  formatRouteDurationLabel,
} from '../services/preFixedRouteQuote'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import { saveReservationTripContext } from '../services/reservationTripContext'
import { tenantAccessScopeFromSessionSource } from '../services/tenancy'
import { fetchVehicles } from '../services/vehicles'
import type { Vehicle } from '../types/work'
import type {
  ManualRouteKind,
  PreFixedManualFareSelection,
  PreFixedRouteCandidate,
  PreFixedRouteCandidateId,
  RoutePoint,
} from '../types/preFixedMeterSession'
import { preFixedRouteCandidateLabels } from '../types/preFixedMeterSession'
import { captureAddressLocationFromCoordinates } from '../utils/reverseGeocode'

type ManualStep = 'route-kind' | 'pickup' | 'destinations' | 'routes' | 'fare-settings' | 'confirm'

const routeKindLabels: Record<ManualRouteKind, string> = {
  single: '目的地',
  multi: '複数経由',
}

const ROUTE_FETCH_ERROR_MESSAGE =
  'ルートを取得できませんでした。出発地と目的地を確認して、もう一度検索してください。'

const createEmptyDestination = (): RoutePoint =>
  createRoutePoint({ label: '', address: '', source: 'manual' })

type PreFixedManualCreateFlowProps = {
  vehicleId: string
  menuPath: string
}

export function PreFixedManualCreateFlow({ vehicleId, menuPath }: PreFixedManualCreateFlowProps) {
  const navigate = useNavigate()
  const workSession = useWorkSession()
  const accessScope = useMemo(
    () => tenantAccessScopeFromSessionSource(workSession.currentSession),
    [workSession.currentSession],
  )

  const [step, setStep] = useState<ManualStep>('route-kind')
  const [routeKind, setRouteKind] = useState<ManualRouteKind>('single')
  const { state: meterSettingsState, settings: storeMeterSettings, retry: retryMeterSettings } =
    useStoreMeterSettings(accessScope)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [pickup, setPickup] = useState<RoutePoint>(() =>
    createRoutePoint({ address: '', label: '', source: 'manual' }),
  )
  const [savedInitialPickup, setSavedInitialPickup] = useState<RoutePoint | null>(null)
  const [destinations, setDestinations] = useState<RoutePoint[]>([createEmptyDestination()])
  const [routeCandidates, setRouteCandidates] = useState<PreFixedRouteCandidate[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<PreFixedRouteCandidateId>('A')
  const [fareSelection, setFareSelection] = useState<PreFixedManualFareSelection | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [isCalculatingRoutes, setIsCalculatingRoutes] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [stepError, setStepError] = useState('')
  const [routeError, setRouteError] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [vehicleLoadComplete, setVehicleLoadComplete] = useState(!vehicleId)
  const hasInitializedAutomaticFeesRef = useRef(false)
  const userEditedFareSelectionRef = useRef(false)

  useEffect(() => {
    if (!vehicleId || !accessScope.franchiseeId) {
      setVehicleLoadComplete(true)
      return
    }

    setVehicleLoadComplete(false)
    void fetchVehicles(accessScope)
      .then((vehicles) => {
        const matched = vehicles.find((vehicle) => vehicle.id === vehicleId)
        if (matched) {
          setSelectedVehicle(matched)
        }
      })
      .finally(() => {
        setVehicleLoadComplete(true)
      })
  }, [accessScope, vehicleId])

  useEffect(() => {
    if (hasInitializedAutomaticFeesRef.current || userEditedFareSelectionRef.current) {
      return
    }
    if (meterSettingsState.status !== 'ready' || !storeMeterSettings || !vehicleLoadComplete) {
      return
    }

    const dispatchItem = storeMeterSettings.dispatchMenuItems.find(
      (item) => item.id === 'reservedPickup',
    )
    const specialItem = storeMeterSettings.specialVehicleMenuItems.find(
      (item) => item.id === 'oneBoxLift',
    )
    setFareSelection(
      buildDefaultFareSelection({
        dispatchItem,
        specialVehicleItem: specialItem,
        waitingFare: storeMeterSettings.waitingFare,
        escortFare: storeMeterSettings.escortFare,
        vehicleEligible: isSpecialVehicleEligible(selectedVehicle?.vehicleType),
      }),
    )
    hasInitializedAutomaticFeesRef.current = true
  }, [meterSettingsState.status, storeMeterSettings, selectedVehicle, vehicleLoadComplete])

  const routeMapMarkers = useMemo(() => {
    const filledDestinations = destinations.filter((destination) => destination.address.trim())
    const segments = buildSegmentsFromOrderedPoints(pickup, filledDestinations)
    if (!segments || !pickup.address.trim()) {
      return []
    }
    return buildRouteMapMarkers(pickup, segments.stops, segments.destination)
  }, [pickup, destinations])

  const routeServiceFeesYen = useMemo(
    () => (fareSelection ? calculateManualPreFixedServiceYen(fareSelection) : 0),
    [fareSelection],
  )

  const handleFareSelectionChange = (
    updater: (current: PreFixedManualFareSelection) => PreFixedManualFareSelection,
  ) => {
    userEditedFareSelectionRef.current = true
    setFareSelection((current) => (current ? updater(current) : current))
  }

  const selectedRoute = useMemo(
    () => routeCandidates.find((route) => route.id === selectedRouteId) ?? routeCandidates[0],
    [routeCandidates, selectedRouteId],
  )

  const stopOrderLabels = useMemo(
    () => buildStopOrderLabels(pickup, destinations.filter((d) => d.address.trim())),
    [pickup, destinations],
  )

  const preFixedTotalYen = useMemo(() => {
    if (!fareSelection || !selectedRoute) {
      return 0
    }
    return calculateManualPreFixedTotalYen({
      routeFareYen: selectedRoute.fixedFareYen,
      selection: fareSelection,
    })
  }, [fareSelection, selectedRoute])

  const initFareSelection = useCallback(() => {
    if (!storeMeterSettings) {
      return null
    }
    const dispatchItem = storeMeterSettings.dispatchMenuItems.find(
      (item) => item.id === 'reservedPickup',
    )
    const specialItem = storeMeterSettings.specialVehicleMenuItems.find(
      (item) => item.id === 'oneBoxLift',
    )
    return buildDefaultFareSelection({
      dispatchItem,
      specialVehicleItem: specialItem,
      waitingFare: storeMeterSettings.waitingFare,
      escortFare: storeMeterSettings.escortFare,
      vehicleEligible: isSpecialVehicleEligible(selectedVehicle?.vehicleType),
    })
  }, [storeMeterSettings, selectedVehicle])

  const captureCurrentLocation = useCallback(async (target: 'pickup' | 'destination', index = 0) => {
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
          } else {
            setDestinations((current) =>
              current.map((item, itemIndex) => (itemIndex === index ? point : item)),
            )
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

  const validatePickup = () => {
    if (!pickup.address.trim()) {
      setStepError('出発地を設定してください。')
      return false
    }
    setStepError('')
    return true
  }

  const validateDestinations = () => {
    const filled = destinations.filter((d) => d.address.trim())
    if (filled.length === 0) {
      setStepError('目的地を設定してください。')
      return false
    }
    if (destinations.some((d) => !d.address.trim())) {
      setStepError('未入力の目的地があります。入力するか削除してください。')
      return false
    }
    setStepError('')
    return true
  }

  const loadRoutes = async () => {
    if (!validatePickup() || !validateDestinations()) {
      return
    }

    if (!canCalculateManualFare(meterSettingsState)) {
      setRouteError(resolveManualFlowMeterSettingsErrorMessage(meterSettingsState) ?? '')
      return
    }

    if (!storeMeterSettings) {
      setRouteError(METER_SETTINGS_FETCH_ERROR_MESSAGE)
      return
    }

    const filledDestinations = destinations.filter((d) => d.address.trim())
    const segments = buildSegmentsFromOrderedPoints(pickup, filledDestinations)
    if (!segments) {
      setRouteError('ルートを構成できません。')
      return
    }

    if (!savedInitialPickup && pickup.address.trim()) {
      setSavedInitialPickup({ ...pickup })
    }

    setIsCalculatingRoutes(true)
    setRouteError('')
    setRouteCandidates([])

    try {
      const candidates = await calculatePreFixedRouteCandidates({
        pickup,
        stops: segments.stops,
        destination: segments.destination,
        serviceItems: [],
        basicFare: storeMeterSettings.basicFare,
        includeServiceFees: false,
        minCandidates: 2,
        maxCandidates: 2,
      })

      const withLabels = candidates.map((candidate) => ({
        ...candidate,
        stopOrderLabels: stopOrderLabels,
      }))

      if (withLabels.length === 0) {
        setRouteError(ROUTE_FETCH_ERROR_MESSAGE)
        return
      }

      setRouteCandidates(withLabels)
      setSelectedRouteId(withLabels[0]?.id ?? 'A')
      setStep('routes')
    } catch (error) {
      setRouteError(
        error instanceof Error && error.message.trim()
          ? ROUTE_FETCH_ERROR_MESSAGE
          : ROUTE_FETCH_ERROR_MESSAGE,
      )
    } finally {
      setIsCalculatingRoutes(false)
    }
  }

  const goToFareSettings = () => {
    if (!selectedRoute) {
      setStepError('ルートを選択してください。')
      return
    }
    if (!canProceedToManualFareSettings(meterSettingsState)) {
      setStepError(resolveManualFlowMeterSettingsErrorMessage(meterSettingsState) ?? '')
      return
    }
    const nextSelection = fareSelection ?? initFareSelection()
    if (!nextSelection) {
      setStepError(
        meterSettingsState.status === 'loading'
          ? METER_SETTINGS_LOADING_MESSAGE
          : METER_SETTINGS_FETCH_ERROR_MESSAGE,
      )
      return
    }
    if (!hasInitializedAutomaticFeesRef.current) {
      hasInitializedAutomaticFeesRef.current = true
    }
    setFareSelection(nextSelection)
    setStepError('')
    setStep('fare-settings')
  }

  const validateFareSettings = () => {
    if (!fareSelection) {
      setStepError('料金設定を取得できませんでした。')
      return false
    }
    if (fareSelection.stairsAssist && !fareSelection.stairFloorId) {
      setStepError('階段介助の階数を選択してください。')
      return false
    }
    setStepError('')
    return true
  }

  const handleAgreeAndStart = async () => {
    if (!consentChecked) {
      setConsentError('ルートと金額への同意を確認してください。')
      return
    }
    if (!selectedRoute || !fareSelection || !storeMeterSettings) {
      setConsentError(METER_SETTINGS_FETCH_ERROR_MESSAGE)
      return
    }
    if (fareSelection.stairsAssist && !fareSelection.stairFloorId) {
      setConsentError('階段介助の階数を選択してください。')
      return
    }
    if (readActiveTripSnapshot()) {
      setConsentError(
        '未終了の運行があります。開始前にメーター画面で運行を終了または復元してください。',
      )
      return
    }

    const filledDestinations = destinations.filter((d) => d.address.trim())
    const segments = buildSegmentsFromOrderedPoints(pickup, filledDestinations)
    if (!segments) {
      setConsentError('ルートを確認してください。')
      return
    }

    setIsStarting(true)
    setConsentError('')

    try {
      const tripType = resolveTripTypeFromPoints(pickup, filledDestinations)
      const totalYen = calculateManualPreFixedTotalYen({
        routeFareYen: selectedRoute.fixedFareYen,
        selection: fareSelection,
      })

      const session = createManualPreFixedMeterSession({
        routeKind,
        pickup,
        savedInitialPickup: savedInitialPickup ?? pickup,
        orderedDestinations: filledDestinations,
        stops: segments.stops,
        destination: segments.destination,
        tripType,
        routeCandidates,
        selectedRouteId,
        fareSelection,
        preFixedTotalYen: totalYen,
        fareSettingsSnapshot: {
          basicFare: storeMeterSettings.basicFare,
          waitingFare: storeMeterSettings.waitingFare,
          escortFare: storeMeterSettings.escortFare,
          assistItems: storeMeterSettings.assistItems,
          dispatchMenuItems: storeMeterSettings.dispatchMenuItems,
          specialVehicleMenuItems: storeMeterSettings.specialVehicleMenuItems,
        },
        agreedBy: workSession.currentSession?.staffName,
      })

      const agreedSession = agreePreFixedMeterSession(
        session,
        workSession.currentSession?.staffName,
      )
      savePreFixedMeterSession(agreedSession)
      saveReservationTripContext(buildTripContextFromPreFixedSession(agreedSession))

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

  const addReturnToStart = () => {
    const origin = savedInitialPickup ?? pickup
    if (!origin.address.trim()) {
      setStepError('出発地が未設定です。')
      return
    }
    setDestinations((current) => [...current, clonePickupAsDestination(origin)])
    setStepError('')
  }

  const renderStepIndicator = () => {
    const labels: Record<ManualStep, string> = {
      'route-kind': 'ルート種類',
      pickup: '出発地',
      destinations: '目的地',
      routes: 'ルート候補',
      'fare-settings': '料金設定',
      confirm: '確認',
    }
    return (
      <p className="save-note" aria-live="polite">
        現在: {labels[step]}
      </p>
    )
  }

  const renderRouteKindStep = () => (
    <section className="content-card pre-fixed-flow-card">
      <Link className="text-link" to={menuPath}>
        ← 事前確定運賃メニューへ
      </Link>
      {renderStepIndicator()}
      <h1>運行ルートを選択</h1>
      <div className="pre-fixed-choice-list">
        {(Object.keys(routeKindLabels) as ManualRouteKind[]).map((kind) => (
          <button
            key={kind}
            className={`pre-fixed-choice-button${routeKind === kind ? ' is-selected' : ''}`}
            type="button"
            onClick={() => {
              setRouteKind(kind)
              setDestinations([createEmptyDestination()])
            }}
          >
            {routeKindLabels[kind]}
          </button>
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
      <button className="text-link" type="button" onClick={() => setStep('route-kind')}>
        ← ルート種類に戻る
      </button>
      {renderStepIndicator()}
      <p className="eyebrow">Pickup</p>
      <h1>出発地</h1>
      <div className="pre-fixed-inline-actions">
        <button
          className="secondary-action"
          type="button"
          disabled={isLocating}
          onClick={() => {
            void captureCurrentLocation('pickup')
          }}
        >
          現在地を取得
        </button>
      </div>
      <label className="pre-fixed-full-width">
        住所を手入力
        <input
          value={pickup.address}
          onChange={(event) => {
            const value = event.target.value
            setPickup(createRoutePoint({ address: value, label: value, source: 'manual' }))
          }}
        />
      </label>
      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}
      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            if (validatePickup()) {
              setSavedInitialPickup({ ...pickup })
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
      <button className="text-link" type="button" onClick={() => setStep('pickup')}>
        ← 出発地に戻る
      </button>
      {renderStepIndicator()}
      <p className="eyebrow">Destinations</p>
      <h1>{routeKind === 'single' ? '目的地' : '目的地・経由地'}</h1>

      <div className="pre-fixed-route-visual">
        <p><strong>出発地</strong> {pickup.label || pickup.address || '未入力'}</p>
        {destinations.map((dest, index) => (
          <p key={`preview-${index}`}>
            <strong>
              {index === destinations.length - 1 && destinations.length > 1
                ? '最終目的地'
                : `目的地${index + 1}`}
            </strong>{' '}
            {dest.label || dest.address || '未入力'}
          </p>
        ))}
      </div>

      <fieldset className="pre-fixed-destination-fieldset">
        <legend>出発地</legend>
        <p className="save-note">{pickup.address || '未入力'}</p>
      </fieldset>

      {destinations.map((dest, index) => (
        <fieldset key={`dest-${index}`} className="pre-fixed-destination-fieldset">
          <legend>
            {index === destinations.length - 1 && destinations.length > 1
              ? '最終目的地'
              : `目的地${index + 1}`}
          </legend>
          {index >= 2 ? (
            <button
              className="secondary-action pre-fixed-return-start-button"
              type="button"
              onClick={addReturnToStart}
            >
              最初の出発地に戻る
            </button>
          ) : null}
          <label className="pre-fixed-full-width">
            住所
            <input
              value={dest.address}
              onChange={(event) => {
                const value = event.target.value
                setDestinations((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? createRoutePoint({ address: value, label: value, source: 'manual' })
                      : item,
                  ),
                )
              }}
            />
          </label>
          <div className="pre-fixed-inline-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={isLocating}
              onClick={() => {
                void captureCurrentLocation('destination', index)
              }}
            >
              現在地を取得
            </button>
            {routeKind === 'multi' && destinations.length > 1 ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={index === 0}
                  onClick={() => setDestinations((current) => moveArrayItem(current, index, index - 1))}
                >
                  ↑
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={index === destinations.length - 1}
                  onClick={() => setDestinations((current) => moveArrayItem(current, index, index + 1))}
                >
                  ↓
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() =>
                    setDestinations((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  削除
                </button>
              </>
            ) : null}
          </div>
        </fieldset>
      ))}

      {routeKind === 'multi' ? (
        <button
          className="secondary-action"
          type="button"
          onClick={() => setDestinations((current) => [...current, createEmptyDestination()])}
        >
          ＋ 次の目的地を追加
        </button>
      ) : null}

      {renderMeterSettingsStatus()}
      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}
      {routeError ? <p className="case-error" role="alert">{routeError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          disabled={isCalculatingRoutes || !canCalculateManualFare(meterSettingsState)}
          onClick={() => {
            void loadRoutes()
          }}
        >
          {isCalculatingRoutes
            ? 'ルート検索中...'
            : meterSettingsState.status === 'loading'
              ? METER_SETTINGS_LOADING_MESSAGE
              : 'ルートを検索'}
        </button>
      </div>
    </section>
  )

  const renderMeterSettingsStatus = () => {
    if (meterSettingsState.status === 'loading') {
      return (
        <p className="save-note" role="status">
          {METER_SETTINGS_LOADING_MESSAGE}
        </p>
      )
    }

    if (meterSettingsState.status === 'error' || meterSettingsState.status === 'missing_scope') {
      return (
        <div className="pre-fixed-meter-settings-error" role="alert">
          <p className="case-error">{METER_SETTINGS_FETCH_ERROR_MESSAGE}</p>
          <button className="secondary-action" type="button" onClick={retryMeterSettings}>
            再読み込み
          </button>
        </div>
      )
    }

    return null
  }

  const renderRoutesStep = () => (
    <section className="content-card pre-fixed-flow-card pre-fixed-routes-step">
      <button className="text-link" type="button" onClick={() => setStep('destinations')}>
        ← 目的地入力に戻る
      </button>
      {renderStepIndicator()}
      <h1>ルート候補</h1>

      <PreFixedRouteMapPanel
        candidates={routeCandidates}
        selectedRouteId={selectedRouteId}
        markers={routeMapMarkers}
        isLoading={isCalculatingRoutes}
      />

      <div className="pre-fixed-route-card-list">
        {routeCandidates.map((route) => (
          <PreFixedRouteCandidateCard
            key={route.id}
            route={route}
            isSelected={selectedRouteId === route.id}
            routeFareYen={route.fixedFareYen}
            serviceFeesYen={routeServiceFeesYen}
            preFixedTotalYen={route.fixedFareYen + routeServiceFeesYen}
            onSelect={() => setSelectedRouteId(route.id)}
          />
        ))}
      </div>

      {renderMeterSettingsStatus()}
      {stepError ? <p className="case-error" role="alert">{stepError}</p> : null}

      <div className="pre-fixed-flow-actions">
        <button
          className="primary-action"
          type="button"
          disabled={!canProceedToManualFareSettings(meterSettingsState)}
          onClick={goToFareSettings}
        >
          {meterSettingsState.status === 'loading'
            ? METER_SETTINGS_LOADING_MESSAGE
            : '選択して料金設定へ'}
        </button>
      </div>
    </section>
  )

  const renderFareSettingsStep = () => {
    if (!fareSelection || !selectedRoute || !storeMeterSettings) {
      return (
        <section className="content-card pre-fixed-flow-card">
          {renderMeterSettingsStatus()}
        </section>
      )
    }

    return (
      <section className="content-card pre-fixed-flow-card">
        <button className="text-link" type="button" onClick={() => setStep('routes')}>
          ← ルート選択に戻る
        </button>
        {renderStepIndicator()}
        <h1>運賃・各種料金</h1>

        <PreFixedManualFareSettingsPanel
          storeMeterSettings={storeMeterSettings}
          vehicleType={selectedVehicle?.vehicleType}
          fareSelection={fareSelection}
          routeFareYen={selectedRoute.fixedFareYen}
          preFixedTotalYen={preFixedTotalYen}
          stepError={stepError}
          onFareSelectionChange={handleFareSelectionChange}
          onConfirm={() => {
            if (validateFareSettings()) {
              setStep('confirm')
            }
          }}
        />
      </section>
    )
  }

  const renderConfirmStep = () => {
    if (!fareSelection || !selectedRoute) {
      return null
    }

    const showWaitingNote =
      fareSelection.waitingEscortPlan === 'waiting' || fareSelection.waitingEscortPlan === 'both'
    const showEscortNote =
      fareSelection.waitingEscortPlan === 'escort' || fareSelection.waitingEscortPlan === 'both'

    return (
      <section className="content-card pre-fixed-flow-card">
        <button className="text-link" type="button" onClick={() => setStep('fare-settings')}>
          ← 料金設定に戻る
        </button>
        {renderStepIndicator()}
        <h1>運行ルートと運賃の確認</h1>

        <h2 className="pre-fixed-section-title">ルート</h2>
        <dl className="pre-fixed-consent-summary">
          <div>
            <dt>出発地</dt>
            <dd>{pickup.address}</dd>
          </div>
          {destinations
            .filter((dest) => dest.address.trim())
            .map((dest, index, list) => (
              <div key={`confirm-dest-${index}`}>
                <dt>
                  {index === list.length - 1 && list.length > 1
                    ? '最終目的地'
                    : `目的地${index + 1}`}
                </dt>
                <dd>{dest.address}</dd>
              </div>
            ))}
          <div>
            <dt>選択ルート</dt>
            <dd>
              {selectedRoute.id}{' '}
              {preFixedRouteCandidateLabels[selectedRoute.id] ?? selectedRoute.label}
            </dd>
          </div>
          <div>
            <dt>合計距離</dt>
            <dd>{formatRouteDistanceLabel(selectedRoute.distanceMeters)}</dd>
          </div>
          <div>
            <dt>予定所要時間</dt>
            <dd>{formatRouteDurationLabel(selectedRoute.durationSeconds)}</dd>
          </div>
        </dl>

        <h2 className="pre-fixed-section-title">料金内訳</h2>
        <dl className="pre-fixed-consent-summary">
          <div>
            <dt>運賃</dt>
            <dd>{formatFareYen(selectedRoute.fixedFareYen)}円</dd>
          </div>
          {fareSelection.dispatchEnabled ? (
            <div>
              <dt>迎車料金</dt>
              <dd>{formatFareYen(fareSelection.dispatchFareYen)}円</dd>
            </div>
          ) : null}
          {fareSelection.specialVehicleEnabled ? (
            <div>
              <dt>特殊車両料金</dt>
              <dd>{formatFareYen(fareSelection.specialVehicleFareYen)}円</dd>
            </div>
          ) : null}
          {fareSelection.boardingAssist ? (
            <div>
              <dt>乗降介助料金</dt>
              <dd>{formatFareYen(fareSelection.boardingAssistFareYen)}円</dd>
            </div>
          ) : null}
          {fareSelection.bodyAssist ? (
            <div>
              <dt>身体介助料金</dt>
              <dd>{formatFareYen(fareSelection.bodyAssistFareYen)}円</dd>
            </div>
          ) : null}
          {fareSelection.stairsAssist ? (
            <>
              <div>
                <dt>階段介助料金</dt>
                <dd>{formatFareYen(fareSelection.stairAssistFareYen)}円</dd>
              </div>
              <div>
                <dt>階数</dt>
                <dd>{fareSelection.stairFloorLabel ?? '—'}</dd>
              </div>
            </>
          ) : null}
          {fareSelection.equipmentItems.map((item) => (
            <div key={item.id}>
              <dt>{item.name}</dt>
              <dd>{formatFareYen(item.amountYen)}円</dd>
            </div>
          ))}
          {showWaitingNote ? (
            <div>
              <dt>待機料金（最初の30分）</dt>
              <dd>{formatFareYen(fareSelection.waitingFirstUnitYen)}円</dd>
            </div>
          ) : null}
          {showEscortNote ? (
            <div>
              <dt>付添料金（最初の30分）</dt>
              <dd>{formatFareYen(fareSelection.escortFirstUnitYen)}円</dd>
            </div>
          ) : null}
        </dl>

        <div className="pre-fixed-consent-summary__total">
          <dt>事前確定料金</dt>
          <dd className="pre-fixed-amount">{formatFareYen(preFixedTotalYen)}円</dd>
        </div>

        {showWaitingNote || showEscortNote ? (
          <p className="save-note" role="note">
            30分を超えた場合は、実際の待機・付添時間に応じて追加料金が加算されます。
          </p>
        ) : null}

        <div className="pre-fixed-flow-actions pre-fixed-confirm-edit-actions">
          <button className="secondary-action" type="button" onClick={() => setStep('destinations')}>
            ルートを修正
          </button>
          <button className="secondary-action" type="button" onClick={() => setStep('fare-settings')}>
            料金を修正
          </button>
        </div>

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

        {renderMeterSettingsStatus()}
        {consentError ? <p className="case-error" role="alert">{consentError}</p> : null}

        <div className="pre-fixed-flow-actions">
          <button
            className="primary-action"
            type="button"
            disabled={isStarting || !canProceedToManualFareSettings(meterSettingsState)}
            onClick={() => {
              void handleAgreeAndStart()
            }}
          >
            {isStarting ? '開始処理中...' : '同意確認して運行開始'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <main className="page pre-fixed-flow-page">
      {step === 'route-kind' ? renderRouteKindStep() : null}
      {step === 'pickup' ? renderPickupStep() : null}
      {step === 'destinations' ? renderDestinationsStep() : null}
      {step === 'routes' ? renderRoutesStep() : null}
      {step === 'fare-settings' ? renderFareSettingsStep() : null}
      {step === 'confirm' ? renderConfirmStep() : null}
    </main>
  )
}
