import { describe, expect, it } from 'vitest'
import { defaultMeterSettings } from './services/meterSettings'
import {
  METER_SETTINGS_FETCH_ERROR_MESSAGE,
  METER_SETTINGS_LOADING_MESSAGE,
  canCalculateManualFare,
  canProceedToManualFareSettings,
  formatConfiguredFareLabel,
  isAssistItemConfigured,
  resolveConfiguredAssistAmount,
  resolveManualFlowMeterSettings,
  resolveManualFlowMeterSettingsErrorMessage,
  type StoreMeterSettingsLoadState,
} from './services/preFixedManualMeterSettings'

const readyState = (settings = defaultMeterSettings): StoreMeterSettingsLoadState => ({
  status: 'ready',
  settings,
})

describe('manual flow meter settings gate', () => {
  it('blocks fare settings while loading', () => {
    expect(canProceedToManualFareSettings({ status: 'loading' })).toBe(false)
    expect(canCalculateManualFare({ status: 'loading' })).toBe(false)
    expect(resolveManualFlowMeterSettingsErrorMessage({ status: 'loading' })).toBe(
      METER_SETTINGS_LOADING_MESSAGE,
    )
  })

  it('shows fetch error and retry guidance when acquisition fails', () => {
    const failed: StoreMeterSettingsLoadState = {
      status: 'error',
      message: METER_SETTINGS_FETCH_ERROR_MESSAGE,
    }

    expect(canProceedToManualFareSettings(failed)).toBe(false)
    expect(resolveManualFlowMeterSettingsErrorMessage(failed)).toBe(
      METER_SETTINGS_FETCH_ERROR_MESSAGE,
    )
    expect(resolveManualFlowMeterSettingsErrorMessage({ status: 'missing_scope' })).toBe(
      METER_SETTINGS_FETCH_ERROR_MESSAGE,
    )
  })

  it('does not use defaultMeterSettings in production manual flow', () => {
    expect(resolveManualFlowMeterSettings({ status: 'loading' })).toBeNull()
    expect(resolveManualFlowMeterSettings({ status: 'missing_scope' })).toBeNull()
    expect(
      resolveManualFlowMeterSettings({
        status: 'error',
        message: METER_SETTINGS_FETCH_ERROR_MESSAGE,
      }),
    ).toBeNull()
  })

  it('allows fare calculation after store settings are ready', () => {
    const settings = {
      ...defaultMeterSettings,
      dispatchMenuItems: defaultMeterSettings.dispatchMenuItems.map((item) =>
        item.id === 'reservedPickup' ? { ...item, enabled: true, amount: 900 } : item,
      ),
    }

    expect(canProceedToManualFareSettings(readyState(settings))).toBe(true)
    expect(canCalculateManualFare(readyState(settings))).toBe(true)
    expect(resolveManualFlowMeterSettings(readyState(settings))).toBe(settings)
  })

  it('can resume after a successful reload', () => {
    const loading: StoreMeterSettingsLoadState = { status: 'loading' }
    const failed: StoreMeterSettingsLoadState = {
      status: 'error',
      message: METER_SETTINGS_FETCH_ERROR_MESSAGE,
    }
    const ready = readyState()

    expect(canProceedToManualFareSettings(loading)).toBe(false)
    expect(canProceedToManualFareSettings(failed)).toBe(false)
    expect(canProceedToManualFareSettings(ready)).toBe(true)
  })
})

describe('configured fare labels', () => {
  it('shows unconfigured assist items instead of default amounts', () => {
    const items = defaultMeterSettings.assistItems.map((item) =>
      item.id === 'boardingAssist' ? { ...item, enabled: false } : item,
    )

    expect(isAssistItemConfigured(items, 'boardingAssist')).toBe(false)
    expect(resolveConfiguredAssistAmount(items, 'boardingAssist')).toBeNull()
    expect(formatConfiguredFareLabel(null)).toBe('未設定')
  })
})
