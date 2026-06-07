import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCaseRecords } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { fetchStaffMembers } from '../services/staffMembers'
import { fetchVehicles } from '../services/vehicles'
import { useWorkSession } from '../hooks/useWorkSession'
import { tenantScopeFromSession } from '../services/tenancy'
import type { StaffMember, Vehicle } from '../types/work'
import { formatFareYen } from '../services/fare'
import {
  calculateSalesAnalyticsSummary,
  formatAnalyticsDuration,
  getDefaultAnalyticsPeriod,
} from '../utils/salesAnalytics'
import type {
  AnalyticsBreakdownItem,
  AnalyticsPeriod,
  AreaAnalyticsItem,
  AreaDirectionalAnalyticsItem,
  PaymentAnalyticsItem,
  RangeAnalyticsItem,
  StaffAnalyticsItem,
  TimeRangeAnalyticsItem,
  TopCaseAnalyticsItem,
  VehicleAnalyticsItem,
  WeekdayAnalyticsItem,
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

function AreaRankingTable({
  rows,
  title,
}: {
  rows: AreaDirectionalAnalyticsItem[]
  title: string
}) {
  return (
    <section className="analytics-panel">
      <h2>{title}</h2>
      <table className="analytics-table analytics-table--compact">
        <thead>
          <tr>
            <th>エリア</th>
            <th>件数</th>
            <th>売上</th>
            <th>平均単価</th>
            <th>平均距離</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.areaName}>
                <td>{row.areaName}</td>
                <td>{row.count}件</td>
                <td>{formatFareYen(row.salesYen)}円</td>
                <td>{formatFareYen(row.averageYen)}円</td>
                <td>{row.averageDistanceKm.toFixed(2)}km</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>エリアデータがありません。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function RangeTable({
  averageColumn,
  rows,
  title,
}: {
  averageColumn: 'averageDistance' | 'averageYen'
  rows: RangeAnalyticsItem[]
  title: string
}) {
  return (
    <section className="analytics-panel">
      <h2>{title}</h2>
      <table className="analytics-table analytics-table--compact">
        <thead>
          <tr>
            <th>区分</th>
            <th>件数</th>
            <th>売上</th>
            <th>割合</th>
            <th>{averageColumn === 'averageYen' ? '平均単価' : '平均距離'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.count}件</td>
              <td>{formatFareYen(row.salesYen)}円</td>
              <td>{row.percent.toFixed(1)}%</td>
              <td>
                {averageColumn === 'averageYen'
                  ? `${formatFareYen(row.averageYen)}円`
                  : `${row.averageDistanceKm.toFixed(2)}km`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function AreaSummaryTable({ rows }: { rows: AreaAnalyticsItem[] }) {
  return (
    <section className="analytics-panel analytics-panel--wide">
      <h2>エリア別集計表</h2>
      <table className="analytics-table analytics-table--area">
        <thead>
          <tr>
            <th>エリア名</th>
            <th>乗車件数</th>
            <th>降車件数</th>
            <th>売上</th>
            <th>距離合計</th>
            <th>平均距離</th>
            <th>平均単価</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.areaName}>
                <td>{row.areaName}</td>
                <td>{row.pickupCount}件</td>
                <td>{row.dropoffCount}件</td>
                <td>{formatFareYen(row.salesYen)}円</td>
                <td>{row.distanceKm.toFixed(3)}km</td>
                <td>{row.averageDistanceKm.toFixed(2)}km</td>
                <td>{formatFareYen(row.averageYen)}円</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7}>エリア別データがありません。</td>
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


function VehicleSummaryTable({ rows }: { rows: VehicleAnalyticsItem[] }) {
  return (
    <section className="analytics-panel analytics-panel--wide">
      <h2>車両別集計</h2>
      <table className="analytics-table analytics-table--staff">
        <thead>
          <tr>
            <th>車両名</th>
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
              <tr key={row.vehicleId}>
                <td>{row.vehicleName}</td>
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
              <td colSpan={7}>車両別データがありません。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function WeekdayTable({ rows }: { rows: WeekdayAnalyticsItem[] }) {
  return (
    <section className="analytics-panel">
      <h2>曜日別分析</h2>
      <table className="analytics-table analytics-table--compact">
        <thead>
          <tr>
            <th>曜日</th>
            <th>件数</th>
            <th>売上</th>
            <th>平均単価</th>
            <th>総運転時間</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dayIndex}>
              <td>{row.label}</td>
              <td>{row.count}件</td>
              <td>{formatFareYen(row.salesYen)}円</td>
              <td>{formatFareYen(row.averageYen)}円</td>
              <td>{formatAnalyticsDuration(row.drivingSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TimeRangeTable({ rows }: { rows: TimeRangeAnalyticsItem[] }) {
  return (
    <section className="analytics-panel">
      <h2>時間帯別分析</h2>
      <table className="analytics-table analytics-table--compact">
        <thead>
          <tr>
            <th>時間帯</th>
            <th>件数</th>
            <th>売上</th>
            <th>平均単価</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.count}件</td>
              <td>{formatFareYen(row.salesYen)}円</td>
              <td>{formatFareYen(row.averageYen)}円</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TopCasesTable({ rows }: { rows: TopCaseAnalyticsItem[] }) {
  return (
    <section className="analytics-panel analytics-panel--wide">
      <h2>売上TOP10案件</h2>
      <table className="analytics-table analytics-table--area">
        <thead>
          <tr>
            <th>日付</th>
            <th>案件番号</th>
            <th>乗車エリア</th>
            <th>降車エリア</th>
            <th>距離</th>
            <th>運転時間</th>
            <th>基本運賃</th>
            <th>待機料金</th>
            <th>付き添い料金</th>
            <th>介助料金</th>
            <th>実費</th>
            <th>合計売上</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((caseRecord) => (
              <tr key={caseRecord.id}>
                <td>{caseRecord.dateLabel}</td>
                <td>
                  <Link className="text-link" to={`/cases/${caseRecord.id}`}>
                    {caseRecord.caseNumber}
                  </Link>
                </td>
                <td>{caseRecord.pickupAreaName}</td>
                <td>{caseRecord.dropoffAreaName}</td>
                <td>{caseRecord.distanceKm.toFixed(3)}km</td>
                <td>{formatAnalyticsDuration(caseRecord.drivingSeconds)}</td>
                <td>{formatFareYen(caseRecord.basicFareYen)}円</td>
                <td>{formatFareYen(caseRecord.waitingFareYen)}円</td>
                <td>{formatFareYen(caseRecord.escortFareYen)}円</td>
                <td>{formatFareYen(caseRecord.careOptionFareYen)}円</td>
                <td>{formatFareYen(caseRecord.expenseFareYen)}円</td>
                <td>{formatFareYen(caseRecord.salesYen)}円</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={12}>ランキング対象の案件がありません。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}


export function SalesAnalyticsPage() {
  const workSession = useWorkSession()
  const currentScope = tenantScopeFromSession(workSession.currentSession)
  const currentFranchiseeId = currentScope.franchiseeId
  const currentStoreId = currentScope.storeId
  const defaultPeriod = useMemo(() => getDefaultAnalyticsPeriod(), [])
  const [caseRecords, setCaseRecords] = useState<StoredCaseRecord[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [period, setPeriod] = useState<AnalyticsPeriod>(defaultPeriod)
  const [selectedStaffId, setSelectedStaffId] = useState('all')
  const [selectedVehicleId, setSelectedVehicleId] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    Promise.all([fetchCaseRecords({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: workSession.currentSession?.staffRole, staffId: workSession.currentSession?.staffId }), fetchStaffMembers({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: workSession.currentSession?.staffRole }), fetchVehicles({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: workSession.currentSession?.staffRole })])
      .then(([records, loadedStaffMembers, loadedVehicles]) => {
        if (!isMounted) {
          return
        }

        setCaseRecords(records)
        setStaffMembers(loadedStaffMembers)
        setVehicles(loadedVehicles)
        setErrorMessage('')
        setIsLoading(false)
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setCaseRecords([])
        setStaffMembers([])
        setVehicles([])
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
  }, [currentFranchiseeId, currentStoreId, workSession.currentSession?.staffId, workSession.currentSession?.staffRole])

  const analyticsSummary = useMemo(
    () =>
      calculateSalesAnalyticsSummary(
        caseRecords,
        period,
        selectedStaffId,
        staffMembers,
        selectedVehicleId,
        vehicles,
      ),
    [caseRecords, period, selectedStaffId, selectedVehicleId, staffMembers, vehicles],
  )
  const selectedStaffName =
    selectedStaffId === 'all'
      ? '全スタッフ'
      : staffMembers.find((staff) => staff.id === selectedStaffId)?.name ??
        analyticsSummary.staffSummary.find((staff) => staff.staffId === selectedStaffId)?.staffName ??
        '選択スタッフ'
  const selectedVehicleName =
    selectedVehicleId === 'all'
      ? '全車両'
      : vehicles.find((vehicle) => vehicle.id === selectedVehicleId)?.name ??
        analyticsSummary.vehicleSummary.find((vehicle) => vehicle.vehicleId === selectedVehicleId)?.vehicleName ??
        '選択車両'
  const vehicleFilterOptions = [
    ...vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name })),
    ...analyticsSummary.vehicleSummary
      .filter(
        (vehicleSummary) =>
          !vehicles.some((vehicle) => vehicle.id === vehicleSummary.vehicleId),
      )
      .map((vehicleSummary) => ({
        id: vehicleSummary.vehicleId,
        name: vehicleSummary.vehicleName,
      })),
  ]

  const handleCsvDownload = () => {
    const header = [
      '日付',
      '案件番号',
      'スタッフ名',
      '車両名',
      '乗車エリア',
      '降車エリア',
      '距離',
      '運転時間',
      '基本運賃',
      '待機料金',
      '付き添い料金',
      '介助料金',
      '実費',
      '割引前売上',
      '割引額',
      'タクシー券利用額',
      '請求額',
      '実入金額',
      '支払方法',
    ]
    const body = analyticsSummary.csvRows.map((row) => [
      row.dateLabel,
      row.caseNumber,
      row.staffName,
      row.vehicleName,
      row.pickupAreaName,
      row.dropoffAreaName,
      row.distanceKm.toFixed(3),
      formatAnalyticsDuration(row.drivingSeconds),
      row.basicFareYen,
      row.waitingFareYen,
      row.escortFareYen,
      row.careOptionFareYen,
      row.expenseFareYen,
      row.grossFareYen,
      row.disabilityDiscountAmount,
      row.taxiTicketAmountYen,
      row.totalFareYen,
      row.actualPaymentYen,
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
    const vehicleFileSuffix = selectedVehicleId === 'all'
      ? 'all-vehicles'
      : sanitizeFileNamePart(selectedVehicleName)
    link.download = `sales-analytics-${period.startDate}-${period.endDate}-${staffFileSuffix}-${vehicleFileSuffix}.csv`
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
          Firestoreの保存済み案件を対象に、日付範囲・スタッフ・車両で絞り込んだ売上分析を表示します。
        </p>

        <section className="analytics-period-panel" aria-label="期間・スタッフ・車両選択">
          <label>
            開始日
            <input
              type="date"
              value={period.startDate}
              onChange={(event) =>
                setPeriod((currentPeriod) => ({
                  ...currentPeriod,
                  startDate: event.target.value,
                }))
              }
            />
          </label>
          <label>
            終了日
            <input
              type="date"
              value={period.endDate}
              onChange={(event) =>
                setPeriod((currentPeriod) => ({
                  ...currentPeriod,
                  endDate: event.target.value,
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
              {staffMembers.map((staffMember) => (
                <option key={staffMember.id} value={staffMember.id}>
                  {staffMember.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            車両
            <select
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
            >
              <option value="all">全車両</option>
              {vehicleFilterOptions.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
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
          表示対象: {selectedStaffName} / {selectedVehicleName} / {analyticsSummary.totalCount}件
        </p>

        <section className="analytics-kpi-grid" aria-label="基本集計">
          <div>
            <span>請求額</span>
            <strong>{formatFareYen(analyticsSummary.totalClaimYen)}円</strong>
          </div>
          <div>
            <span>割引前売上</span>
            <strong>{formatFareYen(analyticsSummary.totalGrossSalesYen)}円</strong>
          </div>
          <div>
            <span>割引額</span>
            <strong>{formatFareYen(analyticsSummary.totalDiscountYen)}円</strong>
          </div>
          <div>
            <span>タクシー券</span>
            <strong>{formatFareYen(analyticsSummary.totalTaxiTicketYen)}円</strong>
          </div>
          <div>
            <span>実入金額</span>
            <strong>{formatFareYen(analyticsSummary.totalActualPaymentYen)}円</strong>
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
            <span>総運転時間</span>
            <strong>{formatAnalyticsDuration(analyticsSummary.totalDrivingSeconds)}</strong>
          </div>
          <div>
            <span>総距離</span>
            <strong>{analyticsSummary.totalDistanceKm.toFixed(3)}km</strong>
          </div>
        </section>

        <h2 className="analytics-section-title">メイン分析</h2>
        <div className="analytics-grid analytics-grid--three">
          <BreakdownTable
            emptyMessage="売上内訳データがありません。"
            rows={analyticsSummary.revenueBreakdown}
            title="売上内訳"
          />
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
          <PaymentTable rows={analyticsSummary.paymentMethodSummary} />
        </div>
        <StaffSummaryTable rows={analyticsSummary.staffSummary} />
        <VehicleSummaryTable rows={analyticsSummary.vehicleSummary} />

        <h2 className="analytics-section-title">実務分析</h2>
        <div className="analytics-grid analytics-grid--three">
          <WeekdayTable rows={analyticsSummary.weekdaySummary} />
          <TimeRangeTable rows={analyticsSummary.timeRangeSummary} />
          <RangeTable
            averageColumn="averageDistance"
            rows={analyticsSummary.salesRangeSummary}
            title="売上帯分析"
          />
        </div>
        <div className="analytics-grid analytics-grid--three">
          <RangeTable
            averageColumn="averageYen"
            rows={analyticsSummary.distanceRangeSummary}
            title="距離帯分析"
          />
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
        </div>

        <h2 className="analytics-section-title">エリア分析</h2>
        <div className="analytics-grid analytics-grid--two">
          <AreaRankingTable
            rows={analyticsSummary.pickupAreaSalesTop}
            title="乗車エリア 売上TOP10"
          />
          <AreaRankingTable
            rows={analyticsSummary.dropoffAreaSalesTop}
            title="降車エリア 売上TOP10"
          />
        </div>
        <AreaSummaryTable rows={analyticsSummary.areaSummary} />

        <details className="analytics-details" open>
          <summary>詳細分析</summary>
          <TopCasesTable rows={analyticsSummary.topCases} />
          <div className="analytics-grid analytics-grid--two">
            <AreaRankingTable
              rows={analyticsSummary.pickupAreaCountTop}
              title="乗車エリア 件数TOP10"
            />
            <AreaRankingTable
              rows={analyticsSummary.dropoffAreaCountTop}
              title="降車エリア 件数TOP10"
            />
          </div>
          <div className="analytics-distance-summary" aria-label="距離サマリー">
            <div>
              <span>平均距離</span>
              <strong>{analyticsSummary.distanceSummary.averageDistanceKm.toFixed(2)}km</strong>
            </div>
            <div>
              <span>最長距離</span>
              <strong>{analyticsSummary.distanceSummary.maxDistanceKm.toFixed(3)}km</strong>
            </div>
            <div>
              <span>最短距離</span>
              <strong>{analyticsSummary.distanceSummary.minDistanceKm.toFixed(3)}km</strong>
            </div>
          </div>
          <div className="analytics-grid analytics-grid--three">
            <AnalyticsPieChart
              emptyLabel="売上構成データがありません。"
              items={salesCompositionItems}
              title="売上構成比"
              valueSuffix="円"
            />
            <AnalyticsPieChart
              emptyLabel="支払方法の売上データがありません。"
              items={paymentSalesItems}
              title="支払方法 売上割合"
              valueSuffix="円"
            />
            <AnalyticsPieChart
              emptyLabel="支払方法の件数データがありません。"
              items={paymentCountItems}
              title="支払方法 件数割合"
              valueSuffix="件"
            />
          </div>
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
        </details>
      </section>
    </main>
  )
}
