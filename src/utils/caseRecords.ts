import type { StoredCaseRecord } from '../services/caseRecords'

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

export function isTodayInJapan(closedAt: string) {
  const closedDate = new Date(closedAt)

  if (Number.isNaN(closedDate.getTime())) {
    return false
  }

  return todayKeyFormatter.format(closedDate) === todayKeyFormatter.format(new Date())
}

export function calculateTodayCaseSummary(caseRecords: StoredCaseRecord[]) {
  const todaysCaseRecords = caseRecords.filter((caseRecord) =>
    isTodayInJapan(caseRecord.closedAt),
  )

  return {
    count: todaysCaseRecords.length,
    salesYen: todaysCaseRecords.reduce(
      (total, caseRecord) => total + toSalesYen(caseRecord.totalFareYen),
      0,
    ),
  }
}

function getDatePartsInJapan(date: Date) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  }).formatToParts(date)

  return {
    day: Number(parts.find((part) => part.type === 'day')?.value ?? 1),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? 1),
    year: Number(parts.find((part) => part.type === 'year')?.value ?? 1970),
  }
}

function createJapanStartOfDayIso(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0)).toISOString()
}

export function getTodayRangeInJapan(date = new Date()) {
  const { day, month, year } = getDatePartsInJapan(date)

  return {
    endIso: createJapanStartOfDayIso(year, month, day + 1),
    startIso: createJapanStartOfDayIso(year, month, day),
  }
}

export function getMonthRangeInJapan(date = new Date()) {
  const { month, year } = getDatePartsInJapan(date)

  return {
    endIso: createJapanStartOfDayIso(year, month + 1, 1),
    startIso: createJapanStartOfDayIso(year, month, 1),
  }
}

export function calculateCaseSummary(caseRecords: StoredCaseRecord[]) {
  return {
    count: caseRecords.length,
    salesYen: caseRecords.reduce(
      (total, caseRecord) => total + toSalesYen(caseRecord.totalFareYen),
      0,
    ),
  }
}

export function calculateMonthCaseSummary(caseRecords: StoredCaseRecord[]) {
  const { endIso, startIso } = getMonthRangeInJapan()
  const monthlyCaseRecords = caseRecords.filter(
    (caseRecord) =>
      caseRecord.closedAt >= startIso && caseRecord.closedAt < endIso,
  )

  return calculateCaseSummary(monthlyCaseRecords)
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
  const todayRecords = caseRecords.filter((caseRecord) => {
    const closedDate = toValidClosedDate(caseRecord.closedAt)
    return (
      closedDate &&
      caseRecord.closedAt >= todayRange.startIso &&
      caseRecord.closedAt < todayRange.endIso
    )
  })
  const thisMonthRecords = caseRecords.filter((caseRecord) => {
    const closedDate = toValidClosedDate(caseRecord.closedAt)
    return (
      closedDate &&
      caseRecord.closedAt >= monthRange.startIso &&
      caseRecord.closedAt < monthRange.endIso
    )
  })
  const totalSalesYen = caseRecords.reduce(
    (total, caseRecord) => total + toSalesYen(caseRecord.totalFareYen),
    0,
  )
  const todaySalesYen = todayRecords.reduce(
    (total, caseRecord) => total + toSalesYen(caseRecord.totalFareYen),
    0,
  )
  const thisMonthSalesYen = thisMonthRecords.reduce(
    (total, caseRecord) => total + toSalesYen(caseRecord.totalFareYen),
    0,
  )
  const paymentMethodMap = new Map<string, { count: number; salesYen: number }>()
  const dailySalesMap = new Map<string, number>()
  const monthlySalesMap = new Map<string, { count: number; salesYen: number }>()

  caseRecords.forEach((caseRecord) => {
    const paymentMethod = toPaymentMethodLabel(caseRecord.paymentMethod)
    const currentPaymentSummary = paymentMethodMap.get(paymentMethod) ?? {
      count: 0,
      salesYen: 0,
    }
    paymentMethodMap.set(paymentMethod, {
      count: currentPaymentSummary.count + 1,
      salesYen: currentPaymentSummary.salesYen + toSalesYen(caseRecord.totalFareYen),
    })

    const closedDate = toValidClosedDate(caseRecord.closedAt)
    if (!closedDate) {
      return
    }

    const dateLabel = displayDateFormatter.format(closedDate)
    dailySalesMap.set(
      dateLabel,
      (dailySalesMap.get(dateLabel) ?? 0) + toSalesYen(caseRecord.totalFareYen),
    )

    const monthLabel = displayMonthFormatter.format(closedDate)
    const currentMonthSummary = monthlySalesMap.get(monthLabel) ?? {
      count: 0,
      salesYen: 0,
    }
    monthlySalesMap.set(monthLabel, {
      count: currentMonthSummary.count + 1,
      salesYen: currentMonthSummary.salesYen + toSalesYen(caseRecord.totalFareYen),
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
    totalCount: caseRecords.length,
    totalSalesYen,
  }
}
