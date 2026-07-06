const ROUTE_CLASS = 'route-accounting'

export const isAccountingPath = (pathname: string) => {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === '/accounting' || normalized.endsWith('/accounting')
}

const getScreenOrientation = () => {
  if (!('screen' in window) || !window.screen.orientation) {
    return null
  }

  return window.screen.orientation as ScreenOrientation & {
    unlock?: () => Promise<void>
  }
}

export const unlockScreenOrientation = async () => {
  const orientation = getScreenOrientation()
  if (!orientation?.unlock) {
    return
  }

  try {
    await orientation.unlock()
  } catch {
    // Some browsers reject unlock when nothing is locked.
  }
}

/** 経理画面では向き固定しない（メーター画面の landscape 固定を解除するのみ） */
export const applyAccountingScreenOrientation = async () => {
  await unlockScreenOrientation()
}

const setRouteAccountingClass = (enabled: boolean) => {
  const root = document.getElementById('root')
  document.documentElement.classList.toggle(ROUTE_CLASS, enabled)
  document.body.classList.toggle(ROUTE_CLASS, enabled)
  root?.classList.toggle(ROUTE_CLASS, enabled)
}

export const applyAccountingRouteLayout = () => {
  setRouteAccountingClass(true)
  void applyAccountingScreenOrientation()
}

export const clearAccountingRouteLayout = () => {
  setRouteAccountingClass(false)
  void unlockScreenOrientation()
}
