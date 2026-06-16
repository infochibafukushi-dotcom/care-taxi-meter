export function getDatePartsInJapan(date: Date) {
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

export function createJapanStartOfDayIsoFromDateParts(
  year: number,
  month: number,
  day: number,
) {
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0)).toISOString()
}

export function getTodayRangeInJapan(date = new Date()) {
  const { day, month, year } = getDatePartsInJapan(date)

  return {
    endIso: createJapanStartOfDayIsoFromDateParts(year, month, day + 1),
    startIso: createJapanStartOfDayIsoFromDateParts(year, month, day),
  }
}

export function getMonthRangeInJapan(date = new Date()) {
  const { month, year } = getDatePartsInJapan(date)

  return {
    endIso: createJapanStartOfDayIsoFromDateParts(year, month + 1, 1),
    startIso: createJapanStartOfDayIsoFromDateParts(year, month, 1),
  }
}
