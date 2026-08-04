import {
  EXPENSE_GROUP_TYPES,
  EXPENSE_GROUP_TYPE_LABELS,
  type ExpenseGroupType,
} from '../../types/accountingExpenseGroup'

type Props = {
  mode: 'normal' | 'grouped'
  onChange: (mode: 'normal' | 'grouped') => void
  disabled?: boolean
}

export function ExpenseEntryModeSwitch({ mode, onChange, disabled }: Props) {
  return (
    <div className="accounting-expense-mode-switch" role="tablist" aria-label="経費登録モード">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'normal'}
        className={
          mode === 'normal'
            ? 'accounting-expense-mode-switch-button is-active'
            : 'accounting-expense-mode-switch-button'
        }
        disabled={disabled}
        onClick={() => onChange('normal')}
      >
        通常経費
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'grouped'}
        className={
          mode === 'grouped'
            ? 'accounting-expense-mode-switch-button is-active'
            : 'accounting-expense-mode-switch-button'
        }
        disabled={disabled}
        onClick={() => onChange('grouped')}
      >
        まとめ経費
      </button>
    </div>
  )
}

export function ExpenseGroupTypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: ExpenseGroupType
  onChange: (value: ExpenseGroupType) => void
  disabled?: boolean
}) {
  return (
    <label>
      まとめ経費区分
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ExpenseGroupType)}
      >
        {EXPENSE_GROUP_TYPES.map((type) => (
          <option key={type} value={type}>
            {EXPENSE_GROUP_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
    </label>
  )
}
