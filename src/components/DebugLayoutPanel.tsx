import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isAccountingPath } from '../utils/accountingRouteLayout'
import { appBuildVersion } from '../utils/diagnostics'
import { isMeterOperationPath } from '../utils/meterRouteLayout'

type LayoutSnapshot = {
  pathname: string
  isMeterRoute: boolean
  isAccountingRoute: boolean
  htmlClass: string
  bodyClass: string
  rootClass: string
  orientationType: string
  orientationAngle: string
  innerWidth: number
  innerHeight: number
  visualViewportWidth: string
  visualViewportHeight: string
  portraitMq: boolean
  landscapeMq: boolean
  displayMode: string
  userAgent: string
  swController: boolean
  swState: string
  jsBundle: string
  cssBundle: string
  appHeight: string
  addressPanelDisplay: string
  addressPanelHeight: string
  addressPanelRect: string
}

const readBundleName = (selector: string) => {
  const element = document.querySelector(selector)

  if (!element) {
    return '—'
  }

  const href = element.getAttribute('src') ?? element.getAttribute('href') ?? ''
  const parts = href.split('/')
  return parts[parts.length - 1] || href || '—'
}

const readLayoutSnapshot = (pathname: string): LayoutSnapshot => {
  const root = document.getElementById('root')
  const orientation = window.screen.orientation
  const addressPanel = document.querySelector('.route-address-panel')
  const addressStyle = addressPanel ? getComputedStyle(addressPanel) : null
  const addressRect = addressPanel?.getBoundingClientRect()

  return {
    pathname,
    isMeterRoute: isMeterOperationPath(pathname),
    isAccountingRoute: isAccountingPath(pathname),
    htmlClass: document.documentElement.className || '(none)',
    bodyClass: document.body.className || '(none)',
    rootClass: root?.className || '(none)',
    orientationType: orientation?.type ?? 'n/a',
    orientationAngle: orientation?.angle?.toString() ?? 'n/a',
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualViewportWidth:
      typeof window.visualViewport?.width === 'number'
        ? String(Math.round(window.visualViewport.width))
        : 'n/a',
    visualViewportHeight:
      typeof window.visualViewport?.height === 'number'
        ? String(Math.round(window.visualViewport.height))
        : 'n/a',
    portraitMq: window.matchMedia('(orientation: portrait)').matches,
    landscapeMq: window.matchMedia('(orientation: landscape)').matches,
    displayMode: window.matchMedia('(display-mode: standalone)').matches
      ? 'standalone'
      : window.matchMedia('(display-mode: fullscreen)').matches
        ? 'fullscreen'
        : 'browser',
    userAgent: navigator.userAgent,
    swController: Boolean(navigator.serviceWorker?.controller),
    swState: navigator.serviceWorker?.controller?.state ?? 'none',
    jsBundle: readBundleName('script[type="module"][src*="assets/"]'),
    cssBundle: readBundleName('link[rel="stylesheet"][href*="assets/"]'),
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim() || 'n/a',
    addressPanelDisplay: addressStyle?.display ?? 'n/a',
    addressPanelHeight: addressStyle?.height ?? 'n/a',
    addressPanelRect: addressRect
      ? `${Math.round(addressRect.width)}x${Math.round(addressRect.height)} @${Math.round(addressRect.top)}`
      : 'n/a',
  }
}

export function DebugLayoutPanel() {
  const location = useLocation()
  const [snapshot, setSnapshot] = useState(() => readLayoutSnapshot(location.pathname))

  useEffect(() => {
    const refresh = () => {
      setSnapshot(readLayoutSnapshot(location.pathname))
    }

    refresh()

    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)

    const timer = window.setInterval(refresh, 1500)

    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('scroll', refresh)
      window.clearInterval(timer)
    }
  }, [location.pathname])

  const rows: Array<[string, string]> = [
    ['pathname', snapshot.pathname],
    ['isMeterRoute', String(snapshot.isMeterRoute)],
    ['isAccountingRoute', String(snapshot.isAccountingRoute)],
    ['html.class', snapshot.htmlClass],
    ['body.class', snapshot.bodyClass],
    ['#root.class', snapshot.rootClass],
    ['orientation.type', snapshot.orientationType],
    ['orientation.angle', snapshot.orientationAngle],
    ['innerWidth', String(snapshot.innerWidth)],
    ['innerHeight', String(snapshot.innerHeight)],
    ['visualViewport.w', snapshot.visualViewportWidth],
    ['visualViewport.h', snapshot.visualViewportHeight],
    ['--app-height', snapshot.appHeight],
    ['MQ portrait', String(snapshot.portraitMq)],
    ['MQ landscape', String(snapshot.landscapeMq)],
    ['display-mode', snapshot.displayMode],
    ['SW controller', String(snapshot.swController)],
    ['SW state', snapshot.swState],
    ['JS bundle', snapshot.jsBundle],
    ['CSS bundle', snapshot.cssBundle],
    ['build', appBuildVersion],
    ['address.display', snapshot.addressPanelDisplay],
    ['address.height', snapshot.addressPanelHeight],
    ['address.rect', snapshot.addressPanelRect],
    ['UA', snapshot.userAgent],
  ]

  return (
    <aside className="debug-layout-panel" aria-label="レイアウト診断">
      <strong>debugLayout=1</strong>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="debug-layout-panel__note">
        PWA を古い manifest（landscape）でインストールした場合、端末の横向き固定は再インストールが必要なことがあります。
      </p>
    </aside>
  )
}
