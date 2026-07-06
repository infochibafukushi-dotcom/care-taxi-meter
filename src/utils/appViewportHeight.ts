const APP_HEIGHT_VAR = '--app-height'

const readViewportHeightPx = () => {
  const visualHeight = window.visualViewport?.height
  if (typeof visualHeight === 'number' && visualHeight > 0) {
    return visualHeight
  }

  return window.innerHeight
}

const applyViewportHeight = () => {
  document.documentElement.style.setProperty(APP_HEIGHT_VAR, `${readViewportHeightPx()}px`)
}

export const bindAppViewportHeight = () => {
  applyViewportHeight()

  const onViewportChange = () => {
    applyViewportHeight()
  }

  window.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)

  return () => {
    window.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('scroll', onViewportChange)
    document.documentElement.style.removeProperty(APP_HEIGHT_VAR)
  }
}
