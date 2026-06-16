export const appBuildVersion = import.meta.env.VITE_APP_BUILD_VERSION ?? 'dev'

export const logDiagnostic = (label: string, details?: Record<string, unknown>) => {
  console.info(`[diagnostics] ${label}`, details ?? {})
}

export const logNavigationClick = ({
  label,
  to,
}: {
  label: string
  to: string
}) => {
  logDiagnostic('navigation click', {
    label,
    to,
    hrefBefore: window.location.href,
  })

  window.setTimeout(() => {
    logDiagnostic('navigation after click', {
      label,
      to,
      hrefAfter: window.location.href,
    })
  }, 0)
}
