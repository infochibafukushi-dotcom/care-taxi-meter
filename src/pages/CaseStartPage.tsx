import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import { readPostSettlementLock } from '../services/postSettlementLock'
import { fetchCompanyById, getCompanyMeterPermissions } from '../services/companies'
import { readReservationTripContext } from '../services/reservationTripContext'
import {
  defaultMeterPermissions,
  getAllowedMeterModes,
} from '../services/subscriptionPlans'
import { tenantAccessScopeFromSessionSource } from '../services/tenancy'
import { getSelectableVehicles } from '../services/vehicles'
import type { MeterMode } from '../types/case'
import type { MeterPermissions, Vehicle } from '../types/work'
import { logDiagnostic } from '../utils/diagnostics'
import {
  clampMeterModeToPermissions,
  meterModeLabels,
  readStoredMeterMode,
} from '../utils/meterConstants'

const EMPTY_VEHICLES_MESSAGE =
  '選択できる車両がありません。車両管理で車両が登録済みの場合は、ログイン中の店舗情報または車両の有効状態を確認してください。'

export function CaseStartPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const reservationId = searchParams.get('reservationId')?.trim() ?? ''
  const isReservationStart = reservationId.length > 0
  const reservationTripContext = useMemo(
    () => (isReservationStart ? readReservationTripContext(reservationId) : null),
    [isReservationStart, reservationId],
  )
  const workSession = useWorkSession()
  const accessScope = useMemo(
    () => tenantAccessScopeFromSessionSource(workSession.currentSession),
    [workSession.currentSession],
  )
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(false)
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [selectedMeterMode, setSelectedMeterMode] = useState<MeterMode>(
    () => (isReservationStart ? 'fixed' : readStoredMeterMode()),
  )
  const [meterPermissions, setMeterPermissions] = useState<MeterPermissions>(defaultMeterPermissions)
  const [message, setMessage] = useState('稼働中車両を読み込み中です。')
  const [activeTripSnapshot] = useState(readActiveTripSnapshot)
  const [postSettlementLock] = useState(readPostSettlementLock)

  useEffect(() => {
    if (postSettlementLock) {
      navigate('/case', { replace: true })
    }
  }, [navigate, postSettlementLock])

  useEffect(() => {
    logDiagnostic('CaseStartPage mount')
    return () => logDiagnostic('CaseStartPage unmount')
  }, [])

  useEffect(() => {
    const franchiseeId =
      workSession.currentSession?.franchiseeId || workSession.currentSession?.companyId

    if (!franchiseeId) {
      setMeterPermissions(defaultMeterPermissions)
      return
    }

    void fetchCompanyById(franchiseeId).then((company) => {
      const permissions = getCompanyMeterPermissions(company)
      setMeterPermissions(permissions)
      if (!isReservationStart) {
        setSelectedMeterMode((currentMode) => clampMeterModeToPermissions(currentMode, permissions))
      }
    })
  }, [isReservationStart, workSession.currentSession])

  useEffect(() => {
    let isMounted = true

    if (!workSession.currentSession) {
      setVehicles([])
      setIsLoadingVehicles(false)
      return () => {
        isMounted = false
      }
    }

    const franchiseeId = accessScope.franchiseeId
    if (!franchiseeId) {
      setVehicles([])
      setIsLoadingVehicles(false)
      setMessage(EMPTY_VEHICLES_MESSAGE)
      return () => {
        isMounted = false
      }
    }

    setIsLoadingVehicles(true)
    setMessage('稼働中車両を読み込み中です。')

    getSelectableVehicles(accessScope)
      .then((loadedVehicles) => {
        if (!isMounted) {
          return
        }

        setVehicles(loadedVehicles)
        setIsLoadingVehicles(false)
        setMessage(
          loadedVehicles.length === 0
            ? EMPTY_VEHICLES_MESSAGE
            : isReservationStart
              ? '予約連携の事前確定Mで使用する車両を選択してください。'
              : '案件で使用する車両とメーター方式を選択してください。',
        )
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setVehicles([])
        setIsLoadingVehicles(false)
        setMessage(error instanceof Error ? error.message : '車両の読み込みに失敗しました。')
      })

    return () => {
      isMounted = false
    }
  }, [accessScope, isReservationStart, workSession.currentSession])

  const availableVehicles = vehicles

  const allowedMeterModes = useMemo(
    () => getAllowedMeterModes(meterPermissions),
    [meterPermissions],
  )

  const selectedVehicleValue = selectedVehicleId || availableVehicles[0]?.id || ''
  const selectedMeterModeValue: MeterMode = isReservationStart
    ? 'fixed'
    : allowedMeterModes.includes(selectedMeterMode as 'gps' | 'time' | 'obd')
      ? selectedMeterMode
      : allowedMeterModes[0] ?? 'gps'

  const handleStartCase = () => {
    if (activeTripSnapshot) {
      setMessage('未終了の運行があります。新規案件開始の前に運行を復元してください。')
      return
    }

    if (isReservationStart && !reservationTripContext) {
      setMessage('予約連携情報が見つかりません。予約詳細から再度「事前確定Mで開始」してください。')
      return
    }

    if (!selectedVehicleValue) {
      setMessage(isLoadingVehicles ? '車両を読み込み中です。' : EMPTY_VEHICLES_MESSAGE)
      return
    }

    if (
      !isReservationStart &&
      selectedMeterModeValue !== 'fixed' &&
      !allowedMeterModes.includes(selectedMeterModeValue)
    ) {
      setMessage('選択したメーター方式は利用できません。')
      return
    }

    const query = new URLSearchParams({
      vehicleId: selectedVehicleValue,
      meterMode: selectedMeterModeValue,
    })
    if (isReservationStart) {
      query.set('reservationId', reservationId)
    }

    navigate(`/case?${query.toString()}`)
  }

  if (activeTripSnapshot) {
    return (
      <main className="page" aria-labelledby="case-start-title">
        <section className="hero-card">
          <p className="eyebrow">Trip Restore</p>
          <h1 id="case-start-title">未終了の運行があります。</h1>
          <p className="lead">案件番号 {activeTripSnapshot.caseNumber} / 状態 {activeTripSnapshot.status} の運行を復元してください。</p>
          <button className="primary-action" type="button" onClick={() => navigate('/case')}>運行を復元</button>
        </section>
      </main>
    )
  }

  if (!workSession.currentSession) {
    return (
      <main className="page" aria-labelledby="case-start-title">
        <section className="hero-card">
          <p className="eyebrow">Case Start</p>
          <h1 id="case-start-title">案件開始</h1>
          <p className="save-note" role="status">未出勤です。案件開始前にTOP画面でログインして出勤してください。</p>
          <Link className="primary-action" to="/">TOPへ戻る</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page" aria-labelledby="case-start-title">
      <section className="hero-card work-session-card">
        <p className="eyebrow">Case Start</p>
        <h1 id="case-start-title">
          {isReservationStart ? '予約連携の案件開始' : '案件開始前の車両選択'}
        </h1>
        <p className="lead">
          {isReservationStart
            ? '事前確定Mの予約連携です。使用する車両を選択してください。'
            : '出勤中の会社・店舗に所属する稼働可能な車両を表示します。'}
        </p>
        {isReservationStart && reservationTripContext ? (
          <p className="save-note" role="status">
            予約ID {reservationTripContext.reservationId} / 利用者 {reservationTripContext.customerName || '未設定'}
          </p>
        ) : null}
        {isReservationStart && !reservationTripContext ? (
          <p className="case-error" role="alert">
            予約連携情報が見つかりません。予約詳細から再度開始してください。
          </p>
        ) : null}
        <div className="work-session-grid">
          <label>
            店舗
            <input readOnly value={workSession.currentSession.storeName} />
          </label>
          <label>
            担当スタッフ
            <input readOnly value={workSession.currentSession.staffName} />
          </label>
          <label>
            使用車両
            <select
              value={selectedVehicleValue}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
              disabled={isLoadingVehicles}
            >
              <option value="">{isLoadingVehicles ? '読み込み中...' : '車両を選択'}</option>
              {availableVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name} / {vehicle.number || 'ナンバー未設定'}
                </option>
              ))}
            </select>
          </label>
          {isReservationStart ? (
            <label>
              メーター方式
              <input readOnly value={meterModeLabels.fixed} />
            </label>
          ) : (
            <label>
              メーター方式
              <select
                value={selectedMeterModeValue}
                onChange={(event) => setSelectedMeterMode(event.target.value as MeterMode)}
              >
                {allowedMeterModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {meterModeLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className={availableVehicles.length === 0 && !isLoadingVehicles ? 'case-error' : 'save-note'} role="status">
          {message}
        </p>
        <button
          className="primary-action"
          type="button"
          disabled={(isReservationStart && !reservationTripContext) || isLoadingVehicles || availableVehicles.length === 0}
          onClick={handleStartCase}
        >
          メーター画面へ進む
        </button>
      </section>
    </main>
  )
}
