import type { MeterAction, OperationStatus } from '../../types/case'

type MeterActionsProps = {
  actions: MeterAction[]
  onStatusChange: (status: OperationStatus) => void
}

export function MeterActions({ actions, onStatusChange }: MeterActionsProps) {
  return (
    <section className="meter-actions" aria-label="運行操作">
      {actions.map((action) => (
        <button
          className={`meter-action meter-action--${action.variant}`}
          key={action.label}
          type="button"
          onClick={() => {
            if (action.nextStatus) {
              onStatusChange(action.nextStatus)
            }
          }}
        >
          {action.label}
        </button>
      ))}
    </section>
  )
}
