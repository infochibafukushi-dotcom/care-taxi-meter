import { formatFareYen } from '../../services/fare'
import { formatDurationMinutes } from '../../services/preFixedFareRoute'
import type { PreFixedFareConfirmedRouteView } from '../../types/preFixedFareRouteChange'
import { formatCaseDateTime } from '../../utils/caseRecords'

type PreFixedFareConfirmedRouteDialogProps = {
  isOpen: boolean
  routeView: PreFixedFareConfirmedRouteView | null
  onClose: () => void
}

export function PreFixedFareConfirmedRouteDialog({
  isOpen,
  routeView,
  onClose,
}: PreFixedFareConfirmedRouteDialogProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        aria-labelledby="pre-fixed-confirmed-route-title"
        aria-modal="true"
        className="settings-modal pre-fixed-route-dialog"
        role="dialog"
      >
        <header className="settings-header">
          <div>
            <span>予約時確定ルート</span>
            <h2 id="pre-fixed-confirmed-route-title">確定ルートを見る</h2>
          </div>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        {routeView ? (
          <>
            <dl className="reservation-detail-dl pre-fixed-confirmed-route-dl">
              <div>
                <dt>予約ID</dt>
                <dd>{routeView.reservationId || '—'}</dd>
              </div>
              <div>
                <dt>乗車地</dt>
                <dd>{routeView.pickupAddress || '—'}</dd>
              </div>
              {routeView.viaAddresses.length > 0 ? (
                <div>
                  <dt>経由地</dt>
                  <dd>{routeView.viaAddresses.join(' / ')}</dd>
                </div>
              ) : null}
              <div>
                <dt>降車地</dt>
                <dd>{routeView.dropoffAddress || '—'}</dd>
              </div>
              <div>
                <dt>予約時の確定ルート</dt>
                <dd>{routeView.overallRouteLabel || '—'}</dd>
              </div>
              <div>
                <dt>推計距離</dt>
                <dd>
                  {routeView.distanceMeters != null
                    ? `${(routeView.distanceMeters / 1000).toFixed(1)}km`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>推計時間</dt>
                <dd>
                  {routeView.durationSeconds != null
                    ? formatDurationMinutes(routeView.durationSeconds)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>有料道路利用</dt>
                <dd>{routeView.useToll ? 'あり' : 'なし'}</dd>
              </div>
              <div>
                <dt>確定運賃</dt>
                <dd>{formatFareYen(routeView.confirmedFareYen)}円</dd>
              </div>
              {routeView.fareBreakdownLines.length > 0 ? (
                <div>
                  <dt>運賃内訳</dt>
                  <dd>
                    {routeView.fareBreakdownLines
                      .map((line) => `${line.label} ${formatFareYen(line.amountYen)}円`)
                      .join(' / ')}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>お客様同意日時</dt>
                <dd>{routeView.consentAt ? formatCaseDateTime(routeView.consentAt) : '—'}</dd>
              </div>
              <div>
                <dt>スナップショットハッシュ</dt>
                <dd className="reservation-hash">{routeView.snapshotHash || '—'}</dd>
              </div>
            </dl>
            <p className="empty-note">
              このルートは予約時にお客様が同意した内容です。運行中の再計算ルートではありません。
            </p>
          </>
        ) : (
          <p className="lead">予約連携情報が見つかりません。予約詳細から再度開始してください。</p>
        )}
      </section>
    </div>
  )
}
