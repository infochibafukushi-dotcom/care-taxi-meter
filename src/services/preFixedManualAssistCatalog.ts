import {
  CORE_ASSIST_IDS,
  OWN_WHEELCHAIR_ID,
  RENTAL_EQUIPMENT_IDS,
  RENTAL_EQUIPMENT_LABELS,
} from '../constants/preFixedManual'
import type { AssistItem } from './fare'

const ASSIST_ALIAS_TO_CANONICAL: Record<string, string> = {
  boardingAssist: 'boardingAssist',
  bodyAssist: 'bodyAssist',
  stairsAssist: 'stairsAssist',
  stairs: 'stairsAssist',
  standardWheelchair: 'standardWheelchair',
  recliningWheelchair: 'recliningWheelchair',
  recliningAssist: 'recliningWheelchair',
  reclining: 'recliningWheelchair',
  stretcherEquipment: 'stretcherEquipment',
  stretcherAssist: 'stretcherEquipment',
  stretcher: 'stretcherEquipment',
  wheelchairAssist: 'standardWheelchair',
  basicAssist: 'boardingAssist',
  indoorAssist: 'bodyAssist',
}

const CANONICAL_DISPLAY_NAMES: Record<string, string> = {
  boardingAssist: '乗降介助',
  bodyAssist: '身体介助',
  stairsAssist: '階段介助',
  standardWheelchair: '標準車いすレンタル',
  recliningWheelchair: 'リクライニング車いすレンタル',
  stretcherEquipment: 'ストレッチャーレンタル',
}

const normalizeAssistName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/レンタル/g, '')
    .replace(/車いす/g, '車椅子')

export const resolveCanonicalAssistItemId = (item: Pick<AssistItem, 'id' | 'name'>) => {
  const id = item.id.trim()
  if (ASSIST_ALIAS_TO_CANONICAL[id]) {
    return ASSIST_ALIAS_TO_CANONICAL[id]
  }

  const normalizedName = normalizeAssistName(item.name)
  if (normalizedName.includes('乗降介助')) return 'boardingAssist'
  if (normalizedName.includes('身体介助')) return 'bodyAssist'
  if (normalizedName.includes('階段介助')) return 'stairsAssist'
  if (normalizedName.includes('標準') && normalizedName.includes('車')) return 'standardWheelchair'
  if (normalizedName.includes('リクライニング')) return 'recliningWheelchair'
  if (normalizedName.includes('ストレッチャー')) return 'stretcherEquipment'

  return id
}

export const resolveCanonicalAssistDisplayName = (canonicalId: string, fallbackName: string) =>
  CANONICAL_DISPLAY_NAMES[canonicalId] ??
  RENTAL_EQUIPMENT_LABELS[canonicalId] ??
  fallbackName

/**
 * 店舗設定 assistItems を正規化キーで重複排除する。同一項目は1件のみ。
 */
export const dedupeStoreAssistItems = (assistItems: AssistItem[]): AssistItem[] => {
  const byCanonical = new Map<string, AssistItem>()

  for (const item of assistItems) {
    if (!item.id.trim() || !item.name.trim()) {
      continue
    }
    if (item.id === OWN_WHEELCHAIR_ID) {
      continue
    }

    const canonicalId = resolveCanonicalAssistItemId(item)
    const existing = byCanonical.get(canonicalId)
    const normalized: AssistItem = {
      ...item,
      id: canonicalId,
      name: resolveCanonicalAssistDisplayName(canonicalId, item.name),
    }

    if (!existing) {
      byCanonical.set(canonicalId, normalized)
      continue
    }

    // 店舗設定を優先（enabled / amount / sortOrder）
    byCanonical.set(canonicalId, {
      ...existing,
      ...normalized,
      enabled: normalized.enabled || existing.enabled,
      amount: normalized.amount > 0 ? normalized.amount : existing.amount,
      sortOrder: Math.min(existing.sortOrder, normalized.sortOrder),
    })
  }

  return [...byCanonical.values()].sort((a, b) => a.sortOrder - b.sortOrder)
}

export const listManualFlowCoreAssistItems = (assistItems: AssistItem[]) =>
  dedupeStoreAssistItems(assistItems).filter((item) => CORE_ASSIST_IDS.has(item.id))

export const listManualFlowRentalItems = (assistItems: AssistItem[]) =>
  dedupeStoreAssistItems(assistItems).filter(
    (item) => RENTAL_EQUIPMENT_IDS.has(item.id) && item.enabled,
  )

export const listManualFlowOtherEquipmentItems = (assistItems: AssistItem[]) =>
  dedupeStoreAssistItems(assistItems).filter(
    (item) =>
      item.enabled &&
      !CORE_ASSIST_IDS.has(item.id) &&
      !RENTAL_EQUIPMENT_IDS.has(item.id) &&
      item.id !== OWN_WHEELCHAIR_ID,
  )
