import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import { readPostSettlementLock } from '../services/postSettlementLock'
import { fetchCompanyById, getCompanyMeterPermissions } from '../services/companies'
import {
  defaultMeterPermissions,
  getAllowedMeterModes,
} from '../services/subscriptionPlans'
import { fetchVehicles } from '../services/vehicles'
import type { MeterMode } from '../types/case'
import type { MeterPermissions, Vehicle } from '../types/work'
import { logDiagnostic } from '../utils/diagnostics'
import {
  clampMeterModeToPermissions,
  meterModeLabels,
  readStoredMeterMode,
} from '../utils/meterConstants'

export function CaseStartPage() {
  const navigate = useNavigate()
  const workSession = useWorkSession()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [selectedMeterMode, setSelectedMeterMode] = useState<MeterMode>(readStoredMeterMode)
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
      setSelectedMeterMode((currentMode) => clampMeterModeToPermissions(currentMode, permissions))
    })
  }, [workSession.currentSession])

  useEffect(() => {
    let isMounted = true

    fetchVehicles()
      .then((loadedVehicles) => {
        if (!isMounted) {
          return
        }

        setVehicles(loadedVehicles)
        setMessage('案件で使用する車両とメーター方式を選択してください。')
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setMessage(error instanceof Error ? error.message : '車両の読み込みに失敗しました。')
      })

    return () => {
      isMounted = false
    }
  }, [])

  const availableVehicles = useMemo(
    () => vehicles.filter(
      (vehicle) =>
        vehicle.enabled &&
        vehicle.status === '稼働中' &&
        vehicle.companyId === workSession.currentSession?.companyId &&
        vehicle.storeId === workSession.currentSession?.storeId,
    ),
    [vehicles, workSession.currentSession],
  )

  const allowedMeterModes = useMemo(
    () => getAllowedMeterModes(meterPermissions),
    [meterPermissions],
  )

  const selectedVehicleValue = selectedVehicleId || availableVehicles[0]?.id || ''
  const selectedMeterModeValue = allowedMeterModes.includes(selectedMeterMode)
    ? selectedMeterMode
    : allowedMeterModes[0] ?? 'gps'

  const handleStartCase = () => {
    if (activeTripSnapshot) {
      setMessage('未終了の運行があります。新規案件開始の前に運行を復元してください。')
      return
    }

    if (!selectedVehicleValue) {
      setMessage('案件で使用する車両を選択してください。')
      return
    }

    if (!allowedMeterModes.includes(selectedMeterModeValue)) {
      setMessage('選択したメーター方式は利用できません。')
      return
    }

    navigate(
      `/case?vehicleId=${encodeURIComponent(selectedVehicleValue)}&meterMode=${encodeURIComponent(selectedMeterModeValue)}`,
    )
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
        <h1 id="case-start-title">案件開始前の車両選択</h1>
        <p className="lead">出勤中の会社・店舗に所属する稼働中車両のみ表示します。</p>
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
            <select value={selectedVehicleValue} onChange={(event) => setSelectedVehicleId(event.target.value)}>
              <option value="">車両を選択</option>
              {availableVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name} / {vehicle.number || 'ナンバー未設定'}
                </option>
              ))}
            </select>
          </label>
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
        </div>
        <p className="save-note">{message}</p>
        <button className="primary-action" type="button" onClick={handleStartCase}>メーター画面へ進む</button>
      </section>
    </main>
  )
}
