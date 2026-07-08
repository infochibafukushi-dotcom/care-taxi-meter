import { describe, expect, it } from 'vitest'
import {
  CARE_TAXI_EXPENSE_EXAMPLES,
  EXPENSE_CATEGORY_HELP_ROWS,
  filterCareTaxiExpenseExamples,
  filterExpenseCategoryHelpRows,
} from './expenseCategoryHelp'

describe('expenseCategoryHelp', () => {
  it('空の検索語では全件を返す', () => {
    expect(filterExpenseCategoryHelpRows(EXPENSE_CATEGORY_HELP_ROWS, '')).toHaveLength(
      EXPENSE_CATEGORY_HELP_ROWS.length,
    )
    expect(filterCareTaxiExpenseExamples(CARE_TAXI_EXPENSE_EXAMPLES, '  ')).toHaveLength(
      CARE_TAXI_EXPENSE_EXAMPLES.length,
    )
  })

  it('「車検」で車検・保険・租税関連がヒットする', () => {
    const matched = filterExpenseCategoryHelpRows(EXPENSE_CATEGORY_HELP_ROWS, '車検')
    const categories = matched.map((row) => row.category)

    expect(categories).toEqual(
      expect.arrayContaining(['車検・法定点検費', '車両保険・任意保険', '自動車税・重量税']),
    )
  })

  it('介護タクシー例も「車検」で絞り込める', () => {
    const matched = filterCareTaxiExpenseExamples(CARE_TAXI_EXPENSE_EXAMPLES, '車検')
    const expenditures = matched.map((row) => row.expenditure)

    expect(expenditures).toEqual(
      expect.arrayContaining(['車検整備代', '自賠責保険', '重量税・印紙']),
    )
  })
})
