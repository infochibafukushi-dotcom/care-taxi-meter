import { describe, expect, it } from 'vitest'
import type { AssistItem } from './services/fare'
import {
  dedupeStoreAssistItems,
  listManualFlowRentalItems,
  resolveCanonicalAssistItemId,
} from './services/preFixedManualAssistCatalog'

const assist = (partial: Partial<AssistItem> & Pick<AssistItem, 'id' | 'name'>): AssistItem => ({
  amount: 1100,
  enabled: true,
  sortOrder: 1,
  ...partial,
})

describe('preFixedManualAssistCatalog dedupe', () => {
  it('shows boarding assist only once when master and store aliases overlap', () => {
    const items = dedupeStoreAssistItems([
      assist({ id: 'boardingAssist', name: '乗降介助', sortOrder: 1 }),
      assist({ id: 'basicAssist', name: '乗降介助', sortOrder: 2 }),
    ])
    const boarding = items.filter((item) => item.id === 'boardingAssist')
    expect(boarding).toHaveLength(1)
    expect(boarding[0]?.name).toBe('乗降介助')
  })

  it('shows body assist only once', () => {
    const items = dedupeStoreAssistItems([
      assist({ id: 'bodyAssist', name: '身体介助' }),
      assist({ id: 'indoorAssist', name: '身体介助' }),
    ])
    expect(items.filter((item) => item.id === 'bodyAssist')).toHaveLength(1)
  })

  it('shows stairs assist only once', () => {
    const items = dedupeStoreAssistItems([
      assist({ id: 'stairsAssist', name: '階段介助' }),
      assist({ id: 'stairs', name: '階段介助' }),
    ])
    expect(items.filter((item) => item.id === 'stairsAssist')).toHaveLength(1)
  })

  it('normalizes reclining wheelchair rental to a single canonical item', () => {
    const rentals = listManualFlowRentalItems([
      assist({ id: 'reclining', name: 'リクライニング', amount: 2200, sortOrder: 3 }),
      assist({ id: 'recliningWheelchair', name: 'リクライニング車いす', amount: 2200, sortOrder: 4 }),
    ])
    expect(rentals.filter((item) => item.id === 'recliningWheelchair')).toHaveLength(1)
    expect(rentals[0]?.name).toBe('リクライニング車いすレンタル')
  })

  it('normalizes stretcher rental to a single canonical item', () => {
    const rentals = listManualFlowRentalItems([
      assist({ id: 'stretcher', name: 'ストレッチャー', amount: 3300 }),
      assist({ id: 'stretcherEquipment', name: 'ストレッチャー', amount: 3300 }),
    ])
    expect(rentals.filter((item) => item.id === 'stretcherEquipment')).toHaveLength(1)
    expect(rentals[0]?.name).toBe('ストレッチャーレンタル')
  })

  it('prefers store settings amount when duplicate canonical ids exist', () => {
    const items = dedupeStoreAssistItems([
      assist({ id: 'boardingAssist', name: '乗降介助', amount: 900, sortOrder: 2 }),
      assist({ id: 'basicAssist', name: '乗降介助', amount: 1100, sortOrder: 1 }),
    ])
    expect(items.find((item) => item.id === 'boardingAssist')?.amount).toBe(1100)
  })
})

describe('resolveCanonicalAssistItemId', () => {
  it('maps reclining aliases to recliningWheelchair', () => {
    expect(resolveCanonicalAssistItemId({ id: 'recliningAssist', name: 'リクライニング' })).toBe(
      'recliningWheelchair',
    )
  })
})
