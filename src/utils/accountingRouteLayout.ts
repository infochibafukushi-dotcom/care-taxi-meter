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

/** 経理画面では縦向き利用を優先（PWA の旧 landscape 固定の解除を試みる） */
export const applyAccountingScreenOrientation = async () => {
  const orientation = getScreenOrientation()
  if (!orientation) {
    return
  }

  await unlockScreenOrientation()

  if (!orientation.lock) {
    return
  }

  try {
    await orientation.lock('portrait-primary')
  } catch {
    // Fullscreen / permission / unsupported: unlock のみで続行
  }
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
