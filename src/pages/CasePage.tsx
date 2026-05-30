import { useState } from 'react'
import { CaseHeader } from '../components/case/CaseHeader'
import { FareBreakdownPanel } from '../components/case/FareBreakdownPanel'
import { GpsPanel } from '../components/case/GpsPanel'
import { KeypadModal } from '../components/case/KeypadModal'
import { SettlementPanel } from '../components/case/SettlementPanel'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useOperationTimers } from '../hooks/useOperationTimers'
import {
  calculateFareBreakdown,
  careOptionMaster,
  expenseSettings,
  formatFareYen,
} from '../services/fare'
import type {
  ExpenseItem,
  OperationStatus,
  SelectedCareOption,
  StatusTone,
  TimerKey,
} from '../types/case'

type KeypadTarget = {
  amountYen: number
  mode: 'care' | 'expense'
  name: string
  sourceId?: string
}

type InputHistory = {
  amountYen: number
  id: string
  mode: 'care' | 'expense'
  name: string
}

const inputHistoryStorageKey = 'careTaxiMeterInputHistory'

const statusToneMap: Record<OperationStatus, StatusTone> = {
  空車: 'vacant',
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

const loadInputHistory = () => {
  try {
    const historyJson = localStorage.getItem(inputHistoryStorageKey)
    return historyJson ? (JSON.parse(historyJson) as InputHistory[]) : []
  } catch {
    return []
  }
}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`

export function CasePage() {
  const [status, setStatus] = useState<OperationStatus>('空車')
  const [activeTimer, setActiveTimer] = useState<TimerKey | null>(null)
  const [isGpsActive, setIsGpsActive] = useState(false)
  const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false)
  const [keypadTarget, setKeypadTarget] = useState<KeypadTarget | null>(null)
  const [inputHistory, setInputHistory] = useState<InputHistory[]>(loadInputHistory)
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

  const persistInputHistory = (nextHistory: InputHistory[]) => {
    setInputHistory(nextHistory)
    localStorage.setItem(inputHistoryStorageKey, JSON.stringify(nextHistory))
  }

  const rememberHistory = (entry: Omit<InputHistory, 'id'>) => {
    const nextHistory = [
      { ...entry, id: createId('history') },
      ...inputHistory.filter(
        (item) => item.mode !== entry.mode || item.name !== entry.name,
      ),
    ].slice(0, 10)
    persistInputHistory(nextHistory)
  }

  const addCareOption = ({
    amountYen,
    masterId,
    name,
  }: {
    amountYen: number
    masterId: string
    name: string
  }) => {
    setSelectedCareOptions((currentOptions) => [
      ...currentOptions,
      {
        amountYen,
        id: createId(masterId),
        masterId,
        name,
      },
    ])
    rememberHistory({ amountYen, mode: 'care', name })
  }

  const addExpense = ({ amountYen, name }: Omit<ExpenseItem, 'id'>) => {
    setExpenses((currentExpenses) => [
      ...currentExpenses,
      { amountYen, id: createId('expense'), name },
    ])
    rememberHistory({ amountYen, mode: 'expense', name })
  }

  const handleKeypadConfirm = (entry: { amountYen: number; name: string }) => {
    if (!keypadTarget) {
      return
    }

    if (keypadTarget.mode === 'care') {
      addCareOption({
        amountYen: entry.amountYen,
        masterId: keypadTarget.sourceId ?? 'manual-care',
        name: entry.name,
      })
    } else {
      addExpense(entry)
    }

    setKeypadTarget(null)
  }

  const handleHistorySelect = (history: InputHistory) => {
    if (history.mode === 'care') {
      addCareOption({
        amountYen: history.amountYen,
        masterId: 'history-care',
        name: history.name,
      })
    } else {
      addExpense({ amountYen: history.amountYen, name: history.name })
    }
  }

  const handleStatusChange = (nextStatus: OperationStatus) => {
    setStatus(nextStatus)
    setActiveTimer(activeTimerMap[nextStatus] ?? null)

    if (nextStatus === '走行中') {
      setIsGpsActive(true)
    }

    if (nextStatus === '空車' || nextStatus === '案件終了') {
      setIsGpsActive(false)
    }
  }

  const dashboardItems = [
    { label: '運賃', value: fareBreakdown.basicFareYen },
    { label: '待機料金', value: fareBreakdown.waitingFareYen },
    { label: '院内付き添い', value: fareBreakdown.escortFareYen },
    { label: '介助料金', value: fareBreakdown.careOptionFareYen },
    { label: '実費', value: fareBreakdown.expenseFareYen },
  ]

  const statusButtons: Array<{
    label: string
    status: OperationStatus
    tone: StatusTone
  }> = [
    { label: '空車', status: '空車', tone: 'vacant' },
    { label: '実車', status: '走行中', tone: 'driving' },
    { label: '待機', status: '待機中', tone: 'waiting' },
    { label: '付き添い', status: '院内付き添い中', tone: 'accompanying' },
    { label: '精算', status: '精算前', tone: 'settlement' },
    { label: '案件終了', status: '案件終了', tone: 'closed' },
  ]

  return (
    <main
      className={`meter-page meter-page--${statusToneMap[status]}`}
      aria-labelledby="case-title"
    >
      <div className="meter-console">
        <section className="console-left" aria-label="メーター表示">
          <CaseHeader
            caseNumber="CASE-20260530-001"
            status={status}
            statusTone={statusToneMap[status]}
          />
          <div className="fare-display">
            <span>現在料金</span>
            <strong>{formatFareYen(fareBreakdown.totalFareYen)}円</strong>
          </div>
          <div className="fare-dashboard-grid">
            {dashboardItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{formatFareYen(item.value)}円</strong>
              </div>
            ))}
            <div>
              <span>距離</span>
              <strong>{gps.totalDistanceKm.toFixed(3)}km</strong>
            </div>
            <div>
              <span>運行時間</span>
              <strong>{elapsedTimers.driving}</strong>
            </div>
            <div>
              <span>待機時間</span>
              <strong>{elapsedTimers.waiting}</strong>
            </div>
            <div>
              <span>付き添い時間</span>
              <strong>{elapsedTimers.accompanying}</strong>
            </div>
          </div>
          <FareBreakdownPanel breakdown={fareBreakdown} />
        </section>

        <section className="console-center" aria-labelledby="case-title">
          <div className="console-title-block">
            <p className="eyebrow">Care Taxi Cloud Meter</p>
            <h1 id="case-title">介護タクシーメーター</h1>
          </div>

          <div className="quick-panel">
            <h2>介助ボタン</h2>
            <div className="quick-button-grid">
              {careOptionMaster.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    setKeypadTarget({
                      amountYen: item.defaultAmountYen,
                      mode: 'care',
                      name: item.name,
                      sourceId: item.id,
                    })
                  }
                >
                  <span>{item.name}</span>
                  <strong>{formatFareYen(item.defaultAmountYen)}円</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="quick-panel">
            <h2>実費ボタン</h2>
            <div className="quick-button-grid expense-buttons">
              {expenseSettings.defaultNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setKeypadTarget({ amountYen: 0, mode: 'expense', name })
                  }
                >
                  <span>{name}</span>
                  <strong>入力</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="history-panel">
            <h2>過去入力履歴</h2>
            {inputHistory.length === 0 ? (
              <p className="empty-note">履歴はまだありません。</p>
            ) : null}
            <div className="history-list">
              {inputHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleHistorySelect(item)}
                >
                  <span>{item.mode === 'care' ? '介助' : '実費'}</span>
                  <strong>{item.name}</strong>
                  <em>{formatFareYen(item.amountYen)}円</em>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="console-right" aria-label="状態操作">
          <div className="status-button-grid">
            {statusButtons.map((button) => (
              <button
                className={`status-action status-action--${button.tone}`}
                key={button.label}
                type="button"
                onClick={() => handleStatusChange(button.status)}
              >
                {button.label}
              </button>
            ))}
          </div>
          <SettlementPanel breakdown={fareBreakdown} />
          <details
            className="gps-debug"
            open={isGpsPanelOpen}
            onToggle={(event) => setIsGpsPanelOpen(event.currentTarget.open)}
          >
            <summary>GPSデバッグ</summary>
            <GpsPanel
              errorMessage={gps.errorMessage}
              gpsLogCount={gps.gpsLogCount}
              isActive={gps.isActive}
              position={gps.position}
              status={gps.status}
              totalDistanceKm={gps.totalDistanceKm}
            />
          </details>
        </section>
      </div>

      {keypadTarget ? (
        <KeypadModal
          amountYen={keypadTarget.amountYen}
          defaultName={keypadTarget.name}
          mode={keypadTarget.mode}
          title={keypadTarget.name}
          onClose={() => setKeypadTarget(null)}
          onConfirm={handleKeypadConfirm}
        />
      ) : null}
    </main>
  )
}
