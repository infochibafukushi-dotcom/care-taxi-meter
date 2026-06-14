import { Outlet, useLocation } from 'react-router-dom'

export function AppLayout() {
  const location = useLocation()
  const outletKey = `${location.pathname}${location.search}`

  return (
    <div className="app-shell">
      <Outlet key={outletKey} />
    </div>
  )
}
