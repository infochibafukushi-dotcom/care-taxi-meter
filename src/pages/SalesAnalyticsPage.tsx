import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import {
  calculateSalesAnalyticsSummary,
  formatAnalyticsDuration,
  getDefaultAnalyticsPeriod,
} from '../utils/salesAnalytics'
import type {
  AnalyticsBreakdownItem,
  AnalyticsPeriod,
  PaymentAnalyticsItem,
  StaffAnalyticsItem,
} from '../utils/salesAnalytics'

const pieColors = [
  '#0284c7',
  '#16a34a',
  '#f97316',
  '#8b5cf6',
  '#dc2626',
  '#0f766e',
  '#ca8a04',
  '#475569',
]

const escapeCsv = (value: string | number) => {
  const stringValue = String(value)
  if (!/[",\n]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replaceAll('"', '""')}"`
}

const sanitizeFileNamePart = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, '-').trim() || 'staff'

const toPieGradient = (items: Array<{ label: string; value: number }>) => {
  const total = items.reduce((sum, item) => sum + item.value, 0)

  if (total <= 0) {
    return 'conic-gradient(#e2e8f0 0deg 360deg)'
  }

  let currentDegree = 0
  const segments = items.map((item, index) => {
    const startDegree = currentDegree
    const endDegree = currentDegree + (item.value / total) * 360
    currentDegree = endDegree

    return `${pieColors[index % pieColors.length]} ${startDegree}deg ${endDegree}deg`
  })

  return `conic-gradient(${segments.join(', ')})`
}

function AnalyticsPieChart({
  emptyLabel,
  items,
  title,
  valueSuffix,
}: {
  emptyLabel: string
  items: Array<{ label: string; percent: number; value: number }>
  title: string
  valueSuffix: string
}) {
  const hasData = items.some((item) => item.value > 0)

  return (
    <section className="analytics-panel analytics-chart-panel">
      <h2>{title}</h2>
      <div className="analytics-pie-wrap">
        <div
          aria-label={title}
          className="analytics-pie"
          role="img"
          style={{ background: toPieGradient(items) }}
        />
        <div className="analytics-legend">
          {hasData ? (
            items.map((item, index) => (
              <p key={item.label}>
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: pieColors[index % pieColors.length] }}
                />
                <strong>{item.label}</strong>
                <em>
                  {formatFareYen(item.value)}{valueSuffix} / {item.percent.toFixed(1)}%
                </em>
              </p>
            ))
          ) : (
            <p className="analytics-empty-row">{emptyLabel}</p>
          )}
        </div>
      </div>
    </section>
  )
}

function BreakdownTable({
  emptyMessage,
  rows,
  title,
}: {
  emptyMessage: string
  rows: AnalyticsBreakdownItem[]
  title: string
}) {
  return (
    <section className="analytics-panel">
      <h2>{title}</h2>
      <table className="analytics-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>件数</th>
            <th>売上</th>
            <th>割合</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.count ?? '-'}{typeof row.count === 'number' ? '件' : ''}</td>
                <td>{formatFareYen(row.salesYen)}円</td>
                <td>{row.percent.toFixed(1)}%</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4}>{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function PaymentTable({ rows }: { rows: PaymentAnalyticsItem[] }) {
  return (
    <section className="analytics-panel">
      <h2>支払方法分析</h2>
      <table className="analytics-table">
        <thead>
          <tr>
            <th>支払方法</th>
            <th>件数</th>
            <th>件数割合</th>
            <th>売上</th>
            <th>売上割合</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.count}件</td>
                <td>{row.countPercent.toFixed(1)}%</td>
                <td>{formatFareYen(row.salesYen)}円</td>
                <td>{row.salesPercent.toFixed(1)}%</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>支払方法データがありません。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function StaffSummaryTable({ rows }: { rows: StaffAnalyticsItem[] }) {
  return (
    <section className="analytics-panel analytics-panel--wide">
      <h2>スタッフ別集計</h2>
      <table className="analytics-table analytics-table--staff">
        <thead>
          <tr>
            <th>スタッフ名</th>
            <th>売上</th>
            <th>件数</th>
            <th>平均単価</th>
            <th>稼働日数</th>
            <th>総距離</th>
            <th>総運転時間</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.staffId}>
                <td>{row.staffName}</td>
                <td>{formatFareYen(row.salesYen)}円</td>
                <td>{row.count}件</td>
                <td>{formatFareYen(row.averageYen)}円</td>
                <td>{row.activeDayCount}日</td>
                <td>{row.distanceKm.toFixed(3)}km</td>
                <td>{formatAnalyticsDuration(row.drivingSeconds)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7}>スタッフ別データがありません。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}


export function SalesAnalyticsPage() {
  const defaultPeriod = useMemo(() => getDefaultAnalyticsPeriod(), [])
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [period, setPeriod] = useState<AnalyticsPeriod>(defaultPeriod)
  const [selectedStaffId, setSelectedStaffId] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    fetchCaseRecords()
      .then((records) => {
        if (!isMounted) {
          return
        }

        setCaseRecords(records)
        setErrorMessage('')
        setIsLoading(false)
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setCaseRecords([])
        setErrorMessage(
          error instanceof Error
            ? `売上分析データを取得できませんでした。${error.message}`
            : '売上分析データを取得できませんでした。',
        )
        setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const analyticsSummary = useMemo(
    () => calculateSalesAnalyticsSummary(caseRecords, period, selectedStaffId),
    [caseRecords, period, selectedStaffId],
  )
  const selectedStaffName =
    selectedStaffId === 'all'
      ? '全スタッフ'
      : analyticsSummary.staffSummary.find((staff) => staff.staffId === selectedStaffId)?.staffName ??
        '選択スタッフ'

  const handleCsvDownload = () => {
    const header = [
      '案件番号',
      '利用日',
      '距離',
      '運転時間',
      '基本運賃',
      '待機料金',
      '付き添い料金',
      '介助料金',
      '実費',
      '合計金額',
      '支払方法',
    ]
    const body = analyticsSummary.csvRows.map((row) => [
      row.caseNumber,
      row.dateLabel,
      row.distanceKm.toFixed(3),
      formatAnalyticsDuration(row.drivingSeconds),
      row.basicFareYen,
      row.waitingFareYen,
      row.escortFareYen,
      row.careOptionFareYen,
      row.expenseFareYen,
      row.totalFareYen,
      row.paymentMethod,
    ])
    const csv = [header, ...body]
      .map((row) => row.map((column) => escapeCsv(column)).join(','))
      .join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const staffFileSuffix = selectedStaffId === 'all'
      ? 'all-staff'
      : sanitizeFileNamePart(selectedStaffName)
    link.download = `sales-analytics-${period.startMonth}-${period.endMonth}-${staffFileSuffix}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const salesCompositionItems = analyticsSummary.salesComposition.map((item) => ({
    label: item.label,
    percent: item.percent,
    value: item.salesYen,
  }))
  const paymentCountItems = analyticsSummary.paymentMethodSummary.map((item) => ({
    label: item.label,
    percent: item.countPercent,
    value: item.count,
  }))
  const paymentSalesItems = analyticsSummary.paymentMethodSummary.map((item) => ({
    label: item.label,
    percent: item.salesPercent,
    value: item.salesYen,
  }))
  const maxMonthlySales = Math.max(
    ...analyticsSummary.monthlySummary.map((month) => month.salesYen),
    0,
  )

  return (
    <main className="page analytics-page" aria-labelledby="analytics-title">
      <section className="content-card analytics-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Sales Analytics</p>
            <h1 id="analytics-title">売上分析</h1>
          </div>
          <div className="admin-header-actions">
            <Link className="text-link" to="/admin">
              管理センターへ戻る
            </Link>
            <Link className="text-link" to="/">
              ホームへ戻る
            </Link>
          </div>
        </div>

        <p className="lead admin-lead">
          Firestoreの保存済み案件を対象に、指定した月範囲の売上・介助・実費・支払方法・月別推移を集計します。
        </p>

        <section className="analytics-period-panel" aria-label="期間・スタッフ選択">
          <label>
            開始年月
            <input
              type="month"
              value={period.startMonth}
              onChange={(event) =>
                setPeriod((currentPeriod) => ({
                  ...currentPeriod,
                  startMonth: event.target.value,
                }))
              }
            />
          </label>
          <label>
            終了年月
            <input
              type="month"
              value={period.endMonth}
              onChange={(event) =>
                setPeriod((currentPeriod) => ({
                  ...currentPeriod,
                  endMonth: event.target.value,
                }))
              }
            />
          </label>
          <label>
            スタッフ
            <select
              value={selectedStaffId}
              onChange={(event) => setSelectedStaffId(event.target.value)}
            >
              <option value="all">全スタッフ</option>
              {analyticsSummary.staffSummary.map((staff) => (
                <option key={staff.staffId} value={staff.staffId}>
                  {staff.staffName}
                </option>
              ))}
            </select>
          </label>
          <button className="admin-save-button" type="button" onClick={handleCsvDownload}>
            CSV出力
          </button>
        </section>

        {isLoading ? (
          <p className="empty-note">Firestoreから売上分析データを取得中です。</p>
        ) : null}

        {errorMessage ? (
          <p className="case-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <p className="analytics-filter-note">
          表示対象: {selectedStaffName} / {analyticsSummary.totalCount}件
        </p>

        <section className="analytics-kpi-grid" aria-label="基本集計">
          <div>
            <span>売上</span>
            <strong>{formatFareYen(analyticsSummary.totalSalesYen)}円</strong>
          </div>
          <div>
            <span>件数</span>
            <strong>{analyticsSummary.totalCount}件</strong>
          </div>
          <div>
            <span>平均単価</span>
            <strong>{formatFareYen(analyticsSummary.averageYen)}円</strong>
          </div>
          <div>
            <span>稼働日数</span>
            <strong>{analyticsSummary.activeDayCount}日</strong>
          </div>
          <div>
            <span>総距離</span>
            <strong>{analyticsSummary.totalDistanceKm.toFixed(3)}km</strong>
          </div>
          <div>
            <span>総運転時間</span>
            <strong>{formatAnalyticsDuration(analyticsSummary.totalDrivingSeconds)}</strong>
          </div>
        </section>

        <div className="analytics-grid analytics-grid--three">
          <BreakdownTable
            emptyMessage="売上内訳データがありません。"
            rows={analyticsSummary.revenueBreakdown}
            title="売上内訳"
          />
          <AnalyticsPieChart
            emptyLabel="売上構成データがありません。"
            items={salesCompositionItems}
            title="売上構成比"
            valueSuffix="円"
          />
          <PaymentTable rows={analyticsSummary.paymentMethodSummary} />
        </div>

        <StaffSummaryTable rows={analyticsSummary.staffSummary} />

        <div className="analytics-grid analytics-grid--three">
          <BreakdownTable
            emptyMessage="介助項目データがありません。"
            rows={analyticsSummary.assistItemSummary}
            title="介助項目分析"
          />
          <BreakdownTable
            emptyMessage="実費データがありません。"
            rows={analyticsSummary.expenseSummary}
            title="実費分析"
          />
          <AnalyticsPieChart
            emptyLabel="支払方法の売上データがありません。"
            items={paymentSalesItems}
            title="支払方法 売上割合"
            valueSuffix="円"
          />
        </div>

        <div className="analytics-grid analytics-grid--two analytics-grid--wide-main">
          <section className="analytics-panel analytics-panel--wide">
            <h2>月別推移</h2>
            <div className="analytics-bar-chart" aria-label="月別売上棒グラフ">
              {analyticsSummary.monthlySummary.map((month) => (
                <div key={month.monthKey}>
                  <span>{month.monthLabel}</span>
                  <strong
                    style={{
                      height: `${maxMonthlySales > 0 ? Math.max((month.salesYen / maxMonthlySales) * 100, 4) : 4}%`,
                    }}
                  />
                  <em>{formatFareYen(month.salesYen)}円</em>
                </div>
              ))}
            </div>
          </section>

          <AnalyticsPieChart
            emptyLabel="支払方法の件数データがありません。"
            items={paymentCountItems}
            title="支払方法 件数割合"
            valueSuffix="件"
          />
        </div>

        <div className="analytics-grid analytics-grid--two">
          <section className="analytics-panel">
            <h2>月別一覧表</h2>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>年月</th>
                  <th>売上</th>
                  <th>件数</th>
                  <th>平均単価</th>
                  <th>距離</th>
                  <th>運転時間</th>
                </tr>
              </thead>
              <tbody>
                {analyticsSummary.monthlySummary.map((month) => (
                  <tr key={month.monthKey}>
                    <td>{month.monthLabel}</td>
                    <td>{formatFareYen(month.salesYen)}円</td>
                    <td>{month.count}件</td>
                    <td>{formatFareYen(month.averageYen)}円</td>
                    <td>{month.distanceKm.toFixed(3)}km</td>
                    <td>{formatAnalyticsDuration(month.drivingSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="analytics-panel">
            <h2>売上TOP10案件</h2>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>案件番号</th>
                  <th>売上</th>
                </tr>
              </thead>
              <tbody>
                {analyticsSummary.topCases.length > 0 ? (
                  analyticsSummary.topCases.map((caseRecord) => (
                    <tr key={caseRecord.caseNumber}>
                      <td>{caseRecord.dateLabel}</td>
                      <td>{caseRecord.caseNumber}</td>
                      <td>{formatFareYen(caseRecord.salesYen)}円</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>ランキング対象の案件がありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </section>
    </main>
  )
}
