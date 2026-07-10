import type { ReactNode } from 'react'
import { PreFixedRouteMapPanel, type RouteMapMarker } from './PreFixedRouteMapPanel'
import { formatFareYen } from '../../services/fare'
import type { PreFixedRouteCandidate, PreFixedRouteCandidateId } from '../../types/preFixedMeterSession'
import {
  formatRouteDistanceLabel,
  formatRouteDurationLabel,
  sortRouteCandidatesById,
} from '../../services/preFixedRouteQuote'

export type PreFixedRouteSelectionStepProps = {
  routeCandidates: PreFixedRouteCandidate[]
  selectedRouteId: PreFixedRouteCandidateId
  onSelectRoute: (routeId: PreFixedRouteCandidateId) => void
  resolvePreFixedTotalYen: (route: PreFixedRouteCandidate) => number
  markers?: RouteMapMarker[]
  isLoading?: boolean
  onNext: () => void
  nextLabel: string
  nextDisabled?: boolean
  notice?: ReactNode
  footer?: ReactNode
  totalLabel?: string
  fareEstimateLabel?: string
}

export function PreFixedRouteSelectionStep({
  routeCandidates,
  selectedRouteId,
  onSelectRoute,
  resolvePreFixedTotalYen,
  markers = [],
  isLoading = false,
  onNext,
  nextLabel,
  nextDisabled = false,
  notice,
  footer,
  totalLabel = '事前確定料金',
  fareEstimateLabel = '運賃',
}: PreFixedRouteSelectionStepProps) {
  const sortedCandidates = sortRouteCandidatesById(routeCandidates)
  const selectedRoute =
    sortedCandidates.find((route) => route.id === selectedRouteId) ?? sortedCandidates[0]
  const selectedTotalYen = selectedRoute ? resolvePreFixedTotalYen(selectedRoute) : 0

  return (
    <div className="pre-fixed-route-selection-step">
      <div className="pre-fixed-route-candidate-grid" role="list" aria-label="ルート候補">
        {sortedCandidates.map((route) => {
          const isSelected = selectedRouteId === route.id
          const preFixedTotalYen = resolvePreFixedTotalYen(route)

          return (
            <button
              key={route.id}
              type="button"
              role="listitem"
              className={`pre-fixed-route-card${isSelected ? ' is-selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelectRoute(route.id)}
            >
              <div className="pre-fixed-route-card__header">
                <div className="pre-fixed-route-card__title-row">
                  <strong>
                    {route.id} {route.label}
                  </strong>
                  {isSelected ? (
                    <span className="pre-fixed-route-card__selected-badge">選択中</span>
                  ) : null}
                </div>
                <span className="pre-fixed-amount">{formatFareYen(preFixedTotalYen)}円</span>
              </div>
              <p className="pre-fixed-route-card__meta">
                {formatRouteDistanceLabel(route.distanceMeters)}
                {' / '}
                {formatRouteDurationLabel(route.durationSeconds)}
              </p>
              <dl className="pre-fixed-route-card__breakdown">
                <div>
                  <dt>{fareEstimateLabel}</dt>
                  <dd>{formatFareYen(route.fixedFareYen)}円</dd>
                </div>
                <div>
                  <dt>{totalLabel}</dt>
                  <dd>{formatFareYen(preFixedTotalYen)}円</dd>
                </div>
              </dl>
            </button>
          )
        })}
      </div>

      {notice ? <div className="pre-fixed-route-selection-notice">{notice}</div> : null}

      <PreFixedRouteMapPanel
        candidates={sortedCandidates}
        selectedRouteId={selectedRouteId}
        markers={markers}
        isLoading={isLoading}
        showSelectedRouteOnly
      />

      <div className="pre-fixed-route-step-footer pre-fixed-route-step-footer--sticky">
        <div className="pre-fixed-consent-summary__total">
          <p>{totalLabel}</p>
          <p className="pre-fixed-amount">{formatFareYen(selectedTotalYen)}円</p>
        </div>
        {footer}
        <div className="pre-fixed-flow-actions">
          <button
            className="primary-action"
            type="button"
            disabled={nextDisabled || !selectedRoute || isLoading}
            onClick={onNext}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
