import { useState } from 'react'
import { CaseHeader } from '../components/case/CaseHeader'
import { MeterActions } from '../components/case/MeterActions'
import { MeterSummary } from '../components/case/MeterSummary'
import type { MeterAction, MeterMetric, OperationStatus } from '../types/case'

const statusOptions: OperationStatus[] = [
  '待機中',
  '院内付き添い中',
  '走行中',
  '精算前',
  '案件終了',
]

const dummyMetrics: MeterMetric[] = [
  { label: '現在料金', value: '1,250', unit: '円' },
  { label: '走行距離', value: '3.2', unit: 'km' },
  { label: '運行時間', value: '18', unit: '分' },
]

const meterActions: MeterAction[] = [
  { label: '運行開始', variant: 'primary' },
  { label: '待機開始', variant: 'secondary' },
  { label: '院内付き添い開始', variant: 'secondary' },
  { label: '介助追加', variant: 'accent' },
  { label: '実費追加', variant: 'accent' },
  { label: '精算', variant: 'primary' },
]

export function CasePage() {
  const [status, setStatus] = useState<OperationStatus>('待機中')

  return (
    <main className="meter-page" aria-labelledby="case-title">
      <div className="meter-screen">
        <CaseHeader
          caseNumber="CASE-20260530-001"
          status={status}
          statusOptions={statusOptions}
          onStatusChange={setStatus}
        />

        <section className="meter-title-block">
          <p className="eyebrow">Care Taxi Meter</p>
          <h1 id="case-title">介護タクシーメーター</h1>
          <p>
            GPS計測、料金計算、領収書機能は未実装です。現在はダミーデータを表示しています。
          </p>
        </section>

        <MeterSummary metrics={dummyMetrics} />
        <MeterActions actions={meterActions} />
      </div>
    </main>
  )
}
