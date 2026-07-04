import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import type { MeterMode } from '../types/case'
import {
  PRE_FIXED_FARE_PASSENGER_CHANGE_PANEL_TITLE,
  isPreFixedFarePassengerChangeCompletion,
} from '../types/preFixedFare'
import { getDatePartsInJapan, getMonthRangeInJapan, getTodayRangeInJapan } from './japanDate'
import { meterModeLabels } from './meterConstants'

export { meterModeLabels }
export { getMonthRangeInJapan, getTodayRangeInJapan }

export function getActualMeterMode(caseRecord: StoredCaseRecord): MeterMode {
  const mode = (caseRecord.actualMeterMode || caseRecord.meterMode || 'gps') as MeterMode
  if (mode === 'fixed') {
    return 'fixed'
  }
  return mode === 'time' || mode === 'obd' ? mode : 'gps'
}

export function getActualFareYen(caseRecord: StoredCaseRecord): number {
  if (typeof caseRecord.actualFareYen === 'number' && Number.isFinite(caseRecord.actualFareYen)) {
    return caseRecord.actualFareYen
  }

  return typeof caseRecord.totalFareYen === 'number' && Number.isFinite(caseRecord.totalFareYen)
    ? caseRecord.totalFareYen
    : 0
}

export type CaseComparisonDisplay = {
  comparisonFareYen: number
  comparisonLabel: string
  differenceYen: number
}

export function getCaseComparisonDisplay(
  caseRecord: StoredCaseRecord,
): CaseComparisonDisplay | null {
  const actualFareYen = getActualFareYen(caseRecord)
  const meterMode = getActualMeterMode(caseRecord)

  if (meterMode === 'time' && caseRecord.gpsComparisonFareYen != null) {
    return {
      comparisonFareYen: caseRecord.gpsComparisonFareYen,
      comparisonLabel: 'GPSM換算',
      differenceYen: actualFareYen - caseRecord.gpsComparisonFareYen,
    }
  }

  if ((meterMode === 'gps' || meterMode === 'obd') && caseRecord.timeComparisonFareYen != null) {
    return {
      comparisonFareYen: caseRecord.timeComparisonFareYen,
      comparisonLabel: '時間M換算',
      differenceYen: actualFareYen - caseRecord.timeComparisonFareYen,
    }
  }

  return null
}

export function formatComparisonDifferenceYen(differenceYen: number) {
  if (differenceYen === 0) {
    return '±0円'
  }

  const prefix = differenceYen > 0 ? '+' : '-'
  return `${prefix}${formatFareYen(Math.abs(differenceYen))}円`
}

export type ReceiptFareLine = {
  label: string
  value: string
  amountYen?: number
  indent?: boolean
}

export const isPreFixedFarePassengerChangeCase = (caseRecord: StoredCaseRecord) =>
  isPreFixedFarePassengerChangeCompletion({
    fixedFareCompletionStatus: caseRecord.status,
    fixedFareCompletionReason: caseRecord.completionReason,
    preFixedFareException: caseRecord.preFixedFareException,
  })

export const getPreFixedFarePassengerChangeDisplayLabel = () =>
  PRE_FIXED_FARE_PASSENGER_CHANGE_PANEL_TITLE

export function createPrimaryFareReceiptLines(
  caseRecord: StoredCaseRecord,
): ReceiptFareLine[] {
  if (caseRecord.meterMode === 'fixed') {
    const originalFareYen =
      typeof caseRecord.confirmedFareYen === 'number' && Number.isFinite(caseRecord.confirmedFareYen)
        ? caseRecord.confirmedFareYen
        : caseRecord.preFixedFareException?.originalFixedFareYen ??
          (caseRecord.normalFareYen > 0
            ? caseRecord.normalFareYen
            : caseRecord.basicFareYen)
    const additionalRouteFareYen = Math.max(
      Math.round(caseRecord.additionalRouteFareYen ?? 0),
      0,
    )
    const additionalCareFareYen = Math.max(
      Math.round(caseRecord.additionalCareFareYen ?? 0),
      0,
    )
    const isPassengerChange = isPreFixedFarePassengerChangeCase(caseRecord)
    const hasRouteChangeExtras =
      additionalRouteFareYen > 0 ||
      additionalCareFareYen > 0 ||
      (caseRecord.routeChangeLogs?.length ?? 0) > 0

    if (!hasRouteChangeExtras) {
      return [
        {
          label: isPassengerChange
            ? '事前確定運賃：旅客都合変更により終了'
            : '事前確定運賃',
          value: `${formatFareYen(originalFareYen)}円`,
          amountYen: originalFareYen,
        },
      ]
    }

    return [
      {
        label: isPassengerChange
          ? '元の事前確定運賃：旅客都合変更により終了'
          : '元の事前確定運賃',
        value: `${formatFareYen(originalFareYen)}円`,
        amountYen: originalFareYen,
      },
      {
        label: '追加区間運賃',
        value: `${formatFareYen(additionalRouteFareYen)}円`,
        amountYen: additionalRouteFareYen,
      },
      {
        label: '追加介助料',
        value: `${formatFareYen(additionalCareFareYen)}円`,
        amountYen: additionalCareFareYen,
      },
    ]
  }

  if (caseRecord.meterMode === 'time') {
    const timeFareYen =
      caseRecord.normalFareYen > 0
        ? caseRecord.normalFareYen
        : caseRecord.actualTimeFare > 0
          ? caseRecord.actualTimeFare
          : caseRecord.basicFareYen

    const lines: ReceiptFareLine[] = [
      {
        label: '時間制運賃',
        value: `${formatFareYen(timeFareYen)}円`,
      },
    ]

    if (caseRecord.nightSurchargeYen > 0) {
      lines.push({
        label: '深夜早朝割増',
        value: `${formatFareYen(caseRecord.nightSurchargeYen)}円`,
      })
    }

    return lines
  }

  const basicFareYen =
    caseRecord.normalFareYen > 0 ? caseRecord.normalFareYen : caseRecord.basicFareYen
  const lines: ReceiptFareLine[] = [
    {
      label: '運賃',
      value: `${formatFareYen(basicFareYen)}円`,
    },
  ]

  if (caseRecord.nightSurchargeYen > 0) {
    lines.push({
      label: '深夜早朝割増',
      value: `${formatFareYen(caseRecord.nightSurchargeYen)}円`,
    })
  }

  return lines
}

export const isCanceledCaseRecord = (caseRecord: StoredCaseRecord) =>
  caseRecord.status === 'canceled'

export const getBillableCaseRecords = (caseRecords: StoredCaseRecord[]) =>
  caseRecords.filter((caseRecord) => !isCanceledCaseRecord(caseRecord) && !caseRecord.deleted)

const japaneseDateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
})

const todayKeyFormatter = new Intl.DateTimeFormat('sv-SE', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
})

export function formatCaseDateTime(closedAt: string) {
  const closedDate = new Date(closedAt)

  if (Number.isNaN(closedDate.getTime())) {
    return '日時未記録'
  }

  return japaneseDateTimeFormatter.format(closedDate)
}

export function formatCaseOperationDateTime(isoString: string): string {
  if (!isoString.trim()) {
    return '―'
  }

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return '―'
  }

  const parts = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''
  const second = parts.find((part) => part.type === 'second')?.value ?? ''

  return `${year}/${month}/${day} ${hour}:${minute}:${second}`
}

export function isTodayInJapan(closedAt: string) {
  const closedDate = new Date(closedAt)

  if (Number.isNaN(closedDate.getTime())) {
    return false
  }

  return todayKeyFormatter.format(closedDate) === todayKeyFormatter.format(new Date())
}

export function calculateTodayCaseSummary(caseRecords: StoredCaseRecord[]) {
  const todaysCaseRecords = getBillableCaseRecords(caseRecords).filter((caseRecord) =>
    isTodayInJapan(caseRecord.closedAt),
  )

  return {
    count: todaysCaseRecords.length,
    salesYen: todaysCaseRecords.reduce(
      (total, caseRecord) => total + toSalesYen(getActualFareYen(caseRecord)),
      0,
    ),
  }
}

export type PaymentMethodSalesSummary = {
  count: number
  paymentMethod: string
  salesYen: number
}

export type DailySalesSummary = {
  dateLabel: string
  salesYen: number
} | null

export type MonthlySalesSummary = {
  averageYen: number
  count: number
  monthLabel: string
  salesYen: number
}

export type SalesSummary = {
  bestSalesDay: DailySalesSummary
  monthlySummary: MonthlySalesSummary[]
  paymentMethodSummary: PaymentMethodSalesSummary[]
  thisMonthAverageYen: number
  thisMonthCount: number
  thisMonthSalesYen: number
  todayAverageYen: number
  todayCount: number
  todaySalesYen: number
  totalCount: number
  totalSalesYen: number
}

const displayDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
})

const displayMonthFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
})

const calculateAverageYen = (salesYen: number, count: number) =>
  count > 0 ? Math.round(salesYen / count) : 0

const toValidClosedDate = (closedAt: string) => {
  const closedDate = new Date(closedAt)
  return Number.isNaN(closedDate.getTime()) ? null : closedDate
}

const toSalesYen = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const toPaymentMethodLabel = (paymentMethod: unknown) =>
  typeof paymentMethod === 'string' && paymentMethod.trim()
    ? paymentMethod.trim()
    : '未設定'

function getRecentMonthLabels(monthCount: number, date = new Date()) {
  const { month, year } = getDatePartsInJapan(date)

  return Array.from({ length: monthCount }, (_, index) => {
    const targetDate = new Date(Date.UTC(year, month - 1 - (monthCount - 1 - index), 1))
    return displayMonthFormatter.format(targetDate)
  })
}

export function calculateSalesSummary(
  caseRecords: StoredCaseRecord[],
  date = new Date(),
): SalesSummary {
  const todayRange = getTodayRangeInJapan(date)
  const monthRange = getMonthRangeInJapan(date)
  const billableCaseRecords = getBillableCaseRecords(caseRecords)
  const todayRecords = billableCaseRecords.filter((caseRecord) => {
    const closedDate = toValidClosedDate(caseRecord.closedAt)
    return (
      closedDate &&
      caseRecord.closedAt >= todayRange.startIso &&
      caseRecord.closedAt < todayRange.endIso
    )
  })
  const thisMonthRecords = billableCaseRecords.filter((caseRecord) => {
    const closedDate = toValidClosedDate(caseRecord.closedAt)
    return (
      closedDate &&
      caseRecord.closedAt >= monthRange.startIso &&
      caseRecord.closedAt < monthRange.endIso
    )
  })
  const totalSalesYen = billableCaseRecords.reduce(
    (total, caseRecord) => total + toSalesYen(getActualFareYen(caseRecord)),
    0,
  )
  const todaySalesYen = todayRecords.reduce(
    (total, caseRecord) => total + toSalesYen(getActualFareYen(caseRecord)),
    0,
  )
  const thisMonthSalesYen = thisMonthRecords.reduce(
    (total, caseRecord) => total + toSalesYen(getActualFareYen(caseRecord)),
    0,
  )
  const paymentMethodMap = new Map<string, { count: number; salesYen: number }>()
  const dailySalesMap = new Map<string, number>()
  const monthlySalesMap = new Map<string, { count: number; salesYen: number }>()

  billableCaseRecords.forEach((caseRecord) => {
    const paymentMethod = toPaymentMethodLabel(caseRecord.paymentMethod)
    const currentPaymentSummary = paymentMethodMap.get(paymentMethod) ?? {
      count: 0,
      salesYen: 0,
    }
    paymentMethodMap.set(paymentMethod, {
      count: currentPaymentSummary.count + 1,
      salesYen: currentPaymentSummary.salesYen + toSalesYen(getActualFareYen(caseRecord)),
    })

    const closedDate = toValidClosedDate(caseRecord.closedAt)
    if (!closedDate) {
      return
    }

    const dateLabel = displayDateFormatter.format(closedDate)
    dailySalesMap.set(
      dateLabel,
      (dailySalesMap.get(dateLabel) ?? 0) + toSalesYen(getActualFareYen(caseRecord)),
    )

    const monthLabel = displayMonthFormatter.format(closedDate)
    const currentMonthSummary = monthlySalesMap.get(monthLabel) ?? {
      count: 0,
      salesYen: 0,
    }
    monthlySalesMap.set(monthLabel, {
      count: currentMonthSummary.count + 1,
      salesYen: currentMonthSummary.salesYen + toSalesYen(getActualFareYen(caseRecord)),
    })
  })

  const bestSalesDay = [...dailySalesMap.entries()].reduce<DailySalesSummary>(
    (bestDay, [dateLabel, salesYen]) => {
      if (!bestDay || salesYen > bestDay.salesYen) {
        return { dateLabel, salesYen }
      }

      if (salesYen === bestDay.salesYen && dateLabel > bestDay.dateLabel) {
        return { dateLabel, salesYen }
      }

      return bestDay
    },
    null,
  )
  const recentMonthLabels = getRecentMonthLabels(6, date)
  const additionalMonthLabels = [...monthlySalesMap.keys()].filter(
    (monthLabel) => !recentMonthLabels.includes(monthLabel),
  )
  const monthlySummary = [...additionalMonthLabels, ...recentMonthLabels]
    .sort()
    .map((monthLabel) => {
      const monthSummary = monthlySalesMap.get(monthLabel) ?? {
        count: 0,
        salesYen: 0,
      }

      return {
        averageYen: calculateAverageYen(monthSummary.salesYen, monthSummary.count),
        count: monthSummary.count,
        monthLabel,
        salesYen: monthSummary.salesYen,
      }
    })

  return {
    bestSalesDay,
    monthlySummary,
    paymentMethodSummary: [...paymentMethodMap.entries()]
      .map(([paymentMethod, summary]) => ({
        paymentMethod,
        ...summary,
      }))
      .sort((firstSummary, secondSummary) => {
        if (secondSummary.salesYen !== firstSummary.salesYen) {
          return secondSummary.salesYen - firstSummary.salesYen
        }

        return firstSummary.paymentMethod.localeCompare(secondSummary.paymentMethod, 'ja')
      }),
    thisMonthAverageYen: calculateAverageYen(
      thisMonthSalesYen,
      thisMonthRecords.length,
    ),
    thisMonthCount: thisMonthRecords.length,
    thisMonthSalesYen,
    todayAverageYen: calculateAverageYen(todaySalesYen, todayRecords.length),
    todayCount: todayRecords.length,
    todaySalesYen,
    totalCount: billableCaseRecords.length,
    totalSalesYen,
  }
}
