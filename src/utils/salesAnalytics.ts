import type { StoredCaseRecord } from '../services/caseRecords'

export type AnalyticsPeriod = {
  endMonth: string
  startMonth: string
}

export type AnalyticsBreakdownItem = {
  count?: number
  label: string
  percent: number
  salesYen: number
}

export type PaymentAnalyticsItem = {
  count: number
  countPercent: number
  label: string
  salesPercent: number
  salesYen: number
}

export type MonthlyAnalyticsItem = {
  averageYen: number
  count: number
  distanceKm: number
  drivingSeconds: number
  monthKey: string
  monthLabel: string
  salesYen: number
}

export type TopCaseAnalyticsItem = {
  caseNumber: string
  dateLabel: string
  salesYen: number
}

export type AnalyticsCsvRow = {
  basicFareYen: number
  careOptionFareYen: number
  caseNumber: string
  dateLabel: string
  distanceKm: number
  drivingSeconds: number
  escortFareYen: number
  expenseFareYen: number
  paymentMethod: string
  totalFareYen: number
  waitingFareYen: number
}

export type StaffAnalyticsItem = {
  activeDayCount: number
  averageYen: number
  count: number
  distanceKm: number
  drivingSeconds: number
  staffId: string
  staffName: string
  salesYen: number
}

export type SalesAnalyticsSummary = {
  activeDayCount: number
  assistItemSummary: AnalyticsBreakdownItem[]
  averageYen: number
  csvRows: AnalyticsCsvRow[]
  expenseSummary: AnalyticsBreakdownItem[]
  filteredCount: number
  monthlySummary: MonthlyAnalyticsItem[]
  paymentMethodSummary: PaymentAnalyticsItem[]
  revenueBreakdown: AnalyticsBreakdownItem[]
  salesComposition: AnalyticsBreakdownItem[]
  staffSummary: StaffAnalyticsItem[]
  topCases: TopCaseAnalyticsItem[]
  totalCount: number
  totalDistanceKm: number
  totalDrivingSeconds: number
  totalSalesYen: number
}

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
})


const monthInputFormatter = new Intl.DateTimeFormat('sv-SE', {
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
})

const toFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const staffUnknownId = '__staff_unknown__'

const toPaymentMethodLabel = (paymentMethod: unknown) =>
  typeof paymentMethod === 'string' && paymentMethod.trim()
    ? paymentMethod.trim()
    : '未設定'

const toAverageYen = (salesYen: number, count: number) =>
  count > 0 ? Math.round(salesYen / count) : 0

const toPercent = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0

const toValidDate = (closedAt: string) => {
  const date = new Date(closedAt)
  return Number.isNaN(date.getTime()) ? null : date
}

const toDateLabel = (closedAt: string) => {
  const date = toValidDate(closedAt)
  return date ? dateFormatter.format(date) : '日付未設定'
}

const toMonthKey = (closedAt: string) => {
  const date = toValidDate(closedAt)
  return date ? monthInputFormatter.format(date) : ''
}

const toMonthLabel = (monthKey: string) => monthKey.replace('-', '/')

const toStaffName = (caseRecord: StoredCaseRecord) =>
  caseRecord.staffName.trim() || 'スタッフ未設定'

export const toStaffAnalyticsId = (caseRecord: StoredCaseRecord) =>
  caseRecord.staffId.trim() ||
  (caseRecord.staffName.trim()
    ? `staff-name:${caseRecord.staffName.trim()}`
    : staffUnknownId)

const parseMonthValue = (monthValue: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue)

  if (!match) {
    const fallback = getDefaultAnalyticsPeriod()
    return parseMonthValue(fallback.endMonth)
  }

  return {
    month: Number(match[2]),
    year: Number(match[1]),
  }
}

const createJapanStartOfMonthIso = (monthValue: string) => {
  const { month, year } = parseMonthValue(monthValue)
  return new Date(Date.UTC(year, month - 1, 1, -9, 0, 0, 0)).toISOString()
}

const createJapanNextMonthStartIso = (monthValue: string) => {
  const { month, year } = parseMonthValue(monthValue)
  return new Date(Date.UTC(year, month, 1, -9, 0, 0, 0)).toISOString()
}

function getSortedPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  return period.startMonth <= period.endMonth
    ? period
    : { endMonth: period.startMonth, startMonth: period.endMonth }
}

function getMonthKeysInPeriod(period: AnalyticsPeriod) {
  const { endMonth, startMonth } = getSortedPeriod(period)
  const start = parseMonthValue(startMonth)
  const end = parseMonthValue(endMonth)
  const monthKeys: string[] = []

  for (
    let cursor = start.year * 12 + start.month - 1;
    cursor <= end.year * 12 + end.month - 1;
    cursor += 1
  ) {
    const year = Math.floor(cursor / 12)
    const month = (cursor % 12) + 1
    monthKeys.push(`${year}-${String(month).padStart(2, '0')}`)
  }

  return monthKeys
}

function addToMap(
  map: Map<string, { count: number; salesYen: number }>,
  label: string,
  salesYen: number,
) {
  const current = map.get(label) ?? { count: 0, salesYen: 0 }
  map.set(label, {
    count: current.count + 1,
    salesYen: current.salesYen + salesYen,
  })
}

function toBreakdownItem(label: string, salesYen: number, totalSalesYen: number) {
  return {
    label,
    percent: toPercent(salesYen, totalSalesYen),
    salesYen,
  }
}

function calculateStaffSummary(
  caseRecords: StoredCaseRecord[],
): StaffAnalyticsItem[] {
  const staffMap = new Map<
    string,
    {
      activeDayKeys: Set<string>
      count: number
      distanceKm: number
      drivingSeconds: number
      staffId: string
      staffName: string
      salesYen: number
    }
  >()

  caseRecords.forEach((caseRecord) => {
    const staffId = toStaffAnalyticsId(caseRecord)
    const current = staffMap.get(staffId) ?? {
      activeDayKeys: new Set<string>(),
      count: 0,
      distanceKm: 0,
      drivingSeconds: 0,
      staffId,
      staffName: toStaffName(caseRecord),
      salesYen: 0,
    }
    const dateLabel = toDateLabel(caseRecord.closedAt)

    if (dateLabel !== '日付未設定') {
      current.activeDayKeys.add(dateLabel)
    }

    current.count += 1
    current.distanceKm += toFiniteNumber(caseRecord.distanceKm)
    current.drivingSeconds += toFiniteNumber(caseRecord.drivingSeconds)
    current.salesYen += toFiniteNumber(caseRecord.totalFareYen)
    staffMap.set(staffId, current)
  })

  return Array.from(staffMap.values())
    .map((staffSummary) => ({
      activeDayCount: staffSummary.activeDayKeys.size,
      averageYen: toAverageYen(staffSummary.salesYen, staffSummary.count),
      count: staffSummary.count,
      distanceKm: staffSummary.distanceKm,
      drivingSeconds: staffSummary.drivingSeconds,
      staffId: staffSummary.staffId,
      staffName: staffSummary.staffName,
      salesYen: staffSummary.salesYen,
    }))
    .sort((firstStaff, secondStaff) =>
      secondStaff.salesYen - firstStaff.salesYen ||
      firstStaff.staffName.localeCompare(secondStaff.staffName, 'ja'),
    )
}

export function getDefaultAnalyticsPeriod(date = new Date()): AnalyticsPeriod {
  const currentMonth = monthInputFormatter.format(date)
  const year = currentMonth.slice(0, 4)

  return {
    endMonth: currentMonth,
    startMonth: `${year}-01`,
  }
}

export function formatAnalyticsDuration(totalSeconds: number) {
  const safeSeconds = Math.max(Math.floor(toFiniteNumber(totalSeconds)), 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  return `${hours}時間${minutes}分`
}

export function calculateSalesAnalyticsSummary(
  caseRecords: StoredCaseRecord[],
  period: AnalyticsPeriod,
  staffId = 'all',
): SalesAnalyticsSummary {
  const sortedPeriod = getSortedPeriod(period)
  const startIso = createJapanStartOfMonthIso(sortedPeriod.startMonth)
  const endIso = createJapanNextMonthStartIso(sortedPeriod.endMonth)
  const monthKeys = getMonthKeysInPeriod(sortedPeriod)
  const monthlyMap = new Map(
    monthKeys.map((monthKey) => [
      monthKey,
      {
        count: 0,
        distanceKm: 0,
        drivingSeconds: 0,
        salesYen: 0,
      },
    ]),
  )
  const periodRecords = caseRecords.filter((caseRecord) => {
    const closedDate = toValidDate(caseRecord.closedAt)
    return closedDate && caseRecord.closedAt >= startIso && caseRecord.closedAt < endIso
  })
  const staffSummary = calculateStaffSummary(periodRecords)
  const filteredRecords = staffId === 'all'
    ? periodRecords
    : periodRecords.filter((caseRecord) => toStaffAnalyticsId(caseRecord) === staffId)
  const totalSalesYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
    0,
  )
  const activeDayKeys = new Set<string>()
  const paymentMethodMap = new Map<string, { count: number; salesYen: number }>()
  const assistItemMap = new Map<string, { count: number; salesYen: number }>()
  const expenseMap = new Map<string, { count: number; salesYen: number }>()

  let totalDistanceKm = 0
  let totalDrivingSeconds = 0

  filteredRecords.forEach((caseRecord) => {
    const salesYen = toFiniteNumber(caseRecord.totalFareYen)
    const distanceKm = toFiniteNumber(caseRecord.distanceKm)
    const drivingSeconds = toFiniteNumber(caseRecord.drivingSeconds)
    const dateLabel = toDateLabel(caseRecord.closedAt)
    const monthKey = toMonthKey(caseRecord.closedAt)
    const monthly = monthKey ? monthlyMap.get(monthKey) : null

    if (dateLabel !== '日付未設定') {
      activeDayKeys.add(dateLabel)
    }

    totalDistanceKm += distanceKm
    totalDrivingSeconds += drivingSeconds

    if (monthly) {
      monthly.count += 1
      monthly.distanceKm += distanceKm
      monthly.drivingSeconds += drivingSeconds
      monthly.salesYen += salesYen
    }

    addToMap(paymentMethodMap, toPaymentMethodLabel(caseRecord.paymentMethod), salesYen)

    caseRecord.assistCharges.forEach((assistCharge) => {
      addToMap(
        assistItemMap,
        assistCharge.name || assistCharge.id || '名称未設定の介助',
        toFiniteNumber(assistCharge.amount),
      )
    })

    if (caseRecord.expenseCharges.length > 0) {
      caseRecord.expenseCharges.forEach((expenseCharge) => {
        addToMap(
          expenseMap,
          expenseCharge.name || expenseCharge.id || '名称未設定の実費',
          toFiniteNumber(expenseCharge.amount),
        )
      })
    } else if (toFiniteNumber(caseRecord.expenseFareYen) > 0) {
      addToMap(expenseMap, 'その他', toFiniteNumber(caseRecord.expenseFareYen))
    }
  })

  const basicFareYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.basicFareYen),
    0,
  )
  const waitingFareYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.waitingFareYen),
    0,
  )
  const escortFareYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.escortFareYen),
    0,
  )
  const careOptionFareYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.careOptionFareYen),
    0,
  )
  const expenseFareYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.expenseFareYen),
    0,
  )

  const revenueBreakdown = [
    toBreakdownItem('基本運賃', basicFareYen, totalSalesYen),
    toBreakdownItem('待機料金', waitingFareYen, totalSalesYen),
    toBreakdownItem('付き添い料金', escortFareYen, totalSalesYen),
    toBreakdownItem('介助料金', careOptionFareYen, totalSalesYen),
    toBreakdownItem('実費', expenseFareYen, totalSalesYen),
  ]

  return {
    activeDayCount: activeDayKeys.size,
    assistItemSummary: Array.from(assistItemMap, ([label, item]) => ({
      count: item.count,
      label,
      percent: toPercent(item.salesYen, totalSalesYen),
      salesYen: item.salesYen,
    })).sort((firstItem, secondItem) => secondItem.salesYen - firstItem.salesYen),
    averageYen: toAverageYen(totalSalesYen, filteredRecords.length),
    csvRows: filteredRecords.map((caseRecord) => ({
      basicFareYen: toFiniteNumber(caseRecord.basicFareYen),
      careOptionFareYen: toFiniteNumber(caseRecord.careOptionFareYen),
      caseNumber: caseRecord.caseNumber,
      dateLabel: toDateLabel(caseRecord.closedAt),
      distanceKm: toFiniteNumber(caseRecord.distanceKm),
      drivingSeconds: toFiniteNumber(caseRecord.drivingSeconds),
      escortFareYen: toFiniteNumber(caseRecord.escortFareYen),
      expenseFareYen: toFiniteNumber(caseRecord.expenseFareYen),
      paymentMethod: toPaymentMethodLabel(caseRecord.paymentMethod),
      totalFareYen: toFiniteNumber(caseRecord.totalFareYen),
      waitingFareYen: toFiniteNumber(caseRecord.waitingFareYen),
    })),
    expenseSummary: Array.from(expenseMap, ([label, item]) => ({
      count: item.count,
      label,
      percent: toPercent(item.salesYen, totalSalesYen),
      salesYen: item.salesYen,
    })).sort((firstItem, secondItem) => secondItem.salesYen - firstItem.salesYen),
    filteredCount: filteredRecords.length,
    monthlySummary: monthKeys.map((monthKey) => {
      const monthly = monthlyMap.get(monthKey) ?? {
        count: 0,
        distanceKm: 0,
        drivingSeconds: 0,
        salesYen: 0,
      }

      return {
        averageYen: toAverageYen(monthly.salesYen, monthly.count),
        count: monthly.count,
        distanceKm: monthly.distanceKm,
        drivingSeconds: monthly.drivingSeconds,
        monthKey,
        monthLabel: toMonthLabel(monthKey),
        salesYen: monthly.salesYen,
      }
    }),
    paymentMethodSummary: Array.from(paymentMethodMap, ([label, item]) => ({
      count: item.count,
      countPercent: toPercent(item.count, filteredRecords.length),
      label,
      salesPercent: toPercent(item.salesYen, totalSalesYen),
      salesYen: item.salesYen,
    })).sort((firstItem, secondItem) => secondItem.salesYen - firstItem.salesYen),
    revenueBreakdown,
    salesComposition: revenueBreakdown,
    staffSummary,
    topCases: [...filteredRecords]
      .sort((firstRecord, secondRecord) => {
        const salesDifference =
          toFiniteNumber(secondRecord.totalFareYen) - toFiniteNumber(firstRecord.totalFareYen)
        return salesDifference || secondRecord.closedAt.localeCompare(firstRecord.closedAt)
      })
      .slice(0, 10)
      .map((caseRecord) => ({
        caseNumber: caseRecord.caseNumber,
        dateLabel: toDateLabel(caseRecord.closedAt),
        salesYen: toFiniteNumber(caseRecord.totalFareYen),
      })),
    totalCount: filteredRecords.length,
    totalDistanceKm,
    totalDrivingSeconds,
    totalSalesYen,
  }
}
