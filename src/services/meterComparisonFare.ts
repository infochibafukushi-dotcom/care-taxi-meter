import type { ExpenseItem, SelectedCareOption, TaxiTicket } from '../types/case'
import { calculateFareBreakdown } from './fare'
import type { MeterSettings } from './meterSettings'
import { selectMeterModeSettings } from './meterSettings'

export type MeterComparisonFareInput = {
  careOptions: SelectedCareOption[]
  dispatchCharges: SelectedCareOption[]
  distanceKm: number
  drivingSeconds: number
  escortSeconds: number
  expenses: ExpenseItem[]
  isDisabilityDiscount: boolean
  lowSpeedSeconds: number
  meterSettings: MeterSettings
  specialVehicleCharges: SelectedCareOption[]
  taxiTickets: TaxiTicket[]
  waitingSeconds: number
}

export type MeterComparisonFareResult = {
  gpsComparisonFareYen: number
  obdComparisonFareYen: null
  timeComparisonFareYen: number
}

export function calculateMeterComparisonFares(
  input: MeterComparisonFareInput,
): MeterComparisonFareResult {
  const gpsSettings = selectMeterModeSettings(input.meterSettings, 'gps')
  const timeSettings = selectMeterModeSettings(input.meterSettings, 'time')

  const common = {
    careOptions: input.careOptions,
    dispatchCharges: input.dispatchCharges,
    distanceKm: input.distanceKm,
    drivingSeconds: input.drivingSeconds,
    escortSeconds: input.escortSeconds,
    expenses: input.expenses,
    isDisabilityDiscount: input.isDisabilityDiscount,
    specialVehicleCharges: input.specialVehicleCharges,
    taxiTickets: input.taxiTickets,
    waitingSeconds: input.waitingSeconds,
  }

  const gpsBreakdown = calculateFareBreakdown({
    ...common,
    meterMode: 'gps',
    meterTimeSeconds: input.lowSpeedSeconds,
    settings: {
      basicFare: gpsSettings.basicFare,
      discount: gpsSettings.discount,
      escortFare: gpsSettings.escortFare,
      meterTimeFare: gpsSettings.meterTimeFare,
      waitingFare: gpsSettings.waitingFare,
    },
  })

  const timeBreakdown = calculateFareBreakdown({
    ...common,
    meterMode: 'time',
    meterTimeSeconds: 0,
    settings: {
      discount: timeSettings.discount,
      escortFare: timeSettings.escortFare,
      waitingFare: timeSettings.waitingFare,
    },
    timeMeterSettings: input.meterSettings.time,
  })

  return {
    gpsComparisonFareYen: gpsBreakdown.totalFareYen,
    obdComparisonFareYen: null,
    timeComparisonFareYen: timeBreakdown.totalFareYen,
  }
}
