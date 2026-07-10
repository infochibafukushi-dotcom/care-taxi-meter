import { formatFareYen } from '../../services/fare'
import type { PreFixedRouteCandidate } from '../../types/preFixedMeterSession'
import {
  formatRouteDistanceLabel,
  formatRouteDurationLabel,
} from '../../services/preFixedRouteQuote'

type PreFixedRouteCandidateCardProps = {
  route: PreFixedRouteCandidate
  isSelected: boolean
  routeFareYen: number
  serviceFeesYen: number
  preFixedTotalYen: number
  onSelect: () => void
}

export function PreFixedRouteCandidateCard({
  route,
  isSelected,
  routeFareYen,
  serviceFeesYen,
  preFixedTotalYen,
  onSelect,
}: PreFixedRouteCandidateCardProps) {
  return (
    <button
      type="button"
      className={`pre-fixed-route-card pre-fixed-route-card--compact${isSelected ? ' is-selected' : ''}`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <div className="pre-fixed-route-card__header">
        <div className="pre-fixed-route-card__title-row">
          <strong>
            {route.id} {route.label}
          </strong>
          {isSelected ? <span className="pre-fixed-route-card__selected-badge">選択中</span> : null}
        </div>
        <span className="pre-fixed-amount">{formatFareYen(preFixedTotalYen)}円</span>
      </div>
      <p className="pre-fixed-route-card__meta">
        {formatRouteDurationLabel(route.durationSeconds).replace('約', '')}・
        {formatRouteDistanceLabel(route.distanceMeters)}
      </p>
      <dl className="pre-fixed-route-card__breakdown pre-fixed-route-card__breakdown--compact">
        <div>
          <dt>運賃</dt>
          <dd>{formatFareYen(routeFareYen)}円</dd>
        </div>
        <div>
          <dt>介助・サービス</dt>
          <dd>{formatFareYen(serviceFeesYen)}円</dd>
        </div>
      </dl>
      {isSelected ? <span className="pre-fixed-route-card__check" aria-hidden="true">✓</span> : null}
    </button>
  )
}
