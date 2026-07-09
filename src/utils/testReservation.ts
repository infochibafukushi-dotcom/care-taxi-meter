const testReservationFlagsStorageKey = 'careTaxiMeterTestReservationFlags'

export const resolveReservationIsTest = (input: {
  isTest?: boolean | null
  status?: string | null
}): boolean => Boolean(input.isTest) || input.status === 'test'

export const normalizeNullableString = (value: string | null | undefined): string =>
  typeof value === 'string' ? value : ''

export const cacheTestReservationFlag = (reservationId: string, isTest: boolean) => {
  const normalizedId = reservationId.trim()
  if (!normalizedId || typeof sessionStorage === 'undefined') {
    return
  }

  try {
    const stored = JSON.parse(
      sessionStorage.getItem(testReservationFlagsStorageKey) ?? '{}',
    ) as Record<string, boolean>

    if (isTest) {
      stored[normalizedId] = true
    } else {
      delete stored[normalizedId]
    }

    sessionStorage.setItem(testReservationFlagsStorageKey, JSON.stringify(stored))
  } catch (error) {
    console.warn('Failed to cache test reservation flag.', error)
  }
}

export const readTestReservationFlag = (reservationId: string): boolean => {
  const normalizedId = reservationId.trim()
  if (!normalizedId || typeof sessionStorage === 'undefined') {
    return false
  }

  try {
    const stored = JSON.parse(
      sessionStorage.getItem(testReservationFlagsStorageKey) ?? '{}',
    ) as Record<string, boolean>
    return Boolean(stored[normalizedId])
  } catch (error) {
    console.warn('Failed to read test reservation flag.', error)
    return false
  }
}
