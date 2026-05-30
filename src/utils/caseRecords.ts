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
      (total, caseRecord) => total + caseRecord.totalFareYen,
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
      (total, caseRecord) => total + caseRecord.totalFareYen,
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
