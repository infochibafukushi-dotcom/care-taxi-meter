import type { StoredCaseRecord } from '../services/caseRecords'
import type { StaffMember } from '../types/work'

export type AnalyticsPeriod = {
  endDate: string
  startDate: string
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

export type AreaDirectionalAnalyticsItem = {
  areaName: string
  averageDistanceKm: number
  averageYen: number
  count: number
  distanceKm: number
  salesYen: number
}

export type AreaAnalyticsItem = {
  areaName: string
  averageDistanceKm: number
  averageYen: number
  distanceKm: number
  dropoffCount: number
  pickupCount: number
  salesYen: number
}

export type DistanceRangeAnalyticsItem = {
  count: number
  label: string
  percent: number
  salesYen: number
}

export type DistanceAnalyticsSummary = {
  averageDistanceKm: number
  maxDistanceKm: number
  minDistanceKm: number
  totalDistanceKm: number
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
  areaSummary: AreaAnalyticsItem[]
  assistItemSummary: AnalyticsBreakdownItem[]
  averageDistanceKm: number
  averageYen: number
  csvRows: AnalyticsCsvRow[]
  distanceRangeSummary: DistanceRangeAnalyticsItem[]
  distanceSummary: DistanceAnalyticsSummary
  dropoffAreaCountTop: AreaDirectionalAnalyticsItem[]
  dropoffAreaSalesTop: AreaDirectionalAnalyticsItem[]
  expenseSummary: AnalyticsBreakdownItem[]
  filteredCount: number
  monthlySummary: MonthlyAnalyticsItem[]
  paymentMethodSummary: PaymentAnalyticsItem[]
  pickupAreaCountTop: AreaDirectionalAnalyticsItem[]
  pickupAreaSalesTop: AreaDirectionalAnalyticsItem[]
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

const dateInputFormatter = new Intl.DateTimeFormat('sv-SE', {
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

const toValidDate = (dateValue: string) => {
  const date = new Date(dateValue)
  return Number.isNaN(date.getTime()) ? null : date
}

const getCaseRecordDateValue = (caseRecord: StoredCaseRecord) =>
  caseRecord.caseDate ||
  caseRecord.closedAt ||
  caseRecord.createdAt ||
  caseRecord.startedAt

const toDateLabel = (dateValue: string) => {
  const date = toValidDate(dateValue)
  return date ? dateFormatter.format(date) : '日付未設定'
}

const toCaseRecordDateLabel = (caseRecord: StoredCaseRecord) =>
  toDateLabel(getCaseRecordDateValue(caseRecord))

const toMonthKey = (dateValue: string) => {
  const date = toValidDate(dateValue)
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

const japanesePrefectures =
  '北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県'

const extractAreaName = (address: string) => {
  const normalizedAddress = address
    .replace(/〒?\d{3}-?\d{4}/g, '')
    .replace(/\s+/g, '')
    .trim()

  if (!normalizedAddress) {
    return '住所未設定'
  }

  const prefectureMatch = new RegExp(
    `^(${japanesePrefectures})(.+?[市区町村])?`,
  ).exec(normalizedAddress)
  if (prefectureMatch) {
    return `${prefectureMatch[1]}${prefectureMatch[2] ?? ''}`
  }

  const municipalityMatch = /^(.+?[市区町村])/.exec(normalizedAddress)
  return municipalityMatch?.[1] ?? normalizedAddress.slice(0, 12)
}

const parseDateValue = (dateValue: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)

  if (!match) {
    const fallback = getDefaultAnalyticsPeriod()
    return parseDateValue(fallback.endDate)
  }

  return {
    day: Number(match[3]),
    month: Number(match[2]),
    year: Number(match[1]),
  }
}

const createJapanStartOfDayIso = (dateValue: string) => {
  const { day, month, year } = parseDateValue(dateValue)
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0)).toISOString()
}

const createJapanNextDayStartIso = (dateValue: string) => {
  const { day, month, year } = parseDateValue(dateValue)
  return new Date(Date.UTC(year, month - 1, day + 1, -9, 0, 0, 0)).toISOString()
}

function getSortedPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  return period.startDate <= period.endDate
    ? period
    : { endDate: period.startDate, startDate: period.endDate }
}

function getMonthKeysInPeriod(period: AnalyticsPeriod) {
  const { endDate, startDate } = getSortedPeriod(period)
  const start = parseDateValue(startDate)
  const end = parseDateValue(endDate)
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

function toBreakdownItem(
  label: string,
  salesYen: number,
  totalSalesYen: number,
) {
  return {
    label,
    percent: toPercent(salesYen, totalSalesYen),
    salesYen,
  }
}

function calculateStaffSummary(
  caseRecords: StoredCaseRecord[],
  staffMembers: StaffMember[] = [],
): StaffAnalyticsItem[] {
  const staffNameById = new Map(
    staffMembers.map((staffMember) => [
      staffMember.id,
      staffMember.name.trim() || '名称未設定のスタッフ',
    ]),
  )
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
      staffName: staffNameById.get(staffId) ?? toStaffName(caseRecord),
      salesYen: 0,
    }
    const dateLabel = toCaseRecordDateLabel(caseRecord)

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
    .sort(
      (firstStaff, secondStaff) =>
        secondStaff.salesYen - firstStaff.salesYen ||
        firstStaff.staffName.localeCompare(secondStaff.staffName, 'ja'),
    )
}

const distanceRanges = [
  { label: '5km未満', minKm: 0, maxKm: 5 },
  { label: '5km〜10km', minKm: 5, maxKm: 10 },
  { label: '10km〜20km', minKm: 10, maxKm: 20 },
  { label: '20km以上', minKm: 20, maxKm: Number.POSITIVE_INFINITY },
]

function addDirectionalArea(
  map: Map<string, { count: number; distanceKm: number; salesYen: number }>,
  areaName: string,
  salesYen: number,
  distanceKm: number,
) {
  const current = map.get(areaName) ?? { count: 0, distanceKm: 0, salesYen: 0 }
  map.set(areaName, {
    count: current.count + 1,
    distanceKm: current.distanceKm + distanceKm,
    salesYen: current.salesYen + salesYen,
  })
}

function toDirectionalAreaItems(
  map: Map<string, { count: number; distanceKm: number; salesYen: number }>,
) {
  return Array.from(map, ([areaName, item]) => ({
    areaName,
    averageDistanceKm: item.count > 0 ? item.distanceKm / item.count : 0,
    averageYen: toAverageYen(item.salesYen, item.count),
    count: item.count,
    distanceKm: item.distanceKm,
    salesYen: item.salesYen,
  }))
}

function calculateAreaAnalytics(caseRecords: StoredCaseRecord[]) {
  const pickupMap = new Map<
    string,
    { count: number; distanceKm: number; salesYen: number }
  >()
  const dropoffMap = new Map<
    string,
    { count: number; distanceKm: number; salesYen: number }
  >()
  const areaMap = new Map<
    string,
    {
      associatedCaseIds: Set<string>
      distanceKm: number
      dropoffCount: number
      pickupCount: number
      salesYen: number
    }
  >()

  caseRecords.forEach((caseRecord) => {
    const pickupArea = extractAreaName(caseRecord.pickupAddress)
    const dropoffArea = extractAreaName(caseRecord.dropoffAddress)
    const salesYen = toFiniteNumber(caseRecord.totalFareYen)
    const distanceKm = toFiniteNumber(caseRecord.distanceKm)

    addDirectionalArea(pickupMap, pickupArea, salesYen, distanceKm)
    addDirectionalArea(dropoffMap, dropoffArea, salesYen, distanceKm)

    const touchedAreas = new Set([pickupArea, dropoffArea])
    touchedAreas.forEach((areaName) => {
      const current = areaMap.get(areaName) ?? {
        associatedCaseIds: new Set<string>(),
        distanceKm: 0,
        dropoffCount: 0,
        pickupCount: 0,
        salesYen: 0,
      }

      current.associatedCaseIds.add(caseRecord.id)
      current.distanceKm += distanceKm
      current.salesYen += salesYen
      if (areaName === pickupArea) {
        current.pickupCount += 1
      }
      if (areaName === dropoffArea) {
        current.dropoffCount += 1
      }
      areaMap.set(areaName, current)
    })
  })

  const areaSummary = Array.from(areaMap, ([areaName, item]) => {
    const associatedCount = item.associatedCaseIds.size

    return {
      areaName,
      averageDistanceKm:
        associatedCount > 0 ? item.distanceKm / associatedCount : 0,
      averageYen: toAverageYen(item.salesYen, associatedCount),
      distanceKm: item.distanceKm,
      dropoffCount: item.dropoffCount,
      pickupCount: item.pickupCount,
      salesYen: item.salesYen,
    }
  }).sort((firstArea, secondArea) => secondArea.salesYen - firstArea.salesYen)

  const pickupAreaItems = toDirectionalAreaItems(pickupMap)
  const dropoffAreaItems = toDirectionalAreaItems(dropoffMap)

  return {
    areaSummary,
    dropoffAreaCountTop: [...dropoffAreaItems]
      .sort((firstArea, secondArea) => secondArea.count - firstArea.count)
      .slice(0, 10),
    dropoffAreaSalesTop: [...dropoffAreaItems]
      .sort((firstArea, secondArea) => secondArea.salesYen - firstArea.salesYen)
      .slice(0, 10),
    pickupAreaCountTop: [...pickupAreaItems]
      .sort((firstArea, secondArea) => secondArea.count - firstArea.count)
      .slice(0, 10),
    pickupAreaSalesTop: [...pickupAreaItems]
      .sort((firstArea, secondArea) => secondArea.salesYen - firstArea.salesYen)
      .slice(0, 10),
  }
}

function calculateDistanceRangeSummary(caseRecords: StoredCaseRecord[]) {
  const totalCount = caseRecords.length

  return distanceRanges.map((range) => {
    const rangeRecords = caseRecords.filter((caseRecord) => {
      const distanceKm = toFiniteNumber(caseRecord.distanceKm)
      return distanceKm >= range.minKm && distanceKm < range.maxKm
    })

    return {
      count: rangeRecords.length,
      label: range.label,
      percent: toPercent(rangeRecords.length, totalCount),
      salesYen: rangeRecords.reduce(
        (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
        0,
      ),
    }
  })
}

function calculateDistanceSummary(
  caseRecords: StoredCaseRecord[],
): DistanceAnalyticsSummary {
  const distances = caseRecords.map((caseRecord) =>
    toFiniteNumber(caseRecord.distanceKm),
  )
  const totalDistanceKm = distances.reduce(
    (total, distanceKm) => total + distanceKm,
    0,
  )

  return {
    averageDistanceKm:
      distances.length > 0 ? totalDistanceKm / distances.length : 0,
    maxDistanceKm: distances.length > 0 ? Math.max(...distances) : 0,
    minDistanceKm: distances.length > 0 ? Math.min(...distances) : 0,
    totalDistanceKm,
  }
}

export function getDefaultAnalyticsPeriod(date = new Date()): AnalyticsPeriod {
  const currentDate = dateInputFormatter.format(date)
  const currentMonth = currentDate.slice(0, 7)

  return {
    endDate: currentDate,
    startDate: `${currentMonth}-01`,
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
  staffMembers: StaffMember[] = [],
): SalesAnalyticsSummary {
  const sortedPeriod = getSortedPeriod(period)
  const startIso = createJapanStartOfDayIso(sortedPeriod.startDate)
  const endIso = createJapanNextDayStartIso(sortedPeriod.endDate)
  const startTime = toValidDate(startIso)?.getTime() ?? 0
  const endTime = toValidDate(endIso)?.getTime() ?? 0
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
    const caseDateValue = getCaseRecordDateValue(caseRecord)
    const caseDate = toValidDate(caseDateValue)
    const caseTime = caseDate?.getTime() ?? Number.NaN
    return caseTime >= startTime && caseTime < endTime
  })
  const staffSummary = calculateStaffSummary(periodRecords, staffMembers)
  const filteredRecords =
    staffId === 'all'
      ? periodRecords
      : periodRecords.filter(
          (caseRecord) => toStaffAnalyticsId(caseRecord) === staffId,
        )
  const areaAnalytics = calculateAreaAnalytics(filteredRecords)
  const distanceRangeSummary = calculateDistanceRangeSummary(filteredRecords)
  const distanceSummary = calculateDistanceSummary(filteredRecords)
  const totalSalesYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
    0,
  )
  const activeDayKeys = new Set<string>()
  const paymentMethodMap = new Map<
    string,
    { count: number; salesYen: number }
  >()
  const assistItemMap = new Map<string, { count: number; salesYen: number }>()
  const expenseMap = new Map<string, { count: number; salesYen: number }>()

  let totalDistanceKm = 0
  let totalDrivingSeconds = 0

  filteredRecords.forEach((caseRecord) => {
    const salesYen = toFiniteNumber(caseRecord.totalFareYen)
    const distanceKm = toFiniteNumber(caseRecord.distanceKm)
    const drivingSeconds = toFiniteNumber(caseRecord.drivingSeconds)
    const dateLabel = toCaseRecordDateLabel(caseRecord)
    const monthKey = toMonthKey(getCaseRecordDateValue(caseRecord))
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

    addToMap(
      paymentMethodMap,
      toPaymentMethodLabel(caseRecord.paymentMethod),
      salesYen,
    )

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
    areaSummary: areaAnalytics.areaSummary,
    assistItemSummary: Array.from(assistItemMap, ([label, item]) => ({
      count: item.count,
      label,
      percent: toPercent(item.salesYen, totalSalesYen),
      salesYen: item.salesYen,
    })).sort(
      (firstItem, secondItem) => secondItem.salesYen - firstItem.salesYen,
    ),
    averageDistanceKm: distanceSummary.averageDistanceKm,
    averageYen: toAverageYen(totalSalesYen, filteredRecords.length),
    csvRows: filteredRecords.map((caseRecord) => ({
      basicFareYen: toFiniteNumber(caseRecord.basicFareYen),
      careOptionFareYen: toFiniteNumber(caseRecord.careOptionFareYen),
      caseNumber: caseRecord.caseNumber,
      dateLabel: toCaseRecordDateLabel(caseRecord),
      distanceKm: toFiniteNumber(caseRecord.distanceKm),
      drivingSeconds: toFiniteNumber(caseRecord.drivingSeconds),
      escortFareYen: toFiniteNumber(caseRecord.escortFareYen),
      expenseFareYen: toFiniteNumber(caseRecord.expenseFareYen),
      paymentMethod: toPaymentMethodLabel(caseRecord.paymentMethod),
      totalFareYen: toFiniteNumber(caseRecord.totalFareYen),
      waitingFareYen: toFiniteNumber(caseRecord.waitingFareYen),
    })),
    distanceRangeSummary,
    distanceSummary,
    dropoffAreaCountTop: areaAnalytics.dropoffAreaCountTop,
    dropoffAreaSalesTop: areaAnalytics.dropoffAreaSalesTop,
    expenseSummary: Array.from(expenseMap, ([label, item]) => ({
      count: item.count,
      label,
      percent: toPercent(item.salesYen, totalSalesYen),
      salesYen: item.salesYen,
    })).sort(
      (firstItem, secondItem) => secondItem.salesYen - firstItem.salesYen,
    ),
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
    })).sort(
      (firstItem, secondItem) => secondItem.salesYen - firstItem.salesYen,
    ),
    pickupAreaCountTop: areaAnalytics.pickupAreaCountTop,
    pickupAreaSalesTop: areaAnalytics.pickupAreaSalesTop,
    revenueBreakdown,
    salesComposition: revenueBreakdown,
    staffSummary,
    topCases: [...filteredRecords]
      .sort((firstRecord, secondRecord) => {
        const salesDifference =
          toFiniteNumber(secondRecord.totalFareYen) -
          toFiniteNumber(firstRecord.totalFareYen)
        return (
          salesDifference ||
          secondRecord.closedAt.localeCompare(firstRecord.closedAt)
        )
      })
      .slice(0, 10)
      .map((caseRecord) => ({
        caseNumber: caseRecord.caseNumber,
        dateLabel: toCaseRecordDateLabel(caseRecord),
        salesYen: toFiniteNumber(caseRecord.totalFareYen),
      })),
    totalCount: filteredRecords.length,
    totalDistanceKm,
    totalDrivingSeconds,
    totalSalesYen,
  }
}
