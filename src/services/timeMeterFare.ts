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
