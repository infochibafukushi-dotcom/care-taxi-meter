import type { TimeMeterLegalSettings } from './meterSettings'

export type TimeMeterDiscountRates = {
  initialFareYen: number
  additionalFareYen: number
}

export function calculateTimeMeterDiscountRates(
  legalSettings: TimeMeterLegalSettings,
  initialMinutes: number,
  additionalSeconds: number,
): TimeMeterDiscountRates {
  const { baseFareYen, baseMinutes } = legalSettings

  if (baseMinutes <= 0) {
    return { initialFareYen: 0, additionalFareYen: 0 }
  }

  const ratePerMinute = baseFareYen / baseMinutes

  return {
    initialFareYen: Math.floor(ratePerMinute * initialMinutes),
    additionalFareYen: Math.floor(ratePerMinute * (additionalSeconds / 60)),
  }
}
