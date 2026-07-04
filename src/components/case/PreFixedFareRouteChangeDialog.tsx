import { useEffect, useMemo, useState } from 'react'
import { formatFareYen, type BasicFareSettings } from '../../services/fare'
import {
  calculateAdditionalRouteCandidates,
  formatDurationMinutes,
  formatRoutePathLabel,
} from '../../services/preFixedFareRoute'
import type {
  PreFixedFareRouteCandidate,
  PreFixedFareRouteChangeLocation,
  PreFixedFareRouteChangeLog,
  PreFixedFareRouteChangePattern,
  PreFixedFareRouteStop,
} from '../../types/preFixedFareRouteChange'
import { preFixedFareRouteChangePatternLabels } from '../../types/preFixedFareRouteChange'
import {
  captureCurrentAddressLocation,
  type CapturedAddressLocation,
} from '../../utils/reverseGeocode'

type DestinationInput = {
  id: string
  name: string
  address: string
}

type PreFixedFareRouteChangeDialogProps = {
  isOpen: boolean
  caseId: string
  reservationId: string
  driverName: string
  confirmedFareYen: number
  waitingFareYen: number
  escortFareYen: number
  overallStops: PreFixedFareRouteStop[]
  fareSettings: BasicFareSettings
  onClose: () => void
  onEndHere: (log: PreFixedFareRouteChangeLog) => void
  onTrafficDetour: (log: PreFixedFareRouteChangeLog) => void
  onPassengerRouteChangeConfirmed: (payload: {
    log: PreFixedFareRouteChangeLog
    nextStops: PreFixedFareRouteStop[]
    additionalRouteFareYen: number
    additionalCareFareYen: number
    startNavigation: boolean
  }) => void
}

type FlowStep =
  | 'locating'
  | 'pattern'
  | 'destinations'
  | 'routes'
  | 'confirm'
  | 'detour_reason'

const createDestinationId = () => `dest-${Math.random().toString(36).slice(2, 9)}`

const emptyDestination = (): DestinationInput => ({
  id: createDestinationId(),
  name: '',
  address: '',
})

const toLocation = (
  captured: CapturedAddressLocation,
): PreFixedFareRouteChangeLocation => ({
  lat: captured.latitude,
  lng: captured.longitude,
  accuracy: null,
  address: captured.address || '現在地（住所未取得）',
  capturedAt: captured.capturedAt || new Date().toISOString(),
})

const formatCapturedTime = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(date)
}

export function PreFixedFareRouteChangeDialog({
  isOpen,
  caseId,
  reservationId,
  driverName,
  confirmedFareYen,
  waitingFareYen,
  escortFareYen,
  overallStops,
  fareSettings,
  onClose,
  onEndHere,
  onTrafficDetour,
  onPassengerRouteChangeConfirmed,
}: PreFixedFareRouteChangeDialogProps) {
  const [step, setStep] = useState<FlowStep>('locating')
  const [locationError, setLocationError] = useState('')
  const [location, setLocation] = useState<PreFixedFareRouteChangeLocation | null>(null)
  const [pattern, setPattern] = useState<PreFixedFareRouteChangePattern | null>(null)
  const [viaStops, setViaStops] = useState<DestinationInput[]>([emptyDestination()])
  const [newDestination, setNewDestination] = useState<DestinationInput>(emptyDestination())
  const [routeCandidates, setRouteCandidates] = useState<PreFixedFareRouteCandidate[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [isCalculatingRoutes, setIsCalculatingRoutes] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [additionalCareFareYen, setAdditionalCareFareYen] = useState(0)
  const [detourReason, setDetourReason] = useState('')
  const [nextStops, setNextStops] = useState<PreFixedFareRouteStop[]>([])

  const routeBeforeLabel = useMemo(() => formatRoutePathLabel(overallStops), [overallStops])
  const originalFinalStop = overallStops[overallStops.length - 1] ?? null
  const selectedRoute = routeCandidates.find((route) => route.id === selectedRouteId) ?? null

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setStep('locating')
    setLocationError('')
    setLocation(null)
    setPattern(null)
    setViaStops([emptyDestination()])
    setNewDestination(emptyDestination())
    setRouteCandidates([])
    setSelectedRouteId('')
    setIsCalculatingRoutes(false)
    setRouteError('')
    setAdditionalCareFareYen(0)
    setDetourReason('')
    setNextStops([])

    let cancelled = false

    void captureCurrentAddressLocation()
      .then((captured) => {
        if (cancelled) {
          return
        }

        setLocation(toLocation(captured))
        setStep('pattern')
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        console.warn('Failed to capture current location for route change.', error)
        setLocationError('現在地を取得できませんでした。位置情報の許可を確認してください。')
        setLocation({
          lat: null,
          lng: null,
          accuracy: null,
          address: '現在地（取得失敗）',
          capturedAt: new Date().toISOString(),
        })
        setStep('pattern')
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const buildBaseLog = (
    selectedPattern: PreFixedFareRouteChangePattern,
    extras: Partial<PreFixedFareRouteChangeLog> = {},
  ): PreFixedFareRouteChangeLog => {
    const currentLocation = location ?? {
      lat: null,
      lng: null,
      accuracy: null,
      address: '現在地（未取得）',
      capturedAt: new Date().toISOString(),
    }

    return {
      changedAt: currentLocation.capturedAt,
      location: currentLocation,
      pattern: selectedPattern,
      reason: extras.reason ?? preFixedFareRouteChangePatternLabels[selectedPattern],
      routeBefore: routeBeforeLabel,
      routeAfter: extras.routeAfter ?? routeBeforeLabel,
      selectedRouteId: extras.selectedRouteId ?? '',
      selectedRouteSummary: extras.selectedRouteSummary ?? '',
      additionalDistanceKm: extras.additionalDistanceKm ?? 0,
      additionalDurationSeconds: extras.additionalDurationSeconds ?? 0,
      additionalRouteFareYen: extras.additionalRouteFareYen ?? 0,
      additionalCareFareYen: extras.additionalCareFareYen ?? 0,
      waitingFareYen,
      escortFareYen,
      totalFareYen:
        extras.totalFareYen ??
        confirmedFareYen + waitingFareYen + escortFareYen,
      consentAt: extras.consentAt ?? null,
      consentMethod: extras.consentMethod ?? '',
      navigationStartedAt: extras.navigationStartedAt ?? null,
      driverName,
      caseId,
      reservationId,
    }
  }

  const handleSelectPattern = (selected: PreFixedFareRouteChangePattern) => {
    setPattern(selected)

    if (selected === 'end_here') {
      const log = buildBaseLog(selected, {
        reason: 'お客様都合で現在地で運行終了',
        additionalRouteFareYen: 0,
        additionalCareFareYen: 0,
        totalFareYen: confirmedFareYen + waitingFareYen + escortFareYen,
        consentAt: new Date().toISOString(),
        consentMethod: 'driver_confirmed_end_here',
      })
      onEndHere(log)
      return
    }

    if (selected === 'traffic_detour') {
      setStep('detour_reason')
      return
    }

    setStep('destinations')
  }

  const buildNextStopsFromInputs = (): PreFixedFareRouteStop[] | null => {
    if (!location || !pattern) {
      return null
    }

    const currentStop: PreFixedFareRouteStop = {
      id: 'current',
      role: 'current',
      label: '現在地',
      address: location.address,
      latitude: location.lat,
      longitude: location.lng,
    }

    const viaRouteStops = viaStops
      .map((stop) => ({
        id: stop.id,
        role: 'via' as const,
        label: stop.name.trim() || stop.address.trim(),
        address: stop.address.trim() || stop.name.trim(),
      }))
      .filter((stop) => stop.address)

    if (pattern === 'add_stop') {
      if (viaRouteStops.length === 0 || !originalFinalStop) {
        return null
      }

      return [currentStop, ...viaRouteStops, originalFinalStop]
    }

    if (pattern === 'change_destination') {
      const destinationAddress = newDestination.address.trim() || newDestination.name.trim()
      if (!destinationAddress) {
        return null
      }

      return [
        currentStop,
        {
          id: newDestination.id,
          role: 'G',
          label: newDestination.name.trim() || destinationAddress,
          address: destinationAddress,
        },
      ]
    }

    if (pattern === 'add_stop_and_change_destination') {
      const destinationAddress = newDestination.address.trim() || newDestination.name.trim()
      if (viaRouteStops.length === 0 || !destinationAddress) {
        return null
      }

      return [
        currentStop,
        ...viaRouteStops,
        {
          id: newDestination.id,
          role: 'G',
          label: newDestination.name.trim() || destinationAddress,
          address: destinationAddress,
        },
      ]
    }

    return null
  }

  const handleCalculateRoutes = async () => {
    const builtStops = buildNextStopsFromInputs()
    if (!builtStops || builtStops.length < 2 || !location) {
      setRouteError('行き先を入力してください。')
      return
    }

    setRouteError('')
    setIsCalculatingRoutes(true)
    setNextStops(builtStops)

    try {
      const origin = {
        address: location.address,
        latitude: location.lat,
        longitude: location.lng,
      }
      const destinationStop = builtStops[builtStops.length - 1]
      const waypointStops = builtStops.slice(1, -1)
      const candidates = await calculateAdditionalRouteCandidates({
        origin,
        waypoints: waypointStops.map((stop) => ({
          address: stop.address,
          latitude: stop.latitude,
          longitude: stop.longitude,
        })),
        destination: {
          address: destinationStop.address,
          latitude: destinationStop.latitude,
          longitude: destinationStop.longitude,
        },
        fareSettings,
      })

      setRouteCandidates(candidates)
      setSelectedRouteId(candidates[0]?.id ?? '')
      setStep('routes')
    } catch (error) {
      console.warn('Failed to calculate additional routes.', error)
      setRouteError('ルート計算に失敗しました。入力内容を確認して再度お試しください。')
    } finally {
      setIsCalculatingRoutes(false)
    }
  }

  const handleOpenConfirm = () => {
    if (!selectedRoute) {
      setRouteError('ルートを選択してください。')
      return
    }

    setStep('confirm')
  }

  const handleConfirm = (startNavigation: boolean) => {
    if (!pattern || !selectedRoute) {
      return
    }

    const routeAfter = formatRoutePathLabel(nextStops)
    const totalFareYen =
      confirmedFareYen +
      selectedRoute.additionalFareYen +
      additionalCareFareYen +
      waitingFareYen +
      escortFareYen

    const log = buildBaseLog(pattern, {
      routeAfter,
      selectedRouteId: selectedRoute.id,
      selectedRouteSummary: selectedRoute.summary,
      additionalDistanceKm: selectedRoute.distanceKm,
      additionalDurationSeconds: selectedRoute.durationSeconds,
      additionalRouteFareYen: selectedRoute.additionalFareYen,
      additionalCareFareYen,
      totalFareYen,
      consentAt: new Date().toISOString(),
      consentMethod: 'passenger_consent',
      navigationStartedAt: startNavigation ? new Date().toISOString() : null,
    })

    onPassengerRouteChangeConfirmed({
      log,
      nextStops,
      additionalRouteFareYen: selectedRoute.additionalFareYen,
      additionalCareFareYen,
      startNavigation,
    })
  }

  const handleTrafficDetourConfirm = () => {
    const log = buildBaseLog('traffic_detour', {
      reason: detourReason.trim() || '交通規制・迂回',
      additionalRouteFareYen: 0,
      additionalCareFareYen: 0,
      totalFareYen: confirmedFareYen + waitingFareYen + escortFareYen,
      consentAt: new Date().toISOString(),
      consentMethod: 'driver_judgment',
    })
    onTrafficDetour(log)
  }

  const totalPreviewYen =
    confirmedFareYen +
    (selectedRoute?.additionalFareYen ?? 0) +
    additionalCareFareYen +
    waitingFareYen +
    escortFareYen

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        aria-labelledby="pre-fixed-route-change-title"
        aria-modal="true"
        className="settings-modal pre-fixed-route-dialog"
        role="dialog"
      >
        <header className="settings-header">
          <div>
            <span>ルート変更</span>
            <h2 id="pre-fixed-route-change-title">ルート変更</h2>
          </div>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        {step === 'locating' ? (
          <p className="lead">現在地GPSログを取得しています…</p>
        ) : null}

        {step === 'pattern' && location ? (
          <div className="pre-fixed-route-change-body">
            <p className="lead">現在地を取得しました</p>
            <p>{location.address}</p>
            <p className="empty-note">取得時刻：{formatCapturedTime(location.capturedAt)}</p>
            {locationError ? <p className="save-note save-note--error">{locationError}</p> : null}
            <p>変更内容を選択してください</p>
            <div className="pre-fixed-route-pattern-list">
              {(Object.keys(preFixedFareRouteChangePatternLabels) as PreFixedFareRouteChangePattern[]).map(
                (item) => (
                  <button
                    key={item}
                    className="secondary-action"
                    type="button"
                    onClick={() => handleSelectPattern(item)}
                  >
                    {preFixedFareRouteChangePatternLabels[item]}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}

        {step === 'destinations' && pattern ? (
          <div className="pre-fixed-route-change-body">
            <p className="lead">{preFixedFareRouteChangePatternLabels[pattern]}</p>

            {pattern === 'add_stop' || pattern === 'add_stop_and_change_destination' ? (
              <div className="pre-fixed-destination-list">
                {viaStops.map((stop, index) => (
                  <fieldset key={stop.id} className="pre-fixed-destination-fieldset">
                    <legend>立ち寄り先{index + 1}</legend>
                    <label>
                      施設名
                      <input
                        value={stop.name}
                        onChange={(event) => {
                          const value = event.target.value
                          setViaStops((current) =>
                            current.map((item) =>
                              item.id === stop.id ? { ...item, name: value } : item,
                            ),
                          )
                        }}
                      />
                    </label>
                    <label>
                      住所・地図指定
                      <input
                        placeholder="住所を入力"
                        value={stop.address}
                        onChange={(event) => {
                          const value = event.target.value
                          setViaStops((current) =>
                            current.map((item) =>
                              item.id === stop.id ? { ...item, address: value } : item,
                            ),
                          )
                        }}
                      />
                    </label>
                  </fieldset>
                ))}
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setViaStops((current) => [...current, emptyDestination()])}
                >
                  立ち寄り先を追加
                </button>
              </div>
            ) : null}

            {pattern === 'change_destination' || pattern === 'add_stop_and_change_destination' ? (
              <fieldset className="pre-fixed-destination-fieldset">
                <legend>新しい目的地</legend>
                <label>
                  施設名
                  <input
                    value={newDestination.name}
                    onChange={(event) =>
                      setNewDestination((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  住所・地図指定
                  <input
                    placeholder="住所を入力"
                    value={newDestination.address}
                    onChange={(event) =>
                      setNewDestination((current) => ({ ...current, address: event.target.value }))
                    }
                  />
                </label>
              </fieldset>
            ) : null}

            {pattern === 'add_stop' && originalFinalStop ? (
              <p className="empty-note">
                最終目的地（変更なし）: {originalFinalStop.label || originalFinalStop.address}
              </p>
            ) : null}

            {routeError ? <p className="save-note save-note--error">{routeError}</p> : null}

            <div className="r9-confirm-actions">
              <button
                className="r9-flow-primary"
                type="button"
                disabled={isCalculatingRoutes}
                onClick={() => {
                  void handleCalculateRoutes()
                }}
              >
                {isCalculatingRoutes ? 'ルート計算中…' : 'ルートを計算'}
              </button>
              <button className="secondary-action" type="button" onClick={() => setStep('pattern')}>
                戻る
              </button>
            </div>
          </div>
        ) : null}

        {step === 'routes' ? (
          <div className="pre-fixed-route-change-body">
            <p className="lead">{selectedRoute?.summary || formatRoutePathLabel(nextStops)}</p>
            <div className="pre-fixed-route-candidate-list">
              {routeCandidates.map((route) => (
                <label key={route.id} className="pre-fixed-route-candidate">
                  <input
                    checked={selectedRouteId === route.id}
                    name="pre-fixed-route-candidate"
                    type="radio"
                    onChange={() => setSelectedRouteId(route.id)}
                  />
                  <span>
                    <strong>{route.label}</strong>
                    <span>距離：{route.distanceKm.toFixed(1)}km</span>
                    <span>所要時間：{formatDurationMinutes(route.durationSeconds)}</span>
                    <span>追加運賃：{formatFareYen(route.additionalFareYen)}円</span>
                  </span>
                </label>
              ))}
            </div>
            {routeError ? <p className="save-note save-note--error">{routeError}</p> : null}
            <div className="r9-confirm-actions">
              <button className="r9-flow-primary" type="button" onClick={handleOpenConfirm}>
                このルートで料金確認
              </button>
              <button className="secondary-action" type="button" onClick={() => setStep('destinations')}>
                戻る
              </button>
            </div>
          </div>
        ) : null}

        {step === 'confirm' && selectedRoute ? (
          <div className="pre-fixed-route-change-body">
            <p className="lead">ルート変更の確認</p>
            <dl className="reservation-detail-dl">
              <div>
                <dt>元の事前確定運賃</dt>
                <dd>{formatFareYen(confirmedFareYen)}円</dd>
              </div>
              <div>
                <dt>追加ルート運賃</dt>
                <dd>{formatFareYen(selectedRoute.additionalFareYen)}円</dd>
              </div>
              <div>
                <dt>追加介助料</dt>
                <dd>
                  <input
                    min="0"
                    step="10"
                    type="number"
                    value={additionalCareFareYen}
                    onChange={(event) =>
                      setAdditionalCareFareYen(Math.max(Math.round(Number(event.target.value) || 0), 0))
                    }
                  />
                  円
                </dd>
              </div>
              <div>
                <dt>待機料</dt>
                <dd>{formatFareYen(waitingFareYen)}円</dd>
              </div>
              <div>
                <dt>付き添い料</dt>
                <dd>{formatFareYen(escortFareYen)}円</dd>
              </div>
              <div>
                <dt>合計請求額</dt>
                <dd>
                  <strong>{formatFareYen(totalPreviewYen)}円</strong>
                </dd>
              </div>
              <div>
                <dt>変更後ルート</dt>
                <dd>{formatRoutePathLabel(nextStops)}</dd>
              </div>
            </dl>
            <p className="empty-note">追加介助料は初期値0円です。追加の介助作業がある場合のみ入力してください。</p>
            <div className="r9-confirm-actions">
              <button className="r9-flow-primary" type="button" onClick={() => handleConfirm(true)}>
                お客様承諾済み / このルートでナビ開始
              </button>
              <button className="secondary-action" type="button" onClick={() => handleConfirm(false)}>
                お客様承諾済み（ナビは後で）
              </button>
              <button className="secondary-action" type="button" onClick={() => setStep('routes')}>
                戻る
              </button>
            </div>
          </div>
        ) : null}

        {step === 'detour_reason' ? (
          <div className="pre-fixed-route-change-body">
            <p className="lead">⑤ 交通規制・迂回</p>
            <p>追加運賃は請求しません。変更理由を記録してください。</p>
            <label>
              変更理由
              <textarea
                rows={3}
                value={detourReason}
                onChange={(event) => setDetourReason(event.target.value)}
                placeholder="通行止め / 事故 / 工事 / 渋滞回避 / 安全上の判断 など"
              />
            </label>
            <div className="r9-confirm-actions">
              <button className="r9-flow-primary" type="button" onClick={handleTrafficDetourConfirm}>
                ログ保存して運行継続
              </button>
              <button className="secondary-action" type="button" onClick={() => setStep('pattern')}>
                戻る
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
