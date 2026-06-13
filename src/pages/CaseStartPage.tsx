import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWorkSession } from '../hooks/useWorkSession'
import { readActiveTripSnapshot } from '../services/activeTripSnapshot'
import { fetchVehicles } from '../services/vehicles'
import type { Vehicle } from '../types/work'

export function CaseStartPage() {
  const navigate = useNavigate()
  const workSession = useWorkSession()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [message, setMessage] = useState('稼働中車両を読み込み中です。')
  const [activeTripSnapshot] = useState(readActiveTripSnapshot)

  useEffect(() => {
    let isMounted = true

    fetchVehicles()
      .then((loadedVehicles) => {
        if (!isMounted) {
          return
        }

        setVehicles(loadedVehicles)
        setMessage('案件で使用する車両を選択してください。')
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

  const selectedVehicleValue = selectedVehicleId || availableVehicles[0]?.id || ''

  const handleStartCase = () => {
    if (activeTripSnapshot) {
      setMessage('未終了の運行があります。新規案件開始の前に運行を復元してください。')
      return
    }

    if (!selectedVehicleValue) {
      setMessage('案件で使用する車両を選択してください。')
      return
    }

    navigate(`/case?vehicleId=${encodeURIComponent(selectedVehicleValue)}`)
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
        </div>
        <p className="save-note">{message}</p>
        <button className="primary-action" type="button" onClick={handleStartCase}>メーター画面へ進む</button>
      </section>
    </main>
  )
}
