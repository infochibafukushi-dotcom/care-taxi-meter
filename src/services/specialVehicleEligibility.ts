import type { Vehicle } from '../types/work'

/**
 * 特殊車両料金の自動ON判定。
 * 車両マスタの vehicleType 文字列から判定する（専用フラグは存在しない）。
 * 判定できない場合は false（手動ONのみ）。
 */
export function isSpecialVehicleEligibleFromVehicle(
  vehicle: Pick<Vehicle, 'vehicleType'> | null | undefined,
): boolean {
  const vehicleType = vehicle?.vehicleType?.trim() ?? ''
  if (!vehicleType) {
    return false
  }

  const compact = vehicleType.replace(/\s+/g, '')
  const upper = compact.toUpperCase()

  if (upper === '1BOX') {
    return true
  }

  if (/1BOX/i.test(compact) && /リフト|LIFT/i.test(compact)) {
    return true
  }

  if (/1BOXリフト|リフト1BOX/i.test(compact)) {
    return true
  }

  if (/大型.*1BOX.*リフト|大型.*リフト.*1BOX/i.test(compact)) {
    return true
  }

  return false
}

export function isSpecialVehicleEligibleFromVehicleType(
  vehicleType: string | undefined,
): boolean {
  if (!vehicleType?.trim()) {
    return false
  }
  return isSpecialVehicleEligibleFromVehicle({ vehicleType })
}
