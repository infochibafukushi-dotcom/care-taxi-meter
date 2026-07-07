import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import { clearStalePreFixedStateForNormalCaseStart } from '../services/preFixedFareCleanup'
import { fetchCompanyById, getCompanyMeterPermissions } from '../services/companies'
import { readReservationTripContext } from '../services/reservationTripContext'
import {
  defaultMeterPermissions,
  getAllowedMeterModes,
} from '../services/subscriptionPlans'
import { waitForFirebaseAuthUser } from '../services/firebaseAuth'
import { tenantAccessScopeFromSessionSource } from '../services/tenancy'
import {
  claimVehicleForCaseStart,
  getSelectableVehiclesWithAvailability,
  getVehicleOptionLabel,
  toVehicleAvailabilityUserMessage,
  VEHICLE_IN_USE_MESSAGE,
  type SelectableVehicleWithAvailability,
} from '../services/vehicleAvailability'
import type { MeterMode } from '../types/case'
import type { MeterPermissions } from '../types/work'
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
  const currentStaffId = workSession.currentSession?.staffId ?? ''
  const [vehicles, setVehicles] = useState<SelectableVehicleWithAvailability[]>([])
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(false)
  const [isStartingCase, setIsStartingCase] = useState(false)
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [selectedMeterMode, setSelectedMeterMode] = useState<MeterMode>(() => {
    if (isReservationStart) {
      return 'fixed'
    }
    const stored = readStoredMeterMode()
    return stored === 'fixed' ? 'gps' : stored
  })
  const [meterPermissions, setMeterPermissions] = useState<MeterPermissions>(defaultMeterPermissions)
  const [message, setMessage] = useState('稼働中車両を読み込み中です。')
  const [activeTripSnapshot] = useState(readActiveTripSnapshot)

  useEffect(() => {
    if (isReservationStart) {
      return
    }
    clearStalePreFixedStateForNormalCaseStart()
  }, [isReservationStart])

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

  const loadVehicles = useCallback(async () => {
    if (!workSession.currentSession || !accessScope.franchiseeId || !currentStaffId) {
      setVehicles([])
      return [] as SelectableVehicleWithAvailability[]
    }

    const loadedVehicles = await getSelectableVehiclesWithAvailability(accessScope, currentStaffId)
    setVehicles(loadedVehicles)
    return loadedVehicles
  }, [accessScope, currentStaffId, workSession.currentSession])

  useEffect(() => {
    let isMounted = true

    if (!workSession.currentSession) {
      setVehicles([])
      setIsLoadingVehicles(false)
      return () => {
        isMounted = false
      }
    }

    if (!accessScope.franchiseeId) {
      setVehicles([])
      setIsLoadingVehicles(false)
      setMessage(EMPTY_VEHICLES_MESSAGE)
      return () => {
        isMounted = false
      }
    }

    setIsLoadingVehicles(true)
    setMessage('稼働中車両を読み込み中です。')

    void (async () => {
      const firebaseUser = await waitForFirebaseAuthUser()
      if (!isMounted) {
        return
      }

      if (!firebaseUser) {
        setVehicles([])
        setIsLoadingVehicles(false)
        setMessage('ログインセッションの有効期限が切れました。再度ログインしてください。')
        return
      }

      try {
        const loadedVehicles = await loadVehicles()
        if (!isMounted) {
          return
        }

        setIsLoadingVehicles(false)
        const selectableCount = loadedVehicles.filter((vehicle) => vehicle.isSelectable).length
        setMessage(
          loadedVehicles.length === 0
            ? EMPTY_VEHICLES_MESSAGE
            : selectableCount === 0
              ? '現在選択できる車両がありません。使用中の車両が解放されるまでお待ちください。'
              : isReservationStart
                ? '予約連携の事前確定Mで使用する車両を選択してください。'
                : '案件で使用する車両とメーター方式を選択してください。',
        )
      } catch (error) {
        if (!isMounted) {
          return
        }

        setVehicles([])
        setIsLoadingVehicles(false)
        setMessage(toVehicleAvailabilityUserMessage(error))
      }
    })()

    return () => {
      isMounted = false
    }
  }, [accessScope.franchiseeId, isReservationStart, loadVehicles, workSession.currentSession])

  const selectableVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.isSelectable),
    [vehicles],
  )

  const allowedMeterModes = useMemo(
    () => getAllowedMeterModes(meterPermissions),
    [meterPermissions],
  )

  const selectedVehicleValue = useMemo(() => {
    if (selectedVehicleId) {
      const selected = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
      if (selected?.isSelectable) {
        return selectedVehicleId
      }
    }

    return selectableVehicles[0]?.id || ''
  }, [selectedVehicleId, selectableVehicles, vehicles])

  const selectedMeterModeValue: MeterMode = isReservationStart
    ? 'fixed'
    : (() => {
        const normalizedMode =
          selectedMeterMode === 'fixed' ? 'gps' : selectedMeterMode
        return allowedMeterModes.includes(normalizedMode)
          ? normalizedMode
          : allowedMeterModes[0] ?? 'gps'
      })()

  const handleStartCase = async () => {
    if (isStartingCase) {
      return
    }

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

    const session = workSession.currentSession
    if (!session) {
      setMessage('未出勤です。案件開始前にTOP画面でログインして出勤してください。')
      return
    }

    setIsStartingCase(true)
    setMessage('車両の利用状況を確認しています。')

    try {
      await waitForFirebaseAuthUser()
      await claimVehicleForCaseStart({
        vehicleId: selectedVehicleValue,
        staffId: session.staffId,
        staffName: session.staffName,
        workSessionId: session.id,
      })

      const query = new URLSearchParams({
        vehicleId: selectedVehicleValue,
        meterMode: selectedMeterModeValue,
      })
      if (isReservationStart) {
        query.set('reservationId', reservationId)
        navigate(`/case?${query.toString()}`)
        return
      }

      navigate(`/case?${query.toString()}`)
    } catch (error) {
      const errorMessage = toVehicleAvailabilityUserMessage(error, VEHICLE_IN_USE_MESSAGE)
      setMessage(errorMessage)

      try {
        const refreshedVehicles = await loadVehicles()
        const selectableCount = refreshedVehicles.filter((vehicle) => vehicle.isSelectable).length
        if (selectableCount === 0 && refreshedVehicles.length > 0) {
          setMessage(`${errorMessage} 現在選択できる車両がありません。`)
        }
        if (
          selectedVehicleId &&
          refreshedVehicles.some((vehicle) => vehicle.id === selectedVehicleId && vehicle.isInUse)
        ) {
          setSelectedVehicleId('')
        }
      } catch {
        // 一覧再取得に失敗しても開始エラーは表示済み
      }
    } finally {
      setIsStartingCase(false)
    }
  }

  if (activeTripSnapshot) {
    return (
      <main className="page" aria-labelledby="case-start-title">
        <section className="hero-card">
          <p className="eyebrow">Trip Restore</p>
          <h1 id="case-start-title">未終了の運行があります。</h1>
          <p className="lead">案件番号 {activeTripSnapshot.caseNumber} / 状態 {activeTripSnapshot.status} の運行を復元してください。</p>
          <button className="primary-action" type="button" onClick={() => navigate('/case')}>運行を復元</button>
          <Link className="secondary-action" to="/">TOPに戻る</Link>
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
          <Link className="primary-action" to="/">TOPに戻る</Link>
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
              disabled={isLoadingVehicles || isStartingCase}
            >
              <option value="">{isLoadingVehicles ? '読み込み中...' : '車両を選択'}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id} disabled={vehicle.isInUse}>
                  {getVehicleOptionLabel(vehicle)}
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
                disabled={isStartingCase}
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
        <p
          className={
            (selectableVehicles.length === 0 && !isLoadingVehicles) ||
            message.includes(VEHICLE_IN_USE_MESSAGE)
              ? 'case-error'
              : 'save-note'
          }
          role="status"
        >
          {message}
        </p>
        <div className="case-start-actions">
          <button
            className="primary-action"
            type="button"
            disabled={
              (isReservationStart && !reservationTripContext) ||
              isLoadingVehicles ||
              isStartingCase ||
              selectableVehicles.length === 0
            }
            onClick={() => {
              void handleStartCase()
            }}
          >
            {isStartingCase ? '確認中...' : 'メーター画面へ進む'}
          </button>
          <Link className="secondary-action" to="/">
            TOPに戻る
          </Link>
        </div>
      </section>
    </main>
  )
}
