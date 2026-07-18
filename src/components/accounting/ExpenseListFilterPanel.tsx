import { memo } from 'react'
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type AccountingPaymentMethod,
  type ExpenseCategory,
} from '../../types/accounting'
import type {
  ExpenseListConfirmationFilter,
  ExpenseListFilters,
  ExpenseListSortDirection,
  ExpenseListSortKey,
  ExpenseListTriFilter,
} from '../../utils/accountingExpenseListQuery'

type ExpenseListFilterPanelProps = {
  filters: ExpenseListFilters
  searchInput: string
  filtersExpanded: boolean
  resultCount: number
  resultTotalYen: number
  activeConditionLabels: string[]
  isFiltered: boolean
  onSearchInputChange: (value: string) => void
  onFiltersChange: (next: ExpenseListFilters) => void
  onClear: () => void
  onToggleExpanded: () => void
}

const triOptions: Array<{ value: ExpenseListTriFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'yes', label: 'あり' },
  { value: 'no', label: 'なし' },
]

const confirmationOptions: Array<{ value: ExpenseListConfirmationFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: '確認済み', label: '確認済み' },
  { value: '未確認', label: '未確認' },
]

const sortKeyOptions: Array<{ value: ExpenseListSortKey; label: string }> = [
  { value: 'default', label: '標準（現在の一覧順）' },
  { value: 'paymentDate', label: '支払日' },
  { value: 'amount', label: '金額' },
  { value: 'createdAt', label: '登録日時' },
  { value: 'updatedAt', label: '更新日時' },
]

function ExpenseListFilterPanelComponent({
  filters,
  searchInput,
  filtersExpanded,
  resultCount,
  resultTotalYen,
  activeConditionLabels,
  isFiltered,
  onSearchInputChange,
  onFiltersChange,
  onClear,
  onToggleExpanded,
}: ExpenseListFilterPanelProps) {
  const patch = (partial: Partial<ExpenseListFilters>) => {
    onFiltersChange({ ...filters, ...partial })
  }

  return (
    <section
      className={`accounting-expense-filter-panel${isFiltered ? ' accounting-expense-filter-panel--active' : ''}`}
      aria-label="経費一覧の検索・絞り込み"
    >
      <div className="accounting-expense-filter-toolbar">
        <label className="accounting-expense-filter-search">
          <span>検索</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder="支払先・摘要・請求書番号・メモ・金額"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="secondary-action accounting-expense-filter-toggle"
          aria-expanded={filtersExpanded}
          onClick={onToggleExpanded}
        >
          {filtersExpanded ? '絞り込みを閉じる' : '絞り込み・並び替え'}
          {isFiltered ? '（適用中）' : ''}
        </button>
      </div>

      <div className="accounting-expense-filter-summary" aria-live="polite">
        <p>
          検索結果 <strong>{resultCount}</strong>件 / 税込合計{' '}
          <strong>{resultTotalYen.toLocaleString('ja-JP')}円</strong>
          {isFiltered ? <span className="accounting-expense-filter-badge">フィルター適用中</span> : null}
        </p>
        {activeConditionLabels.length > 0 ? (
          <div className="accounting-expense-filter-active-conditions">
            <span>現在の条件:</span>
            <ul>
              {activeConditionLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <button type="button" className="secondary-action" onClick={onClear}>
              条件をクリア
            </button>
          </div>
        ) : null}
      </div>

      {filtersExpanded ? (
        <div className="accounting-expense-filter-fields">
          <label>
            <span>支払日（開始）</span>
            <input
              type="date"
              value={filters.paymentDateFrom}
              onChange={(event) => patch({ paymentDateFrom: event.target.value })}
            />
          </label>
          <label>
            <span>支払日（終了）</span>
            <input
              type="date"
              value={filters.paymentDateTo}
              onChange={(event) => patch({ paymentDateTo: event.target.value })}
            />
          </label>
          <label>
            <span>勘定科目</span>
            <select
              value={filters.expenseCategory}
              onChange={(event) =>
                patch({ expenseCategory: event.target.value as ExpenseCategory | '' })
              }
            >
              <option value="">すべて</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>最低金額</span>
            <input
              type="number"
              inputMode="numeric"
              value={filters.amountMin}
              onChange={(event) => patch({ amountMin: event.target.value })}
              placeholder="例: 1000"
            />
          </label>
          <label>
            <span>最高金額</span>
            <input
              type="number"
              inputMode="numeric"
              value={filters.amountMax}
              onChange={(event) => patch({ amountMax: event.target.value })}
              placeholder="例: 50000"
            />
          </label>
          <label>
            <span>確認状態</span>
            <select
              value={filters.confirmationStatus}
              onChange={(event) =>
                patch({
                  confirmationStatus: event.target.value as ExpenseListConfirmationFilter,
                })
              }
            >
              {confirmationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>証憑</span>
            <select
              value={filters.hasReceipt}
              onChange={(event) =>
                patch({ hasReceipt: event.target.value as ExpenseListTriFilter })
              }
            >
              {triOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>インボイス登録</span>
            <select
              value={filters.hasInvoiceRegistration}
              onChange={(event) =>
                patch({ hasInvoiceRegistration: event.target.value as ExpenseListTriFilter })
              }
            >
              {triOptions.map((option) => (
                <option key={`invoice-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>支払方法</span>
            <select
              value={filters.paymentMethod}
              onChange={(event) =>
                patch({ paymentMethod: event.target.value as AccountingPaymentMethod | '' })
              }
            >
              <option value="">すべて</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label className="accounting-expense-filter-checkbox">
            <input
              type="checkbox"
              checked={filters.includeDeleted}
              onChange={(event) => patch({ includeDeleted: event.target.checked })}
            />
            <span>削除済みを含む</span>
          </label>
          <label>
            <span>並び替え</span>
            <select
              value={filters.sortKey}
              onChange={(event) => patch({ sortKey: event.target.value as ExpenseListSortKey })}
            >
              {sortKeyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>昇順／降順</span>
            <select
              value={filters.sortDirection}
              disabled={filters.sortKey === 'default'}
              onChange={(event) =>
                patch({ sortDirection: event.target.value as ExpenseListSortDirection })
              }
            >
              <option value="desc">降順</option>
              <option value="asc">昇順</option>
            </select>
          </label>
        </div>
      ) : null}
    </section>
  )
}

export const ExpenseListFilterPanel = memo(ExpenseListFilterPanelComponent)
