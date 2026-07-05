import { REVIEW_DEMO_BANNER_TEXT } from '../../utils/reviewDemo'

export function ReviewDemoBanner() {
  return (
    <div className="review-demo-banner" role="status" aria-live="polite">
      {REVIEW_DEMO_BANNER_TEXT}
    </div>
  )
}
