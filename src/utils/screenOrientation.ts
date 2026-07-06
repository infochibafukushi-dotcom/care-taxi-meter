const getScreenOrientation = () => {
  if (!('screen' in window) || !window.screen.orientation) {
    return null
  }

  return window.screen.orientation as ScreenOrientation & {
    unlock?: () => Promise<void>
  }
}

/**
 * 向き固定を解除する。orientation.lock は一切呼ばない（PWA で横向き固定が再発するため）。
 */
export const unlockScreenOrientation = async () => {
  const orientation = getScreenOrientation()

  if (orientation?.unlock) {
    try {
      await orientation.unlock()
    } catch {
      // Some browsers reject unlock when nothing is locked.
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
  window.addEventListener('orientationchange', ensureFlexible)
  document.addEventListener('visibilitychange', ensureFlexible)

  return () => {
    window.removeEventListener('pageshow', ensureFlexible)
    window.removeEventListener('focus', ensureFlexible)
    window.removeEventListener('popstate', ensureFlexible)
    window.removeEventListener('orientationchange', ensureFlexible)
    document.removeEventListener('visibilitychange', ensureFlexible)
  }
}
