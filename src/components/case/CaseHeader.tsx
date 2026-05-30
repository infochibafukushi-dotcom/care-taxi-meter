import type { OperationStatus } from '../../types/case'

type CaseHeaderProps = {
  caseNumber: string
  status: OperationStatus
  statusOptions: OperationStatus[]
  onStatusChange: (status: OperationStatus) => void
}

export function CaseHeader({
  caseNumber,
  status,
  statusOptions,
  onStatusChange,
}: CaseHeaderProps) {
  return (
    <header className="meter-header">
      <div>
        <span className="meter-label">案件番号</span>
        <strong className="case-number">{caseNumber}</strong>
      </div>
      <label className="status-control">
        <span className="meter-label">運行状態</span>
        <select
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value as OperationStatus)
          }
        >
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}
