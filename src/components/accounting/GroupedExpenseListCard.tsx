import type { StoredAccountingExpense } from '../../types/accounting'
import type { StoredAccountingExpenseGroup } from '../../types/accountingExpenseGroup'
import { describeExpenseGroupSummary } from '../../utils/accountingExpenseGroup'
import { formatFareYen } from '../../services/fare'

type Props = {
  group: StoredAccountingExpenseGroup
  expenses: StoredAccountingExpense[]
  onOpen: () => void
  onDelete: () => void
}

export function GroupedExpenseListCard({ group, expenses, onOpen, onDelete }: Props) {
  const summary = describeExpenseGroupSummary({
    title: group.title,
    groupType: group.groupType,
    startDate: group.startDate,
    endDate: group.endDate,
    totalAmount: group.totalAmount,
    receiptCount: expenses.length || group.expenseIds.length,
  })

  return (
    <article className="accounting-expense-card accounting-expense-card--group">
      <header>
        <strong>{summary.title}</strong>
        <span>まとめ経費</span>
      </header>
      <dl>
        <div>
          <dt>実施期間</dt>
          <dd>{summary.periodLabel}</dd>
        </div>
        <div>
          <dt>区分</dt>
          <dd>まとめ経費：{summary.groupTypeLabel}</dd>
        </div>
        <div>
          <dt>合計</dt>
          <dd>{formatFareYen(summary.totalAmount)}</dd>
        </div>
        <div>
          <dt>領収書</dt>
          <dd>{summary.receiptCount}件</dd>
        </div>
      </dl>
      <div className="accounting-expense-card-actions">
        <button className="secondary-action" type="button" onClick={onOpen}>
          詳細・編集
        </button>
        <button className="secondary-action" type="button" onClick={onDelete}>
          削除
        </button>
      </div>
    </article>
  )
}
