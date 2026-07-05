
export type ReviewDemoMeterRunStatus = 'not_started' | 'in_progress' | 'completed'

export type ReviewDemoRunState = {
  meterRunStatus: ReviewDemoMeterRunStatus
}

export const reviewDemoRunStateStorageKey = 'careTaxiMeterReviewDemoRunState'

export const readReviewDemoRunState = (): ReviewDemoRunState => {
  try {
    const stored = sessionStorage.getItem(reviewDemoRunStateStorageKey)
    if (!stored) {
      return { meterRunStatus: 'not_started' }
    }

    const parsed = JSON.parse(stored) as Partial<ReviewDemoRunState>
    if (
      parsed.meterRunStatus === 'in_progress' ||
      parsed.meterRunStatus === 'completed' ||
      parsed.meterRunStatus === 'not_started'
    ) {
      return { meterRunStatus: parsed.meterRunStatus }
    }
  } catch {
    // ignore
  }

  return { meterRunStatus: 'not_started' }
}

export const writeReviewDemoRunState = (state: ReviewDemoRunState) => {
  sessionStorage.setItem(reviewDemoRunStateStorageKey, JSON.stringify(state))
}

export const resetReviewDemoRunState = () => {
  writeReviewDemoRunState({ meterRunStatus: 'not_started' })
}

export const markReviewDemoRunInProgress = () => {
  writeReviewDemoRunState({ meterRunStatus: 'in_progress' })
}

export const markReviewDemoRunCompleted = () => {
  writeReviewDemoRunState({ meterRunStatus: 'completed' })
}
