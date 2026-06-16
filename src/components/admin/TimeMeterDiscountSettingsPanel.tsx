import { useMemo } from 'react'
import type {
  TimeMeterDiscountSettings,
  TimeMeterLegalSettings,
  TimeMeterSettings,
} from '../../services/meterSettings'
import { calculateTimeMeterDiscountRates } from '../../services/timeMeterDiscount'
import { formatFareYen } from '../../services/fare'

type TimeMeterDiscountSettingsPanelProps = {
  timeSettings: TimeMeterSettings
  onChange: (timeSettings: TimeMeterSettings) => void
}

const updateLegal = (
  legal: TimeMeterLegalSettings,
  key: keyof TimeMeterLegalSettings,
  value: string,
): TimeMeterLegalSettings => ({
  ...legal,
  [key]: Math.max(Number(value) || 0, key.includes('Minutes') ? 1 : 0),
})

const updateDiscount = (
  discount: TimeMeterDiscountSettings,
  key: keyof TimeMeterDiscountSettings,
  value: string | boolean,
): TimeMeterDiscountSettings => {
  if (key === 'enabled') {
    return { ...discount, enabled: Boolean(value) }
  }

  return {
    ...discount,
    [key]: Math.max(Math.floor(Number(value) || 0), 1),
  }
}

export function TimeMeterDiscountSettingsPanel({
  timeSettings,
  onChange,
}: TimeMeterDiscountSettingsPanelProps) {
  const discountRates = useMemo(
    () =>
      calculateTimeMeterDiscountRates(
        timeSettings.legal,
        timeSettings.discount.initialMinutes,
        timeSettings.discount.additionalSeconds,
      ),
    [
      timeSettings.discount.additionalSeconds,
      timeSettings.discount.initialMinutes,
      timeSettings.legal,
    ],
  )

  return (
    <fieldset className="admin-settings-wide">
      <legend>時間制メーター料金設定</legend>

      <div className="admin-settings-grid">
        <label>
          認可初回（分）
          <input
            min="1"
            type="number"
            value={timeSettings.legal.baseMinutes}
            onChange={(event) =>
              onChange({
                ...timeSettings,
                legal: updateLegal(
                  timeSettings.legal,
                  'baseMinutes',
                  event.target.value,
                ),
              })
            }
          />
        </label>
        <label>
          認可初回料金(円)
          <input
            min="0"
            type="number"
            value={timeSettings.legal.baseFareYen}
            onChange={(event) =>
              onChange({
                ...timeSettings,
                legal: updateLegal(
                  timeSettings.legal,
                  'baseFareYen',
                  event.target.value,
                ),
              })
            }
          />
        </label>
        <label>
          認可加算（分）
          <input
            min="1"
            type="number"
            value={timeSettings.legal.additionalMinutes}
            onChange={(event) =>
              onChange({
                ...timeSettings,
                legal: updateLegal(
                  timeSettings.legal,
                  'additionalMinutes',
                  event.target.value,
                ),
              })
            }
          />
        </label>
        <label>
          認可加算料金(円)
          <input
            min="0"
            type="number"
            value={timeSettings.legal.additionalFareYen}
            onChange={(event) =>
              onChange({
                ...timeSettings,
                legal: updateLegal(
                  timeSettings.legal,
                  'additionalFareYen',
                  event.target.value,
                ),
              })
            }
          />
        </label>
      </div>

      <fieldset className="admin-settings-wide">
        <legend>時間割引設定</legend>
        <label className="assist-item-toggle">
          時間割引を利用する
          <input
            type="checkbox"
            checked={timeSettings.discount.enabled}
            onChange={(event) =>
              onChange({
                ...timeSettings,
                discount: updateDiscount(
                  timeSettings.discount,
                  'enabled',
                  event.target.checked,
                ),
              })
            }
          />
        </label>

        {timeSettings.discount.enabled ? (
          <>
            <div className="admin-settings-grid">
              <label>
                初回時間（分）
                <input
                  min="1"
                  type="number"
                  value={timeSettings.discount.initialMinutes}
                  onChange={(event) =>
                    onChange({
                      ...timeSettings,
                      discount: updateDiscount(
                        timeSettings.discount,
                        'initialMinutes',
                        event.target.value,
                      ),
                    })
                  }
                />
              </label>
              <label>
                加算時間（秒）
                <input
                  min="1"
                  type="number"
                  value={timeSettings.discount.additionalSeconds}
                  onChange={(event) =>
                    onChange({
                      ...timeSettings,
                      discount: updateDiscount(
                        timeSettings.discount,
                        'additionalSeconds',
                        event.target.value,
                      ),
                    })
                  }
                />
              </label>
            </div>

            <div className="admin-settings-note">
              <p>
                初回料金（自動計算）{' '}
                <strong>{formatFareYen(discountRates.initialFareYen)}円</strong>
              </p>
              <p>
                {timeSettings.discount.additionalSeconds}秒毎加算（自動計算）{' '}
                <strong>{formatFareYen(discountRates.additionalFareYen)}円</strong>
              </p>
            </div>
          </>
        ) : null}
      </fieldset>
    </fieldset>
  )
}
