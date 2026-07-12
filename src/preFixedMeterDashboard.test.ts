import { describe, expect, it } from 'vitest'
import {
  buildPreFixedMeterRoutePoints,
  filterPositiveFareLines,
  shouldShowPreFixedSettleButton,
} from './components/preFixed/PreFixedMeterDashboard'

describe('buildPreFixedMeterRoutePoints', () => {
  it('builds S → via → G from addresses', () => {
    expect(
      buildPreFixedMeterRoutePoints({
        confirmedRouteView: null,
        pickupAddress: '千葉県千葉市中央区出洲港8-2',
        dropoffAddress: '千葉駅',
        viaAddresses: ['千葉メディカルセンター'],
      }),
    ).toEqual([
      { role: 'S', title: 'S 出発地', address: '千葉県千葉市中央区出洲港8-2' },
      { role: 'via', title: '経由地1', address: '千葉メディカルセンター' },
      { role: 'G', title: 'G 最終目的地', address: '千葉駅' },
    ])
  })

  it('uses confirmed route stops with facility name when label differs', () => {
    const points = buildPreFixedMeterRoutePoints({
      confirmedRouteView: {
        pickupAddress: 'a',
        dropoffAddress: 'c',
        viaAddresses: ['b'],
        stops: [
          { label: '', address: '出発住所', lat: 0, lng: 0 },
          { label: 'クリニック', address: '経由住所', lat: 0, lng: 0 },
          { label: '', address: '到着住所', lat: 0, lng: 0 },
        ],
      } as never,
      pickupAddress: '',
      dropoffAddress: '',
    })

    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({ role: 'S', title: 'S 出発地', address: '出発住所' })
    expect(points[1]).toMatchObject({
      role: 'via',
      title: '経由地1',
      facilityName: 'クリニック',
      address: '経由住所',
    })
    expect(points[2]).toMatchObject({ role: 'G', title: 'G 最終目的地', address: '到着住所' })
  })
})

describe('filterPositiveFareLines', () => {
  it('excludes zero-yen lines from fare confirmation card', () => {
    expect(
      filterPositiveFareLines([
        { label: '事前確定運賃', amountYen: 3320 },
        { label: '待機料金', amountYen: 0 },
        { label: '乗降介助', amountYen: 1100 },
        { label: '実費', amountYen: 0 },
      ]),
    ).toEqual([
      { label: '事前確定運賃', amountYen: 3320 },
      { label: '乗降介助', amountYen: 1100 },
    ])
  })
})

describe('shouldShowPreFixedSettleButton', () => {
  it('keeps 運行開始 when only waiting/escort could end trip without fixedFareRun', () => {
    expect(
      shouldShowPreFixedSettleButton({
        hasFixedFareRun: false,
        canOpenFixedSettlement: false,
        isPassengerChangePreSettlement: false,
      }),
    ).toBe(false)
  })

  it('shows 清算 after fixedFareRun', () => {
    expect(
      shouldShowPreFixedSettleButton({
        hasFixedFareRun: true,
        canOpenFixedSettlement: false,
        isPassengerChangePreSettlement: false,
      }),
    ).toBe(true)
  })

  it('shows 清算 on settlement resume paths', () => {
    expect(
      shouldShowPreFixedSettleButton({
        hasFixedFareRun: false,
        canOpenFixedSettlement: true,
        isPassengerChangePreSettlement: false,
      }),
    ).toBe(true)
  })
})
