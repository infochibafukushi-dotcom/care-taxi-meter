import { useState } from 'react'
import { expenseSettings } from '../../services/fare'
import type { ExpenseItem } from '../../types/case'

type ExpensesPanelProps = {
  expenses: ExpenseItem[]
  onAdd: (expense: Omit<ExpenseItem, 'id'>) => void
  onRemove: (id: string) => void
}

export function ExpensesPanel({ expenses, onAdd, onRemove }: ExpensesPanelProps) {
  const [name, setName] = useState(expenseSettings.defaultNames[0] ?? '')
  const [amountYen, setAmountYen] = useState(0)

  const handleAdd = () => {
    if (!name.trim() || amountYen <= 0) {
      return
    }

    onAdd({ name: name.trim(), amountYen })
    setName(expenseSettings.defaultNames[0] ?? '')
    setAmountYen(0)
  }

  return (
    <section className="input-panel" aria-labelledby="expenses-title">
      <div className="input-panel__header">
        <h2 id="expenses-title">実費</h2>
        <span>{expenses.length}件</span>
      </div>
      <div className="expense-form">
        <label className="field-label">
          名称
          <input
            list="expense-name-options"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <datalist id="expense-name-options">
          {expenseSettings.defaultNames.map((expenseName) => (
            <option key={expenseName} value={expenseName} />
          ))}
        </datalist>
        <label className="field-label">
          金額
          <input
            inputMode="numeric"
            min="0"
            type="number"
            value={amountYen}
            onChange={(event) => setAmountYen(Number(event.target.value))}
          />
        </label>
        <button className="panel-action" type="button" onClick={handleAdd}>
          実費を追加
        </button>
      </div>
      <div className="line-item-list">
        {expenses.length === 0 ? <p className="empty-note">実費は未追加です。</p> : null}
        {expenses.map((expense) => (
          <div className="readonly-line-item" key={expense.id}>
            <span>{expense.name}</span>
            <strong>{expense.amountYen.toLocaleString('ja-JP')}円</strong>
            <button type="button" onClick={() => onRemove(expense.id)}>
              削除
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
