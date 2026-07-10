import {
  CORE_ASSIST_IDS,
  OWN_WHEELCHAIR_ID,
  OWN_WHEELCHAIR_LABEL,
  RENTAL_EQUIPMENT_IDS,
  RENTAL_EQUIPMENT_LABELS,
} from '../constants/preFixedManual'
import type { AssistItem, DispatchMenuItem, SpecialVehicleMenuItem, TimeFareSettings } from './fare'
import { STAIR_FLOOR_OPTIONS } from './fareMasterService'
import type {
  ManualWaitingEscortPlan,
  PreFixedManualFareSelection,
} from '../types/preFixedMeterSession'
import { isSpecialVehicleEligibleFromVehicleType } from './specialVehicleEligibility'

const DEFAULT_DISPATCH_ID = 'reservedPickup'

/** @deprecated {@link isSpecialVehicleEligibleFromVehicleType} を使用 */
export const isSpecialVehicleEligible = isSpecialVehicleEligibleFromVehicleType

export const buildDefaultFareSelection = ({
  dispatchItem,
  specialVehicleItem,
  waitingFare,
  escortFare,
  vehicleEligible,
}: {
  dispatchItem?: DispatchMenuItem
  specialVehicleItem?: SpecialVehicleMenuItem
  waitingFare: TimeFareSettings
  escortFare: TimeFareSettings
  vehicleEligible: boolean
}): PreFixedManualFareSelection => {
  const dispatchEnabled = Boolean(dispatchItem?.enabled)
  const specialEnabled = vehicleEligible && Boolean(specialVehicleItem?.enabled)

  return {
    dispatchEnabled,
    dispatchFareYen: dispatchEnabled ? Math.max(dispatchItem?.amount ?? 0, 0) : 0,
    specialVehicleEnabled: specialEnabled,
    specialVehicleFareYen: specialEnabled ? Math.max(specialVehicleItem?.amount ?? 0, 0) : 0,
    boardingAssist: false,
    boardingAssistFareYen: 0,
    bodyAssist: false,
    bodyAssistFareYen: 0,
    stairsAssist: false,
    stairAssistFareYen: 0,
    equipmentItems: [],
    waitingEscortPlan: 'none',
    waitingFirstUnitYen: 0,
    escortFirstUnitYen: 0,
    waitingUnitSeconds: waitingFare.unitSeconds,
    escortUnitSeconds: escortFare.unitSeconds,
    waitingUnitFareYen: waitingFare.unitFareYen,
    escortUnitFareYen: escortFare.unitFareYen,
  }
}

export const resolveAssistItemAmount = (items: AssistItem[], id: string) =>
  Math.max(items.find((item) => item.id === id)?.amount ?? 0, 0)

export const listOtherEquipmentItems = (assistItems: AssistItem[]) =>
  assistItems.filter(
    (item) =>
      item.enabled &&
      !CORE_ASSIST_IDS.has(item.id) &&
      !RENTAL_EQUIPMENT_IDS.has(item.id) &&
      item.id !== OWN_WHEELCHAIR_ID,
  )

export const listRentalEquipmentItems = (assistItems: AssistItem[]) =>
  [...RENTAL_EQUIPMENT_IDS]
    .map((id) => assistItems.find((item) => item.id === id && item.enabled))
    .filter((item): item is AssistItem => Boolean(item))

export const calculateManualPreFixedTotalYen = ({
  routeFareYen,
  selection,
}: {
  routeFareYen: number
  selection: PreFixedManualFareSelection
}): number => {
  let total = Math.max(routeFareYen, 0)

  if (selection.dispatchEnabled) {
    total += selection.dispatchFareYen
  }
  if (selection.specialVehicleEnabled) {
    total += selection.specialVehicleFareYen
  }
  if (selection.boardingAssist) {
    total += selection.boardingAssistFareYen
  }
  if (selection.bodyAssist) {
    total += selection.bodyAssistFareYen
  }
  if (selection.stairsAssist) {
    total += selection.stairAssistFareYen
  }

  for (const item of selection.equipmentItems) {
    total += Math.max(item.amountYen, 0)
  }

  if (selection.waitingEscortPlan === 'waiting' || selection.waitingEscortPlan === 'both') {
    total += selection.waitingFirstUnitYen
  }
  if (selection.waitingEscortPlan === 'escort' || selection.waitingEscortPlan === 'both') {
    total += selection.escortFirstUnitYen
  }

  return total
}

export const calculateManualPreFixedServiceYen = (selection: PreFixedManualFareSelection): number =>
  calculateManualPreFixedTotalYen({ routeFareYen: 0, selection })

export const applyWaitingEscortPlan = (
  selection: PreFixedManualFareSelection,
  plan: ManualWaitingEscortPlan,
): PreFixedManualFareSelection => {
  const waitingFirstUnitYen =
    plan === 'waiting' || plan === 'both' ? selection.waitingUnitFareYen : 0
  const escortFirstUnitYen = plan === 'escort' || plan === 'both' ? selection.escortUnitFareYen : 0

  return {
    ...selection,
    waitingEscortPlan: plan,
    waitingFirstUnitYen,
    escortFirstUnitYen,
  }
}

export const resolveStairFloorOption = (floorId: string) =>
  STAIR_FLOOR_OPTIONS.find((option) => option.id === floorId)

export const buildServiceFeesFromManualSelection = (
  selection: PreFixedManualFareSelection,
): Array<{ key: string; label: string; amount: number }> => {
  const fees: Array<{ key: string; label: string; amount: number }> = []

  if (selection.dispatchEnabled && selection.dispatchFareYen > 0) {
    fees.push({
      key: DEFAULT_DISPATCH_ID,
      label: '予約迎車',
      amount: selection.dispatchFareYen,
    })
  }

  if (selection.specialVehicleEnabled && selection.specialVehicleFareYen > 0) {
    fees.push({
      key: 'specialVehicleFee',
      label: '特殊車両料金',
      amount: selection.specialVehicleFareYen,
    })
  }

  if (selection.boardingAssist && selection.boardingAssistFareYen > 0) {
    fees.push({
      key: 'boardingAssist',
      label: '乗降介助',
      amount: selection.boardingAssistFareYen,
    })
  }

  if (selection.bodyAssist && selection.bodyAssistFareYen > 0) {
    fees.push({
      key: 'bodyAssist',
      label: '身体介助',
      amount: selection.bodyAssistFareYen,
    })
  }

  if (selection.stairsAssist && selection.stairAssistFareYen > 0) {
    fees.push({
      key: 'stairsAssist',
      label: selection.stairFloorLabel
        ? `階段介助（${selection.stairFloorLabel}）`
        : '階段介助',
      amount: selection.stairAssistFareYen,
    })
  }

  for (const item of selection.equipmentItems) {
    if (item.amountYen <= 0 && item.id !== OWN_WHEELCHAIR_ID) {
      continue
    }
    fees.push({
      key: item.id,
      label: item.name,
      amount: item.amountYen,
    })
  }

  if (selection.waitingEscortPlan === 'waiting' || selection.waitingEscortPlan === 'both') {
    fees.push({
      key: 'waiting30min',
      label: '待機料金（最初の30分）',
      amount: selection.waitingFirstUnitYen,
    })
  }

  if (selection.waitingEscortPlan === 'escort' || selection.waitingEscortPlan === 'both') {
    fees.push({
      key: 'escort30min',
      label: '付添料金（最初の30分）',
      amount: selection.escortFirstUnitYen,
    })
  }

  return fees
}

export const formatWaitingEscortUnitLabel = (unitFareYen: number) =>
  `30分${unitFareYen.toLocaleString('ja-JP')}円～`

export const buildOwnWheelchairItem = () => ({
  id: OWN_WHEELCHAIR_ID,
  name: OWN_WHEELCHAIR_LABEL,
  amountYen: 0,
})

export const rentalEquipmentDisplayName = (id: string, fallbackName: string) =>
  RENTAL_EQUIPMENT_LABELS[id] ?? fallbackName
