type WorkSessionRestSource = {
  restSeconds?: number
  breakSeconds?: number
  breakTimeSeconds?: number
}

const getOptionalNumber = (source: unknown, keys: string[]) => {
  if (!source || typeof source !== 'object') {
    return 0
  }

  const values = source as Record<string, unknown>
  const matchedValue = keys.map((key) => values[key]).find(
    (value) => typeof value === 'number' && Number.isFinite(value),
  )

  return typeof matchedValue === 'number' ? Math.max(Math.floor(matchedValue), 0) : 0
}

export const getWorkSessionRestSeconds = (workSession: WorkSessionRestSource | null | undefined) =>
  getOptionalNumber(workSession, ['restSeconds', 'breakSeconds', 'breakTimeSeconds'])

export const calculateAutoBreakSeconds = (boundSeconds: number) => {
  const safeBoundSeconds = Math.max(Math.floor(boundSeconds), 0)

  if (safeBoundSeconds <= 6 * 3600) {
    return 0
  }

  if (safeBoundSeconds <= 8 * 3600) {
    return 45 * 60
  }

  return 60 * 60
}

export const calculateBoundSeconds = ({
  clockInAt,
  clockOutAt,
  nowMs = Date.now(),
}: {
  clockInAt: string | null | undefined
  clockOutAt?: string | null
  nowMs?: number
}) => {
  if (!clockInAt) {
    return 0
  }

  const clockInTime = new Date(clockInAt).getTime()

  if (Number.isNaN(clockInTime)) {
    return 0
  }

  const endTime = clockOutAt ? new Date(clockOutAt).getTime() : nowMs

  if (Number.isNaN(endTime)) {
    return 0
  }

  return Math.max(Math.floor((endTime - clockInTime) / 1000), 0)
}

export const resolveRestBreak = ({
  boundSeconds,
  workSession,
}: {
  boundSeconds: number
  workSession?: WorkSessionRestSource | null
}) => {
  const actualRestSeconds = getWorkSessionRestSeconds(workSession)

  if (actualRestSeconds > 0) {
    return {
      restLabel: '実休憩',
      restSeconds: actualRestSeconds,
    }
  }

  const autoRestSeconds = calculateAutoBreakSeconds(boundSeconds)

  return {
    restLabel: '自動休憩',
    restSeconds: autoRestSeconds,
  }
}

export const calculateEffectiveWorkSeconds = (boundSeconds: number, restSeconds: number) =>
  Math.max(Math.floor(boundSeconds) - Math.max(Math.floor(restSeconds), 0), 0)
