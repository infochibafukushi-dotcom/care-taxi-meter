import { unlockScreenOrientation } from './accountingRouteLayout'

const METER_ROUTE_CLASS = 'route-meter'
const DEV_SCREENSHOT_CLASS = 'route-dev-screenshot'

export const isMeterOperationPath = (pathname: string) => {
  const normalized = pathname.replace(/\/+$/, '') || '/'

  if (normalized === '/accounting' || normalized.endsWith('/accounting')) {
    return false
  }

  return (
    normalized === '/case' ||
    normalized.endsWith('/case/start') ||
    normalized.endsWith('/review-demo/case') ||
    normalized.endsWith('/review-demo/case/start')
  )
}

const getScreenOrientation = () => {
  if (!('screen' in window) || !window.screen.orientation) {
    return null
  }

  return window.screen.orientation as ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>
    unlock?: () => Promise<void>
  }
}

const applyMeterScreenOrientation = async () => {
  const orientation = getScreenOrientation()
  if (!orientation?.lock) {
    return
  }

  try {
    await orientation.lock('landscape-primary')
  } catch {
    // Browser / permission / unsupported: continue without locking.
  }
}

const setMeterRouteClasses = (enabled: boolean, devScreenshot: boolean) => {
  const root = document.getElementById('root')
  const targets = [document.documentElement, document.body, root]

  for (const target of targets) {
    if (!target) {
      continue
    }

    target.classList.toggle(METER_ROUTE_CLASS, enabled)
    target.classList.toggle(DEV_SCREENSHOT_CLASS, enabled && devScreenshot)
  }
}

export const applyMeterRouteLayout = ({ devScreenshot }: { devScreenshot: boolean }) => {
  setMeterRouteClasses(true, devScreenshot)

  if (devScreenshot) {
    void unlockScreenOrientation()
    return
  }

  void applyMeterScreenOrientation()
}

export const clearMeterRouteLayout = () => {
  setMeterRouteClasses(false, false)
  void unlockScreenOrientation()
}
