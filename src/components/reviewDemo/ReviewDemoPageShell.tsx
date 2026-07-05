import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function ReviewDemoPageShell({
  children,
  backTo,
  backLabel,
}: {
  children: ReactNode
  backTo?: string
  backLabel?: string
}) {
  return (
    <main className="page review-demo-page">
      {backTo ? (
        <p className="review-demo-back-link-wrap">
          <Link className="text-link" to={backTo}>
            {backLabel ?? '← 戻る'}
          </Link>
        </p>
      ) : null}
      {children}
    </main>
  )
}
