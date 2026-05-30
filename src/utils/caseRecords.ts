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
