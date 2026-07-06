const getScreenOrientation = () => {
  if (!('screen' in window) || !window.screen.orientation) {
    return null
  }

  return window.screen.orientation as ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>
    unlock?: () => Promise<void>
  }
}

/** メーター以外（および起動時）で向き固定を解除する */
export const unlockScreenOrientation = async () => {
  const orientation = getScreenOrientation()

  if (orientation?.unlock) {
    try {
      await orientation.unlock()
    } catch {
      // Some browsers reject unlock when nothing is locked.
    }
  }

  // lock('landscape-primary') 残留時: any → unlock の順で解除を試みる
  if (orientation?.lock) {
    try {
      await orientation.lock('any')
      if (orientation.unlock) {
        await orientation.unlock()
      }
    } catch {
      // unsupported / permission denied
    }
  }

  const legacyScreen = window.screen as Screen & {
    unlockOrientation?: () => void
  }

  try {
    legacyScreen.unlockOrientation?.()
  } catch {
    // legacy API unavailable
  }
}

/** メーター以外の画面では向き固定を解除し続ける */
export const bindFlexibleOrientationGuard = () => {
  const ensureFlexible = () => {
    void unlockScreenOrientation()
  }

  ensureFlexible()

  window.addEventListener('pageshow', ensureFlexible)
  window.addEventListener('focus', ensureFlexible)
  window.addEventListener('popstate', ensureFlexible)
  document.addEventListener('visibilitychange', ensureFlexible)

  return () => {
    window.removeEventListener('pageshow', ensureFlexible)
    window.removeEventListener('focus', ensureFlexible)
    window.removeEventListener('popstate', ensureFlexible)
    document.removeEventListener('visibilitychange', ensureFlexible)
  }
}
