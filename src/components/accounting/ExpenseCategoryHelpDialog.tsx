import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  CARE_TAXI_EXPENSE_EXAMPLES,
  EXPENSE_CATEGORY_HELP_ROWS,
  filterCareTaxiExpenseExamples,
  filterExpenseCategoryHelpRows,
} from '../../utils/expenseCategoryHelp'

type ExpenseCategoryHelpDialogProps = {
  open: boolean
  onClose: () => void
}

export function ExpenseCategoryHelpDialog({ open, onClose }: ExpenseCategoryHelpDialogProps) {
  const titleId = useId()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredCategoryRows = useMemo(
    () => filterExpenseCategoryHelpRows(EXPENSE_CATEGORY_HELP_ROWS, searchQuery),
    [searchQuery],
  )
  const filteredCareTaxiRows = useMemo(
    () => filterCareTaxiExpenseExamples(CARE_TAXI_EXPENSE_EXAMPLES, searchQuery),
    [searchQuery],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    setSearchQuery('')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div
      className="accounting-expense-category-help-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="accounting-expense-category-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="accounting-expense-category-help-header">
          <h3 id={titleId}>経費科目の一覧と使用例</h3>
          <button
            type="button"
            className="accounting-expense-category-help-close"
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>
        </header>

        <label className="accounting-expense-category-help-search">
          検索
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="例：車検、ガソリン、名刺"
            autoComplete="off"
          />
        </label>

        <div className="accounting-expense-category-help-body">
          <section className="accounting-expense-category-help-section">
            <h4>科目一覧</h4>
            {filteredCategoryRows.length > 0 ? (
              <div className="accounting-expense-category-help-table-wrap">
                <table className="accounting-expense-category-help-table">
                  <thead>
                    <tr>
                      <th scope="col">科目</th>
                      <th scope="col">使用例</th>
                      <th scope="col">注意点</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCategoryRows.map((row) => (
                      <tr key={row.category}>
                        <th scope="row">{row.category}</th>
                        <td>{row.examples}</td>
                        <td>{row.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="accounting-note">該当する科目がありません。</p>
            )}
          </section>

          <section className="accounting-expense-category-help-section accounting-expense-category-help-care-taxi">
            <h4>介護タクシーでよく使う科目</h4>
            {filteredCareTaxiRows.length > 0 ? (
              <div className="accounting-expense-category-help-table-wrap">
                <table className="accounting-expense-category-help-table">
                  <thead>
                    <tr>
                      <th scope="col">支出内容</th>
                      <th scope="col">推奨科目</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCareTaxiRows.map((row) => (
                      <tr key={row.expenditure}>
                        <th scope="row">{row.expenditure}</th>
                        <td>{row.recommendedCategory}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="accounting-note">該当する使用例がありません。</p>
            )}
          </section>
        </div>

        <footer className="accounting-expense-category-help-footer">
          <button type="button" className="secondary-action" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>
  )
}
