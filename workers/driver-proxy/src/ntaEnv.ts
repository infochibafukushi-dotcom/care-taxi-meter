/** Asia/Tokyo の当日 YYYY-MM-DD */
export const getTodayYmdInJapan = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

/** Resolve NTA application ID from secrets (prefer NTA_APPLICATION_ID). Never log the value. */
export const resolveNtaApplicationId = (env: {
  NTA_APPLICATION_ID?: string
  NTA_INVOICE_API_ID?: string
}): string =>
  (env.NTA_APPLICATION_ID ?? '').trim() || (env.NTA_INVOICE_API_ID ?? '').trim()
