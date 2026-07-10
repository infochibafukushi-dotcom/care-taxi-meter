/** 利用者所有の車いす（レンタル料金0円） */
export const OWN_WHEELCHAIR_ID = 'ownWheelchair'

export const CORE_ASSIST_IDS = new Set(['boardingAssist', 'bodyAssist', 'stairsAssist'])

export const RENTAL_EQUIPMENT_IDS = new Set([
  'standardWheelchair',
  'recliningWheelchair',
  'stretcherEquipment',
])

export const RENTAL_EQUIPMENT_LABELS: Record<string, string> = {
  standardWheelchair: '標準車いすレンタル',
  recliningWheelchair: 'リクライニング車いすレンタル',
  stretcherEquipment: 'ストレッチャーレンタル',
}

export const OWN_WHEELCHAIR_LABEL = '利用者所有の車いす'
