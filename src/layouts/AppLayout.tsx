import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { logDiagnostic } from '../utils/diagnostics'

export function AppLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const outletKey = `${location.pathname}${location.search}`

  logDiagnostic('AppLayout location', {
    pathname: location.pathname,
    search: location.search,
    href: window.location.href,
    navigationType,
  })
  logDiagnostic('AppLayout before Outlet render', { pathname: location.pathname })

  return (
    <div className="app-shell">
      <Outlet key={outletKey} />
    </div>
  )
}
