import type { PreFixedFareException } from '../../types/preFixedFare'
import {
  PRE_FIXED_FARE_PASSENGER_CHANGE_NEXT_OPERATION_LABEL,
  PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL,
} from '../../types/preFixedFare'
import { formatFareYen } from '../../services/fare'
import { formatCaseDateTime, getPreFixedFarePassengerChangeDisplayLabel } from '../../utils/caseRecords'

type PreFixedFarePassengerChangeDetailSectionProps = {
  completionStatusLabel?: string | null
  completionReasonLabel?: string | null
  fareMode?: string | null
  preFixedFareException?: PreFixedFareException | null
}

const formatOptionalDateTime = (value: string) => {
  if (!value.trim()) {
    return '未取得'
  }

  const formatted = formatCaseDateTime(value)
  return formatted.trim() ? formatted : '未取得'
}

const formatOptionalOriginalFare = (value: number) =>
  Number.isFinite(value) && value > 0 ? `${formatFareYen(value)}円` : '未取得'

export function PreFixedFarePassengerChangeDetailSection({
  completionStatusLabel,
  completionReasonLabel,
  fareMode,
  preFixedFareException,
}: PreFixedFarePassengerChangeDetailSectionProps) {
  const endReasonLabel =
    completionReasonLabel?.trim() ||
    preFixedFareException?.reasonLabel?.trim() ||
    PRE_FIXED_FARE_PASSENGER_CHANGE_REASON_LABEL

  return (
    <section className="case-passenger-change-panel" aria-label="事前確定運賃途中終了">
      <p className="case-status-badge case-status-badge--passenger-change">
        {getPreFixedFarePassengerChangeDisplayLabel()}
      </p>
      <dl className="reservation-detail-dl">
        {completionStatusLabel ? (
          <div>
            <dt>完了ステータス</dt>
            <dd>{completionStatusLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>終了理由</dt>
          <dd>{endReasonLabel}</dd>
        </div>
        {preFixedFareException ? (
          <>
            <div>
              <dt>終了日時</dt>
              <dd>{formatOptionalDateTime(preFixedFareException.endedAt)}</dd>
            </div>
            <div>
              <dt>当初事前確定運賃</dt>
              <dd>{formatOptionalOriginalFare(preFixedFareException.originalFixedFareYen)}</dd>
            </div>
            <div>
              <dt>fareMode</dt>
              <dd>{fareMode ?? preFixedFareException.fareModeBeforeEnd ?? '未取得'}</dd>
            </div>
            <div>
              <dt>以後の運送</dt>
              <dd>{PRE_FIXED_FARE_PASSENGER_CHANGE_NEXT_OPERATION_LABEL}</dd>
            </div>
            {preFixedFareException.endedLocation.lat != null &&
            preFixedFareException.endedLocation.lng != null ? (
              <div>
                <dt>終了地点</dt>
                <dd>
                  {preFixedFareException.endedLocation.lat.toFixed(6)},{' '}
                  {preFixedFareException.endedLocation.lng.toFixed(6)}
                </dd>
              </div>
            ) : null}
            {preFixedFareException.note.trim() ? (
              <div>
                <dt>備考</dt>
                <dd>{preFixedFareException.note}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
    </section>
  )
}
