import { useCallback, useEffect, useState } from 'react'
import {
  METER_SETTINGS_FETCH_ERROR_MESSAGE,
  type StoreMeterSettingsLoadState,
  subscribeStoreMeterSettings,
} from '../services/preFixedManualMeterSettings'
import type { MeterSettings } from '../services/meterSettings'
import type { TenantAccessScope } from '../services/tenancy'

type UseStoreMeterSettingsResult = {
  state: StoreMeterSettingsLoadState
  settings: MeterSettings | null
  retry: () => void
}

export function useStoreMeterSettings(scope: TenantAccessScope): UseStoreMeterSettingsResult {
  const [state, setState] = useState<StoreMeterSettingsLoadState>({ status: 'loading' })
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => {
    setRetryToken((current) => current + 1)
  }, [])

  useEffect(() => {
    const franchiseeId = scope.franchiseeId
    const storeId = scope.storeId
    if (!franchiseeId || !storeId) {
      setState({ status: 'missing_scope' })
      return
    }

    setState({ status: 'loading' })

    const unsubscribe = subscribeStoreMeterSettings(
      { franchiseeId, storeId },
      (settings) => {
        setState({ status: 'ready', settings })
      },
      () => {
        setState({ status: 'error', message: METER_SETTINGS_FETCH_ERROR_MESSAGE })
      },
    )

    return unsubscribe
  }, [scope.franchiseeId, scope.storeId, retryToken])

  return {
    state,
    settings: state.status === 'ready' ? state.settings : null,
    retry,
  }
}
