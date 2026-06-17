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

export const getWorkSessionRestSeconds = (workSession: unknown) =>
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
  workSession?: unknown
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

export const calculateCaseOperatingSeconds = ({
  startedAt,
  closedAt,
  nowMs = Date.now(),
}: {
  startedAt: string | null | undefined
  closedAt?: string | null
  nowMs?: number
}) => {
  if (!startedAt) {
    return 0
  }

  const startTime = new Date(startedAt).getTime()

  if (Number.isNaN(startTime)) {
    return 0
  }

  const endTime = closedAt ? new Date(closedAt).getTime() : nowMs

  if (Number.isNaN(endTime)) {
    return 0
  }

  return Math.max(Math.floor((endTime - startTime) / 1000), 0)
}

export const calculateTodayOperatingSeconds = ({
  records,
  staffId,
  currentSessionId,
  todayStartIso,
  todayEndIso,
  activeTripStartedAt,
  nowMs = Date.now(),
}: {
  records: Array<{ closedAt: string; startedAt: string; staffId: string; workSessionId: string }>
  staffId: string
  currentSessionId: string
  todayStartIso: string
  todayEndIso: string
  activeTripStartedAt?: string | null
  nowMs?: number
}) => {
  const belongsToCurrentStaff = (caseRecord: {
    staffId: string
    workSessionId: string
  }) => {
    if (!staffId) {
      return true
    }

    return currentSessionId
      ? caseRecord.workSessionId === currentSessionId ||
          (!caseRecord.workSessionId && caseRecord.staffId === staffId)
      : caseRecord.staffId === staffId
  }

  const fromRecords = records
    .filter(
      (caseRecord) =>
        belongsToCurrentStaff(caseRecord) &&
        caseRecord.closedAt >= todayStartIso &&
        caseRecord.closedAt < todayEndIso,
    )
    .reduce(
      (total, caseRecord) =>
        total +
        calculateCaseOperatingSeconds({
          startedAt: caseRecord.startedAt,
          closedAt: caseRecord.closedAt,
        }),
      0,
    )

  if (
    !activeTripStartedAt ||
    activeTripStartedAt < todayStartIso ||
    activeTripStartedAt >= todayEndIso
  ) {
    return fromRecords
  }

  return (
    fromRecords +
    calculateCaseOperatingSeconds({
      startedAt: activeTripStartedAt,
      nowMs,
    })
  )
}
