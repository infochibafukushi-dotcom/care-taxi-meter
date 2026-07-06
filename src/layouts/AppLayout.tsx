import { useEffect } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { ReviewDemoBanner } from '../components/reviewDemo/ReviewDemoBanner'
import {
  applyAccountingRouteLayout,
  clearAccountingRouteLayout,
  isAccountingPath,
} from '../utils/accountingRouteLayout'
import { DebugLayoutPanel } from '../components/DebugLayoutPanel'
import { bindAppViewportHeight } from '../utils/appViewportHeight'
import { isDebugLayoutMode, isMeterLandscapeNoticeBypass } from '../utils/debugLayoutMode'
import { logDiagnostic } from '../utils/diagnostics'
import {
  applyMeterRouteLayout,
  clearMeterRouteLayout,
  isMeterOperationPath,
} from '../utils/meterRouteLayout'
import { bindFlexibleOrientationGuard } from '../utils/screenOrientation'
import { isReviewDemoActive } from '../utils/reviewDemo'

export function AppLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const outletKey = `${location.pathname}${location.search}`
  const debugLayout = isDebugLayoutMode(location.search)
  const devScreenshot = isMeterLandscapeNoticeBypass(location.search)
  const onAccountingRoute = isAccountingPath(location.pathname)
  const onMeterRoute = isMeterOperationPath(location.pathname)
  const showReviewDemoBanner = isReviewDemoActive({
    pathname: location.pathname,
    search: location.search,
  })

  useEffect(() => {
    const cleanupViewport = bindAppViewportHeight()
    const cleanupOrientation = bindFlexibleOrientationGuard()

    if (onMeterRoute) {
      clearAccountingRouteLayout()
      applyMeterRouteLayout({ devScreenshot })
    } else {
      clearMeterRouteLayout()

      if (onAccountingRoute) {
        applyAccountingRouteLayout()
      } else {
        clearAccountingRouteLayout()
      }
    }

    return () => {
      cleanupOrientation()
      if (onMeterRoute) {
        clearMeterRouteLayout()
      } else if (onAccountingRoute) {
        clearAccountingRouteLayout()
      }
      cleanupViewport()
    }
  }, [devScreenshot, onAccountingRoute, onMeterRoute])

  logDiagnostic('AppLayout location', {
    pathname: location.pathname,
    search: location.search,
    href: window.location.href,
    navigationType,
  })
  logDiagnostic('AppLayout before Outlet render', { pathname: location.pathname })

  return (
    <div className="app-shell">
      {showReviewDemoBanner ? <ReviewDemoBanner /> : null}
      {debugLayout ? <DebugLayoutPanel /> : null}
      <Outlet key={outletKey} />
    </div>
  )
}
