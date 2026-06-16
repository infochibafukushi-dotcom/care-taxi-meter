import type {
  TimeMeterDiscountSettings,
  TimeMeterLegalSettings,
} from './meterSettings'
import { calculateTimeMeterDiscountRates } from './timeMeterDiscount'

export type TimeMeterFareResult = {
  actualTimeFare: number
  legalTimeFare: number
  timeDiscountAmount: number
  timeDiscountEnabled: boolean
  initialMinutes: number
  additionalSeconds: number
}

export type TimeMeterFareIncreaseProgress = {
  elapsedSeconds: number
  label: '初回時間まで' | '時間加算まで'
  progressRate: number
  remainingSeconds: number
  unitSeconds: number
}

function calculateUnitIncreaseProgress(
  elapsedSeconds: number,
  unitSeconds: number,
): Pick<
  TimeMeterFareIncreaseProgress,
  'elapsedSeconds' | 'progressRate' | 'remainingSeconds' | 'unitSeconds'
> {
  if (elapsedSeconds <= 0 || unitSeconds <= 0) {
    return {
      elapsedSeconds: 0,
      progressRate: 0,
      remainingSeconds: unitSeconds,
      unitSeconds,
    }
  }

  const secondsIntoCurrentUnit = elapsedSeconds % unitSeconds
  const remainingSeconds =
    secondsIntoCurrentUnit === 0
      ? unitSeconds
      : unitSeconds - secondsIntoCurrentUnit

  return {
    elapsedSeconds: secondsIntoCurrentUnit,
    progressRate: Math.min(secondsIntoCurrentUnit / unitSeconds, 1),
    remainingSeconds,
    unitSeconds,
  }
}

export function calculateTimeMeterFareIncreaseProgress(
  elapsedSeconds: number,
  discountSettings: TimeMeterDiscountSettings,
  legalSettings: TimeMeterLegalSettings,
): TimeMeterFareIncreaseProgress {
  const initialThresholdSeconds = discountSettings.enabled
    ? discountSettings.initialMinutes * 60
    : legalSettings.baseMinutes * 60
  const additionalUnitSeconds = discountSettings.enabled
    ? discountSettings.additionalSeconds
    : legalSettings.additionalMinutes * 60

  if (elapsedSeconds <= initialThresholdSeconds) {
    const elapsedIntoInitial = Math.max(elapsedSeconds, 0)
    const remainingSeconds = Math.max(initialThresholdSeconds - elapsedIntoInitial, 0)

    return {
      elapsedSeconds: elapsedIntoInitial,
      label: '初回時間まで',
      progressRate:
        initialThresholdSeconds > 0
          ? Math.min(elapsedIntoInitial / initialThresholdSeconds, 1)
          : 0,
      remainingSeconds,
      unitSeconds: initialThresholdSeconds,
    }
  }

  const secondsAfterInitial = elapsedSeconds - initialThresholdSeconds

  return {
    label: '時間加算まで',
    ...calculateUnitIncreaseProgress(secondsAfterInitial, additionalUnitSeconds),
  }
}

export function formatTimeMeterFareIncreaseProgressLabel(
  progress: TimeMeterFareIncreaseProgress,
) {
  const formatDuration = (totalSeconds: number) => {
    const normalizedSeconds = Math.max(Math.floor(totalSeconds), 0)

    if (normalizedSeconds >= 60) {
      return `${Math.floor(normalizedSeconds / 60)}分 ${normalizedSeconds % 60}秒`
    }

    return `${normalizedSeconds}秒`
  }

  return `${formatDuration(progress.elapsedSeconds)} / ${formatDuration(progress.unitSeconds)}`
}

export function calculateLegalTimeFareYen(
  elapsedSeconds: number,
  legalSettings: TimeMeterLegalSettings,
): number {
  const { baseFareYen, baseMinutes, additionalMinutes, additionalFareYen } =
    legalSettings

  if (elapsedSeconds <= 0) {
    return 0
  }

  const elapsedMinutes = elapsedSeconds / 60
  const additionalBlocks =
    additionalMinutes > 0
      ? Math.ceil(Math.max(0, elapsedMinutes - baseMinutes) / additionalMinutes)
      : 0

  return baseFareYen + additionalBlocks * additionalFareYen
}

function calculateActualTimeFareYen({
  elapsedSeconds,
  discountSettings,
  legalSettings,
}: {
  elapsedSeconds: number
  discountSettings: TimeMeterDiscountSettings
  legalSettings: TimeMeterLegalSettings
}): number {
  if (!discountSettings.enabled) {
    return calculateLegalTimeFareYen(elapsedSeconds, legalSettings)
  }

  const { initialMinutes, additionalSeconds } = discountSettings
  const { initialFareYen, additionalFareYen } = calculateTimeMeterDiscountRates(
    legalSettings,
    initialMinutes,
    additionalSeconds,
  )
  const initialThresholdSeconds = initialMinutes * 60

  if (elapsedSeconds <= initialThresholdSeconds) {
    return initialFareYen
  }

  const additionalBlocks = Math.ceil(
    (elapsedSeconds - initialThresholdSeconds) / additionalSeconds,
  )

  return initialFareYen + additionalBlocks * additionalFareYen
}

export function calculateTimeMeterFare({
  elapsedSeconds,
  discountSettings,
  legalSettings,
}: {
  elapsedSeconds: number
  discountSettings: TimeMeterDiscountSettings
  legalSettings: TimeMeterLegalSettings
}): TimeMeterFareResult {
  const legalTimeFare = calculateLegalTimeFareYen(elapsedSeconds, legalSettings)
  const actualTimeFare = calculateActualTimeFareYen({
    elapsedSeconds,
    discountSettings,
    legalSettings,
  })
  const timeDiscountAmount = discountSettings.enabled
    ? Math.max(0, legalTimeFare - actualTimeFare)
    : 0

  return {
    actualTimeFare,
    legalTimeFare,
    timeDiscountAmount,
    timeDiscountEnabled: discountSettings.enabled,
    initialMinutes: discountSettings.initialMinutes,
    additionalSeconds: discountSettings.additionalSeconds,
  }
}
