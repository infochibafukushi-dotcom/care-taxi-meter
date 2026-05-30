import type { OperationStatus, StatusTone } from '../../types/case'

type CaseHeaderProps = {
  caseNumber: string
  status: OperationStatus
  statusTone: StatusTone
}

export function CaseHeader({
  caseNumber,
  status,
  statusTone,
}: CaseHeaderProps) {
  return (
    <header className="meter-header">
      <div>
        <span className="meter-label">案件番号</span>
        <strong className="case-number">{caseNumber}</strong>
      </div>
      <div className="status-display" aria-live="polite">
        <span className="meter-label">運行状態</span>
        <strong className={`status-badge status-badge--${statusTone}`}>
          {status}
        </strong>
      </div>
    </header>
  )
}
