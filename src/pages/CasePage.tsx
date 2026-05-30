import { useMemo, useState } from 'react'
import { CareOptionsPanel } from '../components/case/CareOptionsPanel'
import { CaseHeader } from '../components/case/CaseHeader'
import { ExpensesPanel } from '../components/case/ExpensesPanel'
import { FareBreakdownPanel } from '../components/case/FareBreakdownPanel'
import { GpsPanel } from '../components/case/GpsPanel'
import { MeterActions } from '../components/case/MeterActions'
import { MeterSummary } from '../components/case/MeterSummary'
import { SettlementPanel } from '../components/case/SettlementPanel'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useOperationTimers } from '../hooks/useOperationTimers'
import {
  calculateFareBreakdown,
  careOptionMaster,
  formatFareYen,
} from '../services/fare'
import type {
  ExpenseItem,
  MeterAction,
  MeterMetric,
  OperationStatus,
  SelectedCareOption,
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
  const [selectedCareOptions, setSelectedCareOptions] = useState<
    SelectedCareOption[]
  >([])
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const elapsedTimers = useOperationTimers(activeTimer)
  const gps = useCurrentPosition(isGpsActive)

  const fareBreakdown = calculateFareBreakdown({
    distanceKm: gps.totalDistanceKm,
    waitingSeconds: elapsedTimers.seconds.waiting,
    escortSeconds: elapsedTimers.seconds.accompanying,
    careOptions: selectedCareOptions,
    expenses,
  })

  const meterMetrics: MeterMetric[] = useMemo(
    () => [
      {
        label: '現在料金',
        value: formatFareYen(fareBreakdown.totalFareYen),
        unit: '円',
        tone: 'fare',
      },
      {
        label: '基本運賃',
        value: formatFareYen(fareBreakdown.basicFareYen),
        unit: '円',
        tone: 'fare',
      },
      {
        label: '待機料金',
        value: formatFareYen(fareBreakdown.waitingFareYen),
        unit: '円',
        tone: 'fare',
      },
      {
        label: '院内付き添い料金',
        value: formatFareYen(fareBreakdown.escortFareYen),
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
    [elapsedTimers, fareBreakdown],
  )

  const handleAddCareOption = (masterItem: (typeof careOptionMaster)[number]) => {
    setSelectedCareOptions((currentOptions) => [
      ...currentOptions,
      {
        id: `${masterItem.id}-${Date.now()}-${crypto.randomUUID()}`,
        masterId: masterItem.id,
        name: masterItem.name,
        amountYen: masterItem.defaultAmountYen,
      },
    ])
  }

  const handleCareOptionAmountChange = (id: string, amountYen: number) => {
    setSelectedCareOptions((currentOptions) =>
      currentOptions.map((option) =>
        option.id === id ? { ...option, amountYen: Math.max(0, amountYen) } : option,
      ),
    )
  }

  const handleRemoveCareOption = (id: string) => {
    setSelectedCareOptions((currentOptions) =>
      currentOptions.filter((option) => option.id !== id),
    )
  }

  const handleAddExpense = (expense: Omit<ExpenseItem, 'id'>) => {
    setExpenses((currentExpenses) => [
      ...currentExpenses,
      { ...expense, id: `expense-${Date.now()}-${crypto.randomUUID()}` },
    ])
  }

  const handleRemoveExpense = (id: string) => {
    setExpenses((currentExpenses) =>
      currentExpenses.filter((expense) => expense.id !== id),
    )
  }

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
            現在料金は基本運賃、待機料金、院内付き添い料金、介助料金、実費を合算します。領収書、Firebase保存は未実装です。
          </p>
        </section>

        <MeterSummary metrics={meterMetrics} />
        <FareBreakdownPanel breakdown={fareBreakdown} />
        <CareOptionsPanel
          careOptionMaster={careOptionMaster}
          selectedCareOptions={selectedCareOptions}
          onAdd={handleAddCareOption}
          onAmountChange={handleCareOptionAmountChange}
          onRemove={handleRemoveCareOption}
        />
        <ExpensesPanel
          expenses={expenses}
          onAdd={handleAddExpense}
          onRemove={handleRemoveExpense}
        />
        <SettlementPanel breakdown={fareBreakdown} />
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
