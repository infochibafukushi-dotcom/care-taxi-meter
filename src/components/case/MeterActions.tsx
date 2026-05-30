import type { MeterAction } from '../../types/case'

type MeterActionsProps = {
  actions: MeterAction[]
}

export function MeterActions({ actions }: MeterActionsProps) {
  return (
    <section className="meter-actions" aria-label="運行操作">
      {actions.map((action) => (
        <button
          className={`meter-action meter-action--${action.variant}`}
          key={action.label}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </section>
  )
}
