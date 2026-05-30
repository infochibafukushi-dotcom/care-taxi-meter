import { useMemo, useState } from 'react'
import { CaseHeader } from '../components/case/CaseHeader'
import { MeterActions } from '../components/case/MeterActions'
import { MeterSummary } from '../components/case/MeterSummary'
import { useOperationTimers } from '../hooks/useOperationTimers'
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
  const elapsedTimers = useOperationTimers(activeTimer)

  const meterMetrics: MeterMetric[] = useMemo(
    () => [
      { label: '現在料金', value: '1,250', unit: '円', tone: 'fare' },
      { label: '運行時間', value: elapsedTimers.driving, tone: 'timer' },
      { label: '待機時間', value: elapsedTimers.waiting, tone: 'timer' },
      {
        label: '院内付き添い時間',
        value: elapsedTimers.accompanying,
        tone: 'timer',
      },
    ],
    [elapsedTimers],
  )

  const handleStatusChange = (nextStatus: OperationStatus) => {
    setStatus(nextStatus)
    setActiveTimer(activeTimerMap[nextStatus] ?? null)
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
            GPS計測、料金計算、領収書機能は未実装です。現在料金のみダミー表示です。
          </p>
        </section>

        <MeterSummary metrics={meterMetrics} />
        <MeterActions
          actions={meterActions}
          onStatusChange={handleStatusChange}
        />
      </div>
    </main>
  )
}
