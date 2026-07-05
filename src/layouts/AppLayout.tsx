import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { ReviewDemoBanner } from '../components/reviewDemo/ReviewDemoBanner'
import { logDiagnostic } from '../utils/diagnostics'
import { isReviewDemoActive } from '../utils/reviewDemo'

export function AppLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const outletKey = `${location.pathname}${location.search}`
  const showReviewDemoBanner = isReviewDemoActive({
    pathname: location.pathname,
    search: location.search,
  })

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
      <Outlet key={outletKey} />
    </div>
  )
}
