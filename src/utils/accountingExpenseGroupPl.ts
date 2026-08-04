import type { AccountingExpenseInput, StoredAccountingExpense } from '../types/accounting'
import { isExpenseEligibleForReporting } from '../types/accounting'
import {
  computeExpenseGroupDateRange,
  sumExpenseGroupLineAmounts,
} from './accountingExpenseGroup'
import { getCompanyFiscalPeriod, resolveFiscalYearForDate } from './accountingFiscalPeriod'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getExpenseReceiptDate } from '../types/accounting'

/**
 * PL 集計は経費明細単位のみ。まとめ経費親は accountingExpenses に存在しないため
 * 二重計上されない。グループ配下明細も通常経費と同じ条件で集計対象。
 */
export const isGroupedExpenseLineEligibleForPl = (
  expense: Pick<StoredAccountingExpense, 'confirmationStatus' | 'isDeleted'>,
) => isExpenseEligibleForReporting(expense)

/** 月またぎ・決算またぎ検証用: 明細を年月ごとに合計（postingDate 基準） */
export const aggregateGroupedExpenseAmountsByPostingMonth = (
  expenses: Array<
    Pick<AccountingExpenseInput, 'postingDate' | 'transactionDate' | 'taxIncludedAmount'>
  >,
): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const expense of expenses) {
    const postingDate = expense.postingDate || expense.transactionDate
    const month = postingDate.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      continue
    }
    result[month] = (result[month] ?? 0) + Math.max(0, Math.round(expense.taxIncludedAmount || 0))
  }
  return result
}

/** 事業年度ラベル（決算月またぎ確認用） */
export const resolveFiscalYearLabelForExpenseDate = (ymd: string): string | null => {
  const fiscalYear = resolveFiscalYearForDate(COMPANY_FISCAL_POLICY, ymd)
  if (fiscalYear == null) {
    return null
  }
  const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, fiscalYear)
  return period?.label ?? null
}

export const recomputeExpenseGroupTotalsFromLines = (
  lines: Array<
    Pick<
      AccountingExpenseInput,
      'receiptDate' | 'postingDate' | 'transactionDate' | 'taxIncludedAmount'
    >
  >,
) => {
  const range = computeExpenseGroupDateRange(
    lines.map((line) => getExpenseReceiptDate(line) || line.receiptDate || line.postingDate),
  )
  return {
    ...range,
    totalAmount: sumExpenseGroupLineAmounts(lines.map((line) => line.taxIncludedAmount)),
  }
}
