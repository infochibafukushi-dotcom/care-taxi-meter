import { describe, expect, it } from 'vitest'
import {
  isSpecialVehicleEligibleFromVehicle,
  isSpecialVehicleEligibleFromVehicleType,
} from './services/specialVehicleEligibility'

describe('isSpecialVehicleEligibleFromVehicle', () => {
  it('returns true for standard vehicleType 1BOX', () => {
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: '1BOX' })).toBe(true)
  })

  it('returns true for 大型1BOXリフト車 style labels', () => {
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: '大型1BOXリフト車' })).toBe(true)
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: '1BOXリフト車両' })).toBe(true)
  })

  it('returns false for unrelated vehicle types', () => {
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: 'ミニバン' })).toBe(false)
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: '乗用車' })).toBe(false)
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: '福祉車両' })).toBe(false)
  })

  it('returns false when vehicle is missing or type is empty', () => {
    expect(isSpecialVehicleEligibleFromVehicle(null)).toBe(false)
    expect(isSpecialVehicleEligibleFromVehicle(undefined)).toBe(false)
    expect(isSpecialVehicleEligibleFromVehicle({ vehicleType: '' })).toBe(false)
    expect(isSpecialVehicleEligibleFromVehicleType(undefined)).toBe(false)
  })
})
