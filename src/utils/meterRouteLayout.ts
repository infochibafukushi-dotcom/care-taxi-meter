import {
  unlockScreenOrientation,
} from './screenOrientation'

const METER_ROUTE_CLASS = 'route-meter'
const DEV_SCREENSHOT_CLASS = 'route-dev-screenshot'

export const isMeterOperationPath = (pathname: string) => {
  const normalized = pathname.replace(/\/+$/, '') || '/'

  return (
    normalized === '/case' ||
    normalized.endsWith('/case/start') ||
    normalized.endsWith('/case/pre-fixed') ||
    normalized.endsWith('/case/pre-fixed/reservations') ||
    normalized.endsWith('/case/pre-fixed/create') ||
    normalized.endsWith('/review-demo/case') ||
    normalized.endsWith('/review-demo/case/start')
  )
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
  // 横向き運用は CSS（route-meter + landscape-notice）のみ。API lock は使わない。
  void unlockScreenOrientation()
}

export const clearMeterRouteLayout = () => {
  setMeterRouteClasses(false, false)
  void unlockScreenOrientation()
}
