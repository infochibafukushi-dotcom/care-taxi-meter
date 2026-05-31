import type { WorkSession } from '../../types/work'
import { formatCaseDateTime } from '../../utils/caseRecords'

type CurrentWorkSessionPanelProps = {
  isSaving: boolean
  workSession: WorkSession
  onClockOut: () => void
}

const formatOptionalDateTime = (value: string) =>
  value ? formatCaseDateTime(value) : '―'

const formatLocationStatus = (latitude: number | null, longitude: number | null) =>
  latitude === null || longitude === null ? '未取得' : '取得済み'

export function CurrentWorkSessionPanel({
  isSaving,
  workSession,
  onClockOut,
}: CurrentWorkSessionPanelProps) {
  return (
    <section className="work-session-panel work-session-panel--active" aria-labelledby="current-work-title">
      <div className="work-session-panel__header">
        <div>
          <span>WORKING</span>
          <h2 id="current-work-title">出勤中</h2>
        </div>
        <strong>{workSession.staffName}</strong>
      </div>

      <div className="work-session-detail-grid">
        <div>
          <span>店舗</span>
          <strong>{workSession.storeName || '未設定'}</strong>
        </div>
        <div>
          <span>車両</span>
          <strong>{workSession.vehicleName}</strong>
        </div>
        <div>
          <span>ナンバー</span>
          <strong>{workSession.vehicleNumber || '未設定'}</strong>
        </div>
        <div>
          <span>出勤時刻</span>
          <strong>{formatOptionalDateTime(workSession.clockInAt)}</strong>
        </div>
        <div>
          <span>出勤位置</span>
          <strong>{formatLocationStatus(workSession.clockInLatitude, workSession.clockInLongitude)}</strong>
        </div>
      </div>

      <button
        className="work-session-primary-button work-session-primary-button--danger"
        type="button"
        disabled={isSaving}
        onClick={onClockOut}
      >
        退勤
      </button>
    </section>
  )
}
