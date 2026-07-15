import type { CompanyFiscalPolicy, FiscalPeriod } from '../types/accountingFiscalPeriod'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const daysInMonth = (year: number, month: number) => {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30
  }
  return 31
}

const pad2 = (value: number) => String(value).padStart(2, '0')

export const isValidIsoDate = (value: string): boolean => {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  if (month < 1 || month > 12 || day < 1) {
    return false
  }
  return day <= daysInMonth(year, month)
}

const assertValidIsoDate = (value: string, label: string) => {
  if (!isValidIsoDate(value)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

const assertValidFiscalYearEndMonth = (month: number) => {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid fiscalYearEndMonth: ${month}`)
  }
}

const assertValidFiscalYear = (fiscalYear: number) => {
  if (!Number.isInteger(fiscalYear) || !Number.isFinite(fiscalYear)) {
    throw new Error(`Invalid fiscalYear: ${fiscalYear}`)
  }
  if (fiscalYear < 1900 || fiscalYear > 2100) {
    throw new Error(`fiscalYear out of range: ${fiscalYear}`)
  }
}

const assertValidPolicy = (policy: CompanyFiscalPolicy) => {
  assertValidFiscalYearEndMonth(policy.fiscalYearEndMonth)
  assertValidIsoDate(policy.incorporationDate, 'incorporationDate')
}

const toYearMonth = (isoDate: string) => isoDate.slice(0, 7)

const formatLabelDate = (isoDate: string) => {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  const day = Number(isoDate.slice(8, 10))
  return `${year}/${month}/${day}`
}

const buildLabel = (fiscalYear: number, startDate: string, endDate: string) =>
  `${fiscalYear}年度（${formatLabelDate(startDate)}〜${formatLabelDate(endDate)}）`

const lastDayOfMonth = (year: number, month: number) =>
  `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`

const firstDayOfMonth = (year: number, month: number) => `${year}-${pad2(month)}-01`

/** 会計年度キー（開始側年）から、決算月に基づく名目開始・終了日を求める */
const getNominalFiscalBounds = (fiscalYear: number, fiscalYearEndMonth: number) => {
  const startMonth = fiscalYearEndMonth === 12 ? 1 : fiscalYearEndMonth + 1
  const startYear = fiscalYear
  const endYear = startMonth > fiscalYearEndMonth ? fiscalYear + 1 : fiscalYear
  return {
    nominalStartDate: firstDayOfMonth(startYear, startMonth),
    nominalEndDate: lastDayOfMonth(endYear, fiscalYearEndMonth),
  }
}

const countYearMonthsInclusive = (startYearMonth: string, endYearMonth: string) => {
  const startMatch = YEAR_MONTH_PATTERN.exec(startYearMonth)
  const endMatch = YEAR_MONTH_PATTERN.exec(endYearMonth)
  if (!startMatch || !endMatch) {
    return 0
  }

  const startYear = Number(startMatch[1])
  const startMonth = Number(startMatch[2])
  const endYear = Number(endMatch[1])
  const endMonth = Number(endMatch[2])
  if (startYearMonth > endYearMonth) {
    return 0
  }

  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1
}

/**
 * 指定年度の暦の会計期間を組み立てる。
 * 設立日以降に始まる初年度は開始日を設立日にクリップする。
 */
export const buildFiscalPeriod = (
  policy: CompanyFiscalPolicy,
  fiscalYear: number,
): FiscalPeriod => {
  assertValidPolicy(policy)
  assertValidFiscalYear(fiscalYear)

  const { nominalStartDate, nominalEndDate } = getNominalFiscalBounds(
    fiscalYear,
    policy.fiscalYearEndMonth,
  )

  const startDate =
    policy.incorporationDate > nominalStartDate ? policy.incorporationDate : nominalStartDate
  const endDate = nominalEndDate

  if (startDate > endDate) {
    throw new Error(
      `Fiscal period start is after end for fiscalYear ${fiscalYear}: ${startDate} > ${endDate}`,
    )
  }

  const startYearMonth = toYearMonth(startDate)
  const endYearMonth = toYearMonth(endDate)
  const isShortFiscalYear = startDate > nominalStartDate
  const monthCount = countYearMonthsInclusive(startYearMonth, endYearMonth)

  return {
    fiscalYear,
    startDate,
    endDate,
    startYearMonth,
    endYearMonth,
    isShortFiscalYear,
    monthCount,
    label: buildLabel(fiscalYear, startDate, endDate),
  }
}

/**
 * 会社が実在する事業の会計年度期間を返す。
 * 名目年度終了日が設立日より前なら null。
 */
export const getCompanyFiscalPeriod = (
  policy: CompanyFiscalPolicy,
  fiscalYear: number,
): FiscalPeriod | null => {
  assertValidPolicy(policy)

  if (!Number.isInteger(fiscalYear) || !Number.isFinite(fiscalYear)) {
    return null
  }
  if (fiscalYear < 1900 || fiscalYear > 2100) {
    return null
  }

  const { nominalEndDate } = getNominalFiscalBounds(fiscalYear, policy.fiscalYearEndMonth)
  if (nominalEndDate < policy.incorporationDate) {
    return null
  }

  return buildFiscalPeriod(policy, fiscalYear)
}

/** FiscalPeriod に含まれる YYYY-MM 一覧 */
export const getFiscalPeriodMonths = (period: FiscalPeriod): string[] => {
  const months: string[] = []
  let year = Number(period.startYearMonth.slice(0, 4))
  let month = Number(period.startYearMonth.slice(5, 7))
  const endYear = Number(period.endYearMonth.slice(0, 4))
  const endMonth = Number(period.endYearMonth.slice(5, 7))

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${pad2(month)}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return months
}

/** @deprecated 後方互換。getFiscalPeriodMonths を使用 */
export const getFiscalYearMonths = getFiscalPeriodMonths

export const isDateInFiscalPeriod = (date: string, period: FiscalPeriod): boolean => {
  assertValidIsoDate(date, 'date')
  return date >= period.startDate && date <= period.endDate
}

export const getFiscalYearEndYearMonth = (period: FiscalPeriod): string => period.endYearMonth

export const getFiscalYearLabel = (period: FiscalPeriod): string => period.label

/**
 * 日付から属する会計年度キーを返す。
 * 設立前・期間外・不正日付は null。
 */
export const resolveFiscalYearForDate = (
  policy: CompanyFiscalPolicy,
  date: string,
): number | null => {
  assertValidPolicy(policy)
  if (!isValidIsoDate(date)) {
    return null
  }
  if (date < policy.incorporationDate) {
    return null
  }

  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const startMonth =
    policy.fiscalYearEndMonth === 12 ? 1 : policy.fiscalYearEndMonth + 1
  const candidateFiscalYear = month >= startMonth ? year : year - 1

  const period = getCompanyFiscalPeriod(policy, candidateFiscalYear)
  if (!period) {
    return null
  }
  if (date < period.startDate || date > period.endDate) {
    return null
  }

  return period.fiscalYear
}