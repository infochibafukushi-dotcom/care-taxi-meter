import type { StoredAccountingExpense } from '../types/accounting'
import {
  getExpenseGroupTypeLabel,
  type ExpenseGroupType,
  type StoredAccountingExpenseGroup,
} from '../types/accountingExpenseGroup'
import { getExpenseReceiptDate, isExpenseDeleted } from '../types/accounting'

export type ExpenseGroupDateRange = {
  startDate: string | null
  endDate: string | null
}

/** 領収書日付（YYYY-MM-DD）から開始・終了を算出 */
export const computeExpenseGroupDateRange = (
  dates: Array<string | null | undefined>,
): ExpenseGroupDateRange => {
  const valid = dates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()

  if (valid.length === 0) {
    return { startDate: null, endDate: null }
  }

  return {
    startDate: valid[0] ?? null,
    endDate: valid[valid.length - 1] ?? null,
  }
}

/** 明細の確定税込金額合計（保存・表示の両方で使用） */
export const sumExpenseGroupLineAmounts = (
  amounts: Array<number | null | undefined>,
): number =>
  amounts.reduce<number>((total, amount) => {
    const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
    return total + Math.max(0, Math.round(value))
  }, 0)

/** YYYY-MM-DD → 2026年8月31日 */
export const formatExpenseGroupDateJa = (ymd: string | null | undefined): string => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return '―'
  }
  const [year, month, day] = ymd.split('-')
  return `${Number(year)}年${Number(month)}月${Number(day)}日`
}

/** 同一日は単一日付、複数日は「開始～終了」 */
export const formatExpenseGroupPeriodLabel = (
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string => {
  if (!startDate && !endDate) {
    return '―'
  }
  if (!startDate) {
    return formatExpenseGroupDateJa(endDate)
  }
  if (!endDate || startDate === endDate) {
    return formatExpenseGroupDateJa(startDate)
  }
  return `${formatExpenseGroupDateJa(startDate)}～${formatExpenseGroupDateJa(endDate)}`
}

export type GroupedExpenseListItem = {
  kind: 'group'
  group: StoredAccountingExpenseGroup
  expenses: StoredAccountingExpense[]
  /** 一覧表示用の代表年月（開始日優先） */
  sortDate: string
}

export type StandaloneExpenseListItem = {
  kind: 'expense'
  expense: StoredAccountingExpense
  sortDate: string
}

export type ExpenseListDisplayItem = GroupedExpenseListItem | StandaloneExpenseListItem

/**
 * 経費一覧用: まとめ経費は1件のグループ、通常経費は単独。
 * グループ配下の明細は単独行に出さない。
 */
export const buildExpenseListDisplayItems = ({
  expenses,
  groups,
  targetYearMonth,
}: {
  expenses: StoredAccountingExpense[]
  groups: StoredAccountingExpenseGroup[]
  targetYearMonth?: string
}): ExpenseListDisplayItem[] => {
  const activeExpenses = expenses.filter((expense) => !isExpenseDeleted(expense))
  const groupById = new Map(
    groups
      .filter((group) => group.isDeleted !== true && group.confirmationStatus !== '無効')
      .map((group) => [group.id, group]),
  )

  const expensesByGroupId = new Map<string, StoredAccountingExpense[]>()
  const standalone: StoredAccountingExpense[] = []

  for (const expense of activeExpenses) {
    const groupId = expense.expenseGroupId?.trim()
    if (groupId && groupById.has(groupId)) {
      const list = expensesByGroupId.get(groupId) ?? []
      list.push(expense)
      expensesByGroupId.set(groupId, list)
      continue
    }
    standalone.push(expense)
  }

  const items: ExpenseListDisplayItem[] = []

  for (const [groupId, groupExpenses] of expensesByGroupId) {
    const group = groupById.get(groupId)
    if (!group) {
      continue
    }

    const inMonth =
      !targetYearMonth ||
      groupExpenses.some((expense) =>
        getExpenseReceiptDate(expense).startsWith(targetYearMonth),
      ) ||
      (group.startDate ?? '').startsWith(targetYearMonth) ||
      (group.endDate ?? '').startsWith(targetYearMonth)

    if (!inMonth) {
      continue
    }

    items.push({
      kind: 'group',
      group,
      expenses: groupExpenses,
      sortDate: group.endDate || group.startDate || getExpenseReceiptDate(groupExpenses[0]!) || '',
    })
  }

  for (const expense of standalone) {
    if (targetYearMonth && !getExpenseReceiptDate(expense).startsWith(targetYearMonth)) {
      // monthExpenses は postingDate 基準で渡される想定。ここでも年月外は除外。
      const posting = expense.postingDate || expense.transactionDate || ''
      if (!posting.startsWith(targetYearMonth)) {
        continue
      }
    }
    items.push({
      kind: 'expense',
      expense,
      sortDate: getExpenseReceiptDate(expense) || '',
    })
  }

  return items.sort((a, b) => b.sortDate.localeCompare(a.sortDate))
}

export const describeExpenseGroupSummary = ({
  title,
  groupType,
  startDate,
  endDate,
  totalAmount,
  receiptCount,
}: {
  title: string
  groupType: ExpenseGroupType
  startDate: string | null
  endDate: string | null
  totalAmount: number
  receiptCount: number
}) => ({
  title: title.trim() || '（件名未入力）',
  periodLabel: formatExpenseGroupPeriodLabel(startDate, endDate),
  groupTypeLabel: getExpenseGroupTypeLabel(groupType),
  totalAmount,
  receiptCount,
})

export type ExpenseGroupValidationError = {
  field: string
  message: string
}

export const validateExpenseGroupForSave = ({
  title,
  lines,
  clientTotalAmount,
}: {
  title: string
  lines: Array<{
    taxIncludedAmount: number
    receiptDate: string
    expenseCategory: string
  }>
  clientTotalAmount?: number
}): ExpenseGroupValidationError[] => {
  const errors: ExpenseGroupValidationError[] = []

  if (!title.trim()) {
    errors.push({ field: 'title', message: '件名は必須です。' })
  }

  if (lines.length < 1) {
    errors.push({ field: 'receipts', message: '領収書は最低1件必要です。' })
  }

  lines.forEach((line, index) => {
    const label = `領収書${index + 1}`
    if (!(line.taxIncludedAmount > 0)) {
      errors.push({
        field: `lines[${index}].amount`,
        message: `${label}の確定金額は0円より大きい必要があります。`,
      })
    }
    if (!line.receiptDate.trim()) {
      errors.push({
        field: `lines[${index}].date`,
        message: `${label}の日付は必須です。`,
      })
    }
    if (!line.expenseCategory.trim()) {
      errors.push({
        field: `lines[${index}].category`,
        message: `${label}の勘定科目は必須です。`,
      })
    }
  })

  const serverTotal = sumExpenseGroupLineAmounts(lines.map((line) => line.taxIncludedAmount))
  if (
    typeof clientTotalAmount === 'number' &&
    Number.isFinite(clientTotalAmount) &&
    Math.round(clientTotalAmount) !== serverTotal
  ) {
    errors.push({
      field: 'totalAmount',
      message: '合計金額が明細合計と一致しません。画面を更新して再度保存してください。',
    })
  }

  return errors
}
