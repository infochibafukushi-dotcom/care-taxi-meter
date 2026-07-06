const getScreenOrientation = () => {
  if (!('screen' in window) || !window.screen.orientation) {
    return null
  }

  return window.screen.orientation as ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>
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

export const lockMeterLandscapeOrientation = async () => {
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

/** メーター以外の画面では向き固定を解除し続ける */
export const bindFlexibleOrientationGuard = () => {
  const ensureFlexible = () => {
    void unlockScreenOrientation()
  }

  ensureFlexible()

  window.addEventListener('pageshow', ensureFlexible)
  document.addEventListener('visibilitychange', ensureFlexible)

  return () => {
    window.removeEventListener('pageshow', ensureFlexible)
    document.removeEventListener('visibilitychange', ensureFlexible)
  }
}
