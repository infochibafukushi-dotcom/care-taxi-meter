import { useMemo, useState } from 'react'
import { CaseHeader } from '../components/case/CaseHeader'
import { GpsPanel } from '../components/case/GpsPanel'
import { MeterActions } from '../components/case/MeterActions'
import { MeterSummary } from '../components/case/MeterSummary'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useOperationTimers } from '../hooks/useOperationTimers'
import {
  calculateAccompanimentFareYen,
  calculateBasicFareYen,
  calculateWaitingFareYen,
  formatFareYen,
} from '../services/fare'
import type {
  MeterAction,
  MeterMetric,
  OperationStatus,
  StatusTone,
  TimerKey,
} from '../types/case'

const statusToneMap: Record<OperationStatus, StatusTone> = {
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
  走行中: 'driving',
  精算前: 'settlement',
  案件終了: 'closed',
}

const activeTimerMap: Partial<Record<OperationStatus, TimerKey>> = {
  走行中: 'driving',
  待機中: 'waiting',
  院内付き添い中: 'accompanying',
}

const meterActions: MeterAction[] = [
  { label: '運行開始', variant: 'primary', nextStatus: '走行中' },
  { label: '待機開始', variant: 'secondary', nextStatus: '待機中' },
  { label: '待機解除', variant: 'secondary', nextStatus: '走行中' },
  {
    label: '院内付き添い開始',
    variant: 'secondary',
    nextStatus: '院内付き添い中',
  },
  { label: '介助追加', variant: 'accent' },
  { label: '実費追加', variant: 'accent' },
  { label: '精算', variant: 'primary', nextStatus: '精算前' },
  { label: '案件終了', variant: 'danger', nextStatus: '案件終了' },
]

export function CasePage() {
  const [status, setStatus] = useState<OperationStatus>('待機中')
  const [activeTimer, setActiveTimer] = useState<TimerKey | null>(null)
  const [isGpsActive, setIsGpsActive] = useState(false)
  const elapsedTimers = useOperationTimers(activeTimer)
  const gps = useCurrentPosition(isGpsActive)
  const basicFareYen = calculateBasicFareYen(gps.totalDistanceKm)
  const waitingFareYen = calculateWaitingFareYen(elapsedTimers.seconds.waiting)
  const accompanimentFareYen = calculateAccompanimentFareYen(
    elapsedTimers.seconds.accompanying,
  )
  const totalFareYen = basicFareYen + waitingFareYen + accompanimentFareYen

  const meterMetrics: MeterMetric[] = useMemo(
    () => [
      {
        label: '現在料金',
        value: formatFareYen(totalFareYen),
        unit: '円',
        tone: 'fare',
      },
      {
        label: '基本運賃',
        value: formatFareYen(basicFareYen),
        unit: '円',
        tone: 'fare',
      },
      {
        label: '待機料金',
        value: formatFareYen(waitingFareYen),
        unit: '円',
        tone: 'fare',
      },
      {
        label: '院内付き添い料金',
        value: formatFareYen(accompanimentFareYen),
        unit: '円',
        tone: 'fare',
      },
      { label: '運行時間', value: elapsedTimers.driving, tone: 'timer' },
      { label: '待機時間', value: elapsedTimers.waiting, tone: 'timer' },
      {
        label: '院内付き添い時間',
        value: elapsedTimers.accompanying,
        tone: 'timer',
      },
    ],
    [
      accompanimentFareYen,
      basicFareYen,
      elapsedTimers,
      totalFareYen,
      waitingFareYen,
    ],
  )

  const handleStatusChange = (nextStatus: OperationStatus) => {
    setStatus(nextStatus)
    setActiveTimer(activeTimerMap[nextStatus] ?? null)

    if (nextStatus === '走行中') {
      setIsGpsActive(true)
    }

    if (nextStatus === '案件終了') {
      setIsGpsActive(false)
    }
  }

  return (
    <main
      className={`meter-page meter-page--${statusToneMap[status]}`}
      aria-labelledby="case-title"
    >
      <div className="meter-screen">
        <CaseHeader
          caseNumber="CASE-20260530-001"
          status={status}
          statusTone={statusToneMap[status]}
        />

        <section className="meter-title-block">
          <p className="eyebrow">Care Taxi Meter</p>
          <h1 id="case-title">介護タクシーメーター</h1>
          <p>
            現在料金は基本運賃、待機料金、院内付き添い料金を合算します。介助料金、領収書、Firebase保存は未実装です。
          </p>
        </section>

        <MeterSummary metrics={meterMetrics} />
        <GpsPanel
          errorMessage={gps.errorMessage}
          gpsLogCount={gps.gpsLogCount}
          isActive={gps.isActive}
          position={gps.position}
          status={gps.status}
          totalDistanceKm={gps.totalDistanceKm}
        />
        <MeterActions
          actions={meterActions}
          onStatusChange={handleStatusChange}
        />
      </div>
    </main>
  )
}
