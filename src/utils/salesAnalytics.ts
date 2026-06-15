import type { StoredCaseRecord } from '../services/caseRecords'
import { getBillableCaseRecords } from './caseRecords'
import type { StaffMember, Vehicle } from '../types/work'

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
  chargeableDistanceKm: number
  businessDistanceKm: number
  distanceKm: number
  drivingSeconds: number
  monthKey: string
  monthLabel: string
  salesYen: number
}

export type TopCaseAnalyticsItem = {
  basicFareYen: number
  careOptionFareYen: number
  caseNumber: string
  dateLabel: string
  chargeableDistanceKm: number
  businessDistanceKm: number
  distanceKm: number
  drivingSeconds: number
  dropoffAreaName: string
  escortFareYen: number
  expenseFareYen: number
  id: string
  pickupAreaName: string
  salesYen: number
  waitingFareYen: number
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

export type RangeAnalyticsItem = {
  averageDistanceKm: number
  averageYen: number
  count: number
  label: string
  percent: number
  salesYen: number
}

export type DistanceRangeAnalyticsItem = RangeAnalyticsItem

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
  dropoffAreaName: string
  chargeableDistanceKm: number
  businessDistanceKm: number
  distanceKm: number
  drivingSeconds: number
  escortFareYen: number
  expenseFareYen: number
  grossFareYen: number
  disabilityDiscountAmount: number
  taxiTicketAmountYen: number
  actualPaymentYen: number
  paymentMethod: string
  pickupAreaName: string
  staffName: string
  totalFareYen: number
  vehicleName: string
  waitingFareYen: number
}

export type StaffAnalyticsItem = {
  activeDayCount: number
  averageYen: number
  count: number
  chargeableDistanceKm: number
  businessDistanceKm: number
  distanceKm: number
  drivingSeconds: number
  staffId: string
  staffName: string
  salesYen: number
}


export type VehicleAnalyticsItem = {
  activeDayCount: number
  averageYen: number
  count: number
  chargeableDistanceKm: number
  businessDistanceKm: number
  distanceKm: number
  drivingSeconds: number
  salesYen: number
  vehicleId: string
  vehicleName: string
}

export type WeekdayAnalyticsItem = {
  averageYen: number
  count: number
  dayIndex: number
  drivingSeconds: number
  label: string
  salesYen: number
}

export type TimeRangeAnalyticsItem = {
  averageYen: number
  count: number
  label: string
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
  salesRangeSummary: RangeAnalyticsItem[]
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
  timeRangeSummary: TimeRangeAnalyticsItem[]
  topCases: TopCaseAnalyticsItem[]
  totalCount: number
  totalGrossSalesYen: number
  totalDiscountYen: number
  totalTaxiTicketYen: number
  totalClaimYen: number
  totalActualPaymentYen: number
  totalChargeableDistanceKm: number
  totalBusinessDistanceKm: number
  totalDistanceKm: number
  totalDrivingSeconds: number
  totalSalesYen: number
  vehicleSummary: VehicleAnalyticsItem[]
  weekdaySummary: WeekdayAnalyticsItem[]
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

const getChargeableDistanceKm = (caseRecord: StoredCaseRecord) =>
  toFiniteNumber(caseRecord.chargeableDistanceKm) || toFiniteNumber(caseRecord.distanceKm)

const getBusinessDistanceKm = (caseRecord: StoredCaseRecord) =>
  toFiniteNumber(caseRecord.businessDistanceKm) || toFiniteNumber(caseRecord.distanceKm)

const staffUnknownId = '__staff_unknown__'
const vehicleUnknownId = '__vehicle_unknown__'

const toPaymentMethodLabel = (paymentMethod: unknown) =>
  typeof paymentMethod === 'string' && paymentMethod.trim()
    ? paymentMethod.trim()
    : '未設定'

const toTaxiTicketTotalYen = (caseRecord: StoredCaseRecord) => {
  const appliedTaxiTicketYen = toFiniteNumber(caseRecord.taxiTicketAmountYen)

  if (appliedTaxiTicketYen > 0) {
    return appliedTaxiTicketYen
  }

  return caseRecord.taxiTickets.reduce(
    (total, ticket) => total + toFiniteNumber(ticket.amount),
    0,
  )
}

const toPaymentTotalYen = (caseRecord: StoredCaseRecord) =>
  caseRecord.payments.length > 0
    ? caseRecord.payments.reduce((total, payment) => total + toFiniteNumber(payment.amount), 0)
    : toFiniteNumber(caseRecord.totalFareYen)

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

const toVehicleName = (caseRecord: StoredCaseRecord) =>
  caseRecord.vehicleName.trim() || '車両未設定'

export const toVehicleAnalyticsId = (caseRecord: StoredCaseRecord) =>
  caseRecord.vehicleId.trim() ||
  (caseRecord.vehicleName.trim()
    ? `vehicle-name:${caseRecord.vehicleName.trim()}`
    : vehicleUnknownId)

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

  const withoutPrefecture = normalizedAddress.replace(
    new RegExp(`^(${japanesePrefectures})`),
    '',
  )
  const townMatch = /^(.+?[市区町村](?:.+?区)?[^0-9０-９一二三四五六七八九十-]+?)(?:[0-9０-９一二三四五六七八九十-]|丁目|番|号|$)/.exec(withoutPrefecture)

  if (townMatch?.[1]) {
    return townMatch[1].replace(/[、,].*$/, '')
  }

  const municipalityMatch = /^(.+?[市区町村])/.exec(withoutPrefecture)
  return municipalityMatch?.[1] ?? withoutPrefecture.slice(0, 18)
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


function calculateVehicleSummary(
  caseRecords: StoredCaseRecord[],
  vehicles: Vehicle[] = [],
): VehicleAnalyticsItem[] {
  const vehicleNameById = new Map(
    vehicles.map((vehicle) => [
      vehicle.id,
      vehicle.name.trim() || '名称未設定の車両',
    ]),
  )
  const vehicleMap = new Map<
    string,
    {
      activeDayKeys: Set<string>
      count: number
      chargeableDistanceKm: number
      businessDistanceKm: number
      distanceKm: number
      drivingSeconds: number
      salesYen: number
      vehicleId: string
      vehicleName: string
    }
  >()

  caseRecords.forEach((caseRecord) => {
    const vehicleId = toVehicleAnalyticsId(caseRecord)
    const current = vehicleMap.get(vehicleId) ?? {
      activeDayKeys: new Set<string>(),
      count: 0,
      chargeableDistanceKm: 0,
      businessDistanceKm: 0,
      distanceKm: 0,
      drivingSeconds: 0,
      salesYen: 0,
      vehicleId,
      vehicleName: vehicleNameById.get(vehicleId) ?? toVehicleName(caseRecord),
    }
    const dateLabel = toCaseRecordDateLabel(caseRecord)

    if (dateLabel !== '日付未設定') {
      current.activeDayKeys.add(dateLabel)
    }

    current.count += 1
    current.chargeableDistanceKm += getChargeableDistanceKm(caseRecord)
    current.businessDistanceKm += getBusinessDistanceKm(caseRecord)
    current.distanceKm += getBusinessDistanceKm(caseRecord)
    current.drivingSeconds += toFiniteNumber(caseRecord.drivingSeconds)
    current.salesYen += toFiniteNumber(caseRecord.totalFareYen)
    vehicleMap.set(vehicleId, current)
  })

  return Array.from(vehicleMap.values())
    .map((vehicleSummary) => ({
      activeDayCount: vehicleSummary.activeDayKeys.size,
      averageYen: toAverageYen(vehicleSummary.salesYen, vehicleSummary.count),
      count: vehicleSummary.count,
      chargeableDistanceKm: vehicleSummary.chargeableDistanceKm,
      businessDistanceKm: vehicleSummary.businessDistanceKm,
      distanceKm: vehicleSummary.distanceKm,
      drivingSeconds: vehicleSummary.drivingSeconds,
      salesYen: vehicleSummary.salesYen,
      vehicleId: vehicleSummary.vehicleId,
      vehicleName: vehicleSummary.vehicleName,
    }))
    .sort(
      (firstVehicle, secondVehicle) =>
        secondVehicle.salesYen - firstVehicle.salesYen ||
        firstVehicle.vehicleName.localeCompare(secondVehicle.vehicleName, 'ja'),
    )
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
      chargeableDistanceKm: number
      businessDistanceKm: number
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
      chargeableDistanceKm: 0,
      businessDistanceKm: 0,
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
    current.chargeableDistanceKm += getChargeableDistanceKm(caseRecord)
    current.businessDistanceKm += getBusinessDistanceKm(caseRecord)
    current.distanceKm += getBusinessDistanceKm(caseRecord)
    current.drivingSeconds += toFiniteNumber(caseRecord.drivingSeconds)
    current.salesYen += toFiniteNumber(caseRecord.totalFareYen)
    staffMap.set(staffId, current)
  })

  return Array.from(staffMap.values())
    .map((staffSummary) => ({
      activeDayCount: staffSummary.activeDayKeys.size,
      averageYen: toAverageYen(staffSummary.salesYen, staffSummary.count),
      count: staffSummary.count,
      chargeableDistanceKm: staffSummary.chargeableDistanceKm,
      businessDistanceKm: staffSummary.businessDistanceKm,
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
  { label: '0km〜3km未満', minKm: 0, maxKm: 3 },
  { label: '3km〜10km未満', minKm: 3, maxKm: 10 },
  { label: '10km〜30km未満', minKm: 10, maxKm: 30 },
  { label: '30km以上', minKm: 30, maxKm: Number.POSITIVE_INFINITY },
]

const salesRanges = [
  { label: '3,000円未満', minYen: 0, maxYen: 3000 },
  { label: '3,000円〜5,000円未満', minYen: 3000, maxYen: 5000 },
  { label: '5,000円〜10,000円未満', minYen: 5000, maxYen: 10000 },
  { label: '10,000円以上', minYen: 10000, maxYen: Number.POSITIVE_INFINITY },
]

const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
const weekdayDisplayOrder = [1, 2, 3, 4, 5, 6, 0]

const timeRanges = [
  { label: '6時〜9時', minHour: 6, maxHour: 9 },
  { label: '9時〜12時', minHour: 9, maxHour: 12 },
  { label: '12時〜15時', minHour: 12, maxHour: 15 },
  { label: '15時〜18時', minHour: 15, maxHour: 18 },
  { label: '18時〜21時', minHour: 18, maxHour: 21 },
  { label: '21時以降', minHour: 21, maxHour: Number.POSITIVE_INFINITY },
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
    const distanceKm = getBusinessDistanceKm(caseRecord)

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
      const distanceKm = getBusinessDistanceKm(caseRecord)
      return distanceKm >= range.minKm && distanceKm < range.maxKm
    })
    const salesYen = rangeRecords.reduce(
      (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
      0,
    )
    const distanceKm = rangeRecords.reduce(
      (total, caseRecord) => total + getBusinessDistanceKm(caseRecord),
      0,
    )

    return {
      averageDistanceKm: rangeRecords.length > 0 ? distanceKm / rangeRecords.length : 0,
      averageYen: toAverageYen(salesYen, rangeRecords.length),
      count: rangeRecords.length,
      label: range.label,
      percent: toPercent(rangeRecords.length, totalCount),
      salesYen,
    }
  })
}

function calculateSalesRangeSummary(caseRecords: StoredCaseRecord[]) {
  const totalCount = caseRecords.length

  return salesRanges.map((range) => {
    const rangeRecords = caseRecords.filter((caseRecord) => {
      const salesYen = toFiniteNumber(caseRecord.totalFareYen)
      return salesYen >= range.minYen && salesYen < range.maxYen
    })
    const salesYen = rangeRecords.reduce(
      (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
      0,
    )
    const distanceKm = rangeRecords.reduce(
      (total, caseRecord) => total + getBusinessDistanceKm(caseRecord),
      0,
    )

    return {
      averageDistanceKm: rangeRecords.length > 0 ? distanceKm / rangeRecords.length : 0,
      averageYen: toAverageYen(salesYen, rangeRecords.length),
      count: rangeRecords.length,
      label: range.label,
      percent: toPercent(rangeRecords.length, totalCount),
      salesYen,
    }
  })
}

function getJapanDateParts(dateValue: string) {
  const date = toValidDate(dateValue)
  if (!date) {
    return null
  }

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  })
  const parts = formatter.formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? ''
  const dayIndex = weekdayLabels.indexOf(weekdayLabel)

  return {
    dayIndex: dayIndex >= 0 ? dayIndex : date.getUTCDay(),
    hour,
  }
}

function calculateWeekdaySummary(caseRecords: StoredCaseRecord[]) {
  const map = new Map(
    weekdayLabels.map((label, dayIndex) => [
      dayIndex,
      { count: 0, drivingSeconds: 0, label, salesYen: 0 },
    ]),
  )

  caseRecords.forEach((caseRecord) => {
    const parts = getJapanDateParts(getCaseRecordDateValue(caseRecord))
    if (!parts) {
      return
    }

    const current = map.get(parts.dayIndex)
    if (!current) {
      return
    }

    current.count += 1
    current.drivingSeconds += toFiniteNumber(caseRecord.drivingSeconds)
    current.salesYen += toFiniteNumber(caseRecord.totalFareYen)
  })

  return weekdayDisplayOrder.map((dayIndex) => {
    const item = map.get(dayIndex) ?? { count: 0, drivingSeconds: 0, label: weekdayLabels[dayIndex], salesYen: 0 }
    return {
      averageYen: toAverageYen(item.salesYen, item.count),
      count: item.count,
      dayIndex,
      drivingSeconds: item.drivingSeconds,
      label: item.label,
      salesYen: item.salesYen,
    }
  })
}

function calculateTimeRangeSummary(caseRecords: StoredCaseRecord[]) {
  return timeRanges.map((range) => {
    const rangeRecords = caseRecords.filter((caseRecord) => {
      const parts = getJapanDateParts(caseRecord.startedAt || getCaseRecordDateValue(caseRecord))
      const hour = parts?.hour ?? -1
      return hour >= range.minHour && hour < range.maxHour
    })
    const salesYen = rangeRecords.reduce(
      (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
      0,
    )

    return {
      averageYen: toAverageYen(salesYen, rangeRecords.length),
      count: rangeRecords.length,
      label: range.label,
      salesYen,
    }
  })
}

function calculateDistanceSummary(
  caseRecords: StoredCaseRecord[],
): DistanceAnalyticsSummary {
  const distances = caseRecords.map((caseRecord) =>
    getBusinessDistanceKm(caseRecord),
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
  vehicleId = 'all',
  vehicles: Vehicle[] = [],
): SalesAnalyticsSummary {
  const sortedPeriod = getSortedPeriod(period)
  const startIso = createJapanStartOfDayIso(sortedPeriod.startDate)
  const endIso = createJapanNextDayStartIso(sortedPeriod.endDate)
  const startTime = toValidDate(startIso)?.getTime() ?? 0
  const endTime = toValidDate(endIso)?.getTime() ?? 0
  const monthKeys = getMonthKeysInPeriod(sortedPeriod)
  const billableCaseRecords = getBillableCaseRecords(caseRecords)
  const monthlyMap = new Map(
    monthKeys.map((monthKey) => [
      monthKey,
      {
        count: 0,
        chargeableDistanceKm: 0,
        businessDistanceKm: 0,
        distanceKm: 0,
        drivingSeconds: 0,
        salesYen: 0,
      },
    ]),
  )
  const periodRecords = billableCaseRecords.filter((caseRecord) => {
    const caseDateValue = getCaseRecordDateValue(caseRecord)
    const caseDate = toValidDate(caseDateValue)
    const caseTime = caseDate?.getTime() ?? Number.NaN
    return caseTime >= startTime && caseTime < endTime
  })
  const staffFilteredRecords =
    staffId === 'all'
      ? periodRecords
      : periodRecords.filter(
          (caseRecord) => toStaffAnalyticsId(caseRecord) === staffId,
        )
  const filteredRecords =
    vehicleId === 'all'
      ? staffFilteredRecords
      : staffFilteredRecords.filter(
          (caseRecord) => toVehicleAnalyticsId(caseRecord) === vehicleId,
        )
  const staffSummary = calculateStaffSummary(
    vehicleId === 'all'
      ? periodRecords
      : periodRecords.filter(
          (caseRecord) => toVehicleAnalyticsId(caseRecord) === vehicleId,
        ),
    staffMembers,
  )
  const vehicleSummary = calculateVehicleSummary(staffFilteredRecords, vehicles)
  const areaAnalytics = calculateAreaAnalytics(filteredRecords)
  const distanceRangeSummary = calculateDistanceRangeSummary(filteredRecords)
  const salesRangeSummary = calculateSalesRangeSummary(filteredRecords)
  const weekdaySummary = calculateWeekdaySummary(filteredRecords)
  const timeRangeSummary = calculateTimeRangeSummary(filteredRecords)
  const distanceSummary = calculateDistanceSummary(filteredRecords)
  const totalSalesYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.totalFareYen),
    0,
  )
  const totalGrossSalesYen = filteredRecords.reduce(
    (total, caseRecord) => total + (toFiniteNumber(caseRecord.grossFareYen) || toFiniteNumber(caseRecord.totalFareYen)),
    0,
  )
  const totalDiscountYen = filteredRecords.reduce(
    (total, caseRecord) => total + toFiniteNumber(caseRecord.disabilityDiscountAmount),
    0,
  )
  const totalTaxiTicketYen = filteredRecords.reduce(
    (total, caseRecord) => total + toTaxiTicketTotalYen(caseRecord),
    0,
  )
  const totalActualPaymentYen = filteredRecords.reduce(
    (total, caseRecord) => total + toPaymentTotalYen(caseRecord),
    0,
  )
  const activeDayKeys = new Set<string>()
  const paymentMethodMap = new Map<
    string,
    { count: number; salesYen: number }
  >()
  const assistItemMap = new Map<string, { count: number; salesYen: number }>()
  const expenseMap = new Map<string, { count: number; salesYen: number }>()

  let totalChargeableDistanceKm = 0
  let totalBusinessDistanceKm = 0
  let totalDistanceKm = 0
  let totalDrivingSeconds = 0

  filteredRecords.forEach((caseRecord) => {
    const salesYen = toFiniteNumber(caseRecord.totalFareYen)
    const chargeableDistanceKm = getChargeableDistanceKm(caseRecord)
    const businessDistanceKm = getBusinessDistanceKm(caseRecord)
    const distanceKm = businessDistanceKm
    const drivingSeconds = toFiniteNumber(caseRecord.drivingSeconds)
    const dateLabel = toCaseRecordDateLabel(caseRecord)
    const monthKey = toMonthKey(getCaseRecordDateValue(caseRecord))
    const monthly = monthKey ? monthlyMap.get(monthKey) : null

    if (dateLabel !== '日付未設定') {
      activeDayKeys.add(dateLabel)
    }

    totalChargeableDistanceKm += chargeableDistanceKm
    totalBusinessDistanceKm += businessDistanceKm
    totalDistanceKm += distanceKm
    totalDrivingSeconds += drivingSeconds

    if (monthly) {
      monthly.count += 1
      monthly.chargeableDistanceKm += chargeableDistanceKm
      monthly.businessDistanceKm += businessDistanceKm
      monthly.distanceKm += distanceKm
      monthly.drivingSeconds += drivingSeconds
      monthly.salesYen += salesYen
    }

    if (caseRecord.payments.length > 0) {
      caseRecord.payments.forEach((payment) => {
        addToMap(paymentMethodMap, toPaymentMethodLabel(payment.type), toFiniteNumber(payment.amount))
      })
    } else {
      addToMap(
        paymentMethodMap,
        toPaymentMethodLabel(caseRecord.paymentMethod),
        salesYen,
      )
    }

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
      dropoffAreaName: extractAreaName(caseRecord.dropoffAddress),
      chargeableDistanceKm: getChargeableDistanceKm(caseRecord),
      businessDistanceKm: getBusinessDistanceKm(caseRecord),
      distanceKm: getBusinessDistanceKm(caseRecord),
      drivingSeconds: toFiniteNumber(caseRecord.drivingSeconds),
      escortFareYen: toFiniteNumber(caseRecord.escortFareYen),
      expenseFareYen: toFiniteNumber(caseRecord.expenseFareYen),
      grossFareYen: toFiniteNumber(caseRecord.grossFareYen) || toFiniteNumber(caseRecord.totalFareYen),
      disabilityDiscountAmount: toFiniteNumber(caseRecord.disabilityDiscountAmount),
      taxiTicketAmountYen: toTaxiTicketTotalYen(caseRecord),
      actualPaymentYen: toPaymentTotalYen(caseRecord),
      paymentMethod: toPaymentMethodLabel(caseRecord.paymentMethod),
      pickupAreaName: extractAreaName(caseRecord.pickupAddress),
      staffName: toStaffName(caseRecord),
      totalFareYen: toFiniteNumber(caseRecord.totalFareYen),
      vehicleName: toVehicleName(caseRecord),
      waitingFareYen: toFiniteNumber(caseRecord.waitingFareYen),
    })),
    distanceRangeSummary,
    distanceSummary,
    salesRangeSummary,
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
        chargeableDistanceKm: 0,
        businessDistanceKm: 0,
        distanceKm: 0,
        drivingSeconds: 0,
        salesYen: 0,
      }

      return {
        averageYen: toAverageYen(monthly.salesYen, monthly.count),
        count: monthly.count,
        chargeableDistanceKm: monthly.chargeableDistanceKm,
        businessDistanceKm: monthly.businessDistanceKm,
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
    timeRangeSummary,
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
        basicFareYen: toFiniteNumber(caseRecord.basicFareYen),
        careOptionFareYen: toFiniteNumber(caseRecord.careOptionFareYen),
        caseNumber: caseRecord.caseNumber,
        dateLabel: toCaseRecordDateLabel(caseRecord),
        chargeableDistanceKm: getChargeableDistanceKm(caseRecord),
        businessDistanceKm: getBusinessDistanceKm(caseRecord),
        distanceKm: getBusinessDistanceKm(caseRecord),
        drivingSeconds: toFiniteNumber(caseRecord.drivingSeconds),
        dropoffAreaName: extractAreaName(caseRecord.dropoffAddress),
        escortFareYen: toFiniteNumber(caseRecord.escortFareYen),
        expenseFareYen: toFiniteNumber(caseRecord.expenseFareYen),
        id: caseRecord.id,
        pickupAreaName: extractAreaName(caseRecord.pickupAddress),
        salesYen: toFiniteNumber(caseRecord.totalFareYen),
        waitingFareYen: toFiniteNumber(caseRecord.waitingFareYen),
      })),
    totalCount: filteredRecords.length,
    totalGrossSalesYen,
    totalDiscountYen,
    totalTaxiTicketYen,
    totalClaimYen: totalSalesYen,
    totalActualPaymentYen,
    totalChargeableDistanceKm,
    totalBusinessDistanceKm,
    totalDistanceKm,
    totalDrivingSeconds,
    totalSalesYen,
    vehicleSummary,
    weekdaySummary,
  }
}
