import {
  getExpensePostingDate,
  isExpenseDeleted,
  normalizeInvoiceStatus,
  type AccountingPaymentMethod,
  type ExpenseCategory,
  type ExpenseConfirmationStatus,
  type StoredAccountingExpense,
} from '../types/accounting'
import { hasExpenseReceiptAttachment } from './accountingExpenseListDisplay'

/** 三値フィルター（あり／なし／すべて） */
export type ExpenseListTriFilter = 'all' | 'yes' | 'no'

/** 確認状態フィルター */
export type ExpenseListConfirmationFilter = 'all' | '確認済み' | '未確認'

/** 並び替えキー。default は取得順（現行の transactionDate 降順）を維持 */
export type ExpenseListSortKey =
  | 'default'
  | 'paymentDate'
  | 'amount'
  | 'createdAt'
  | 'updatedAt'

export type ExpenseListSortDirection = 'asc' | 'desc'

export type ExpenseListFilters = {
  /** 部分一致検索（支払先・摘要・請求書番号・メモ・金額） */
  searchQuery: string
  /** 支払日（帳簿日付）開始 YYYY-MM-DD */
  paymentDateFrom: string
  /** 支払日（帳簿日付）終了 YYYY-MM-DD */
  paymentDateTo: string
  /** 勘定科目。空文字はすべて */
  expenseCategory: ExpenseCategory | ''
  /** 最低金額（税込）。空文字は未指定 */
  amountMin: string
  /** 最高金額（税込）。空文字は未指定 */
  amountMax: string
  confirmationStatus: ExpenseListConfirmationFilter
  hasReceipt: ExpenseListTriFilter
  hasInvoiceRegistration: ExpenseListTriFilter
  /** 支払方法。空文字はすべて */
  paymentMethod: AccountingPaymentMethod | ''
  /** true のとき削除済みを含む */
  includeDeleted: boolean
  sortKey: ExpenseListSortKey
  sortDirection: ExpenseListSortDirection
}

export const DEFAULT_EXPENSE_LIST_FILTERS: ExpenseListFilters = {
  searchQuery: '',
  paymentDateFrom: '',
  paymentDateTo: '',
  expenseCategory: '',
  amountMin: '',
  amountMax: '',
  confirmationStatus: 'all',
  hasReceipt: 'all',
  hasInvoiceRegistration: 'all',
  paymentMethod: '',
  includeDeleted: false,
  sortKey: 'default',
  sortDirection: 'desc',
}

export type ExpenseListQueryResult = {
  items: StoredAccountingExpense[]
  totalCount: number
  totalTaxIncludedAmount: number
  activeConditionLabels: string[]
  isFiltered: boolean
}

/**
 * 英数字の半角・全角、大文字・小文字を可能な範囲で吸収する正規化。
 * NFKC で全角英数を半角化し、小文字化する。
 */
export const normalizeExpenseSearchText = (value: string): string =>
  value.normalize('NFKC').toLowerCase().trim()

const parseOptionalAmount = (raw: string): number | null => {
  const normalized = normalizeExpenseSearchText(raw).replace(/,/g, '')
  if (!normalized) {
    return null
  }
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

const hasInvoiceRegistration = (expense: StoredAccountingExpense): boolean => {
  const status = normalizeInvoiceStatus(expense.invoiceStatus)
  if (status === 'verified') {
    return true
  }
  return Boolean(expense.invoiceNumber?.trim())
}

const matchesSearchQuery = (expense: StoredAccountingExpense, rawQuery: string): boolean => {
  const query = normalizeExpenseSearchText(rawQuery)
  if (!query) {
    return true
  }

  const haystacks = [
    expense.vendorName,
    expense.description,
    expense.billingInvoiceNumber ?? '',
    expense.memo ?? '',
    String(expense.taxIncludedAmount ?? ''),
  ]

  return haystacks.some((field) => normalizeExpenseSearchText(String(field ?? '')).includes(query))
}

const matchesTriFilter = (value: boolean, filter: ExpenseListTriFilter): boolean => {
  if (filter === 'all') {
    return true
  }
  return filter === 'yes' ? value : !value
}

const getSortTimestamp = (value: string | undefined): number => {
  if (!value) {
    return 0
  }
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

const compareExpenses = (
  left: StoredAccountingExpense,
  right: StoredAccountingExpense,
  sortKey: ExpenseListSortKey,
  sortDirection: ExpenseListSortDirection,
): number => {
  if (sortKey === 'default') {
    return 0
  }

  const direction = sortDirection === 'asc' ? 1 : -1

  if (sortKey === 'amount') {
    return (left.taxIncludedAmount - right.taxIncludedAmount) * direction
  }

  if (sortKey === 'paymentDate') {
    return getExpensePostingDate(left).localeCompare(getExpensePostingDate(right), 'ja') * direction
  }

  if (sortKey === 'createdAt') {
    return (getSortTimestamp(left.createdAt) - getSortTimestamp(right.createdAt)) * direction
  }

  return (getSortTimestamp(left.updatedAt) - getSortTimestamp(right.updatedAt)) * direction
}

export const isExpenseListFilterActive = (filters: ExpenseListFilters): boolean => {
  if (filters.searchQuery.trim()) return true
  if (filters.paymentDateFrom.trim()) return true
  if (filters.paymentDateTo.trim()) return true
  if (filters.expenseCategory) return true
  if (filters.amountMin.trim()) return true
  if (filters.amountMax.trim()) return true
  if (filters.confirmationStatus !== 'all') return true
  if (filters.hasReceipt !== 'all') return true
  if (filters.hasInvoiceRegistration !== 'all') return true
  if (filters.paymentMethod) return true
  if (filters.includeDeleted) return true
  if (filters.sortKey !== 'default') return true
  if (filters.sortKey === 'default' && filters.sortDirection !== 'desc') return true
  return false
}

export const describeExpenseListFilters = (filters: ExpenseListFilters): string[] => {
  const labels: string[] = []
  const query = filters.searchQuery.trim()
  if (query) {
    labels.push(`検索: ${query}`)
  }
  if (filters.paymentDateFrom.trim() || filters.paymentDateTo.trim()) {
    const from = filters.paymentDateFrom.trim() || '（開始なし）'
    const to = filters.paymentDateTo.trim() || '（終了なし）'
    labels.push(`支払日: ${from} 〜 ${to}`)
  }
  if (filters.expenseCategory) {
    labels.push(`科目: ${filters.expenseCategory}`)
  }
  if (filters.amountMin.trim() || filters.amountMax.trim()) {
    const min = filters.amountMin.trim() || '（下限なし）'
    const max = filters.amountMax.trim() || '（上限なし）'
    labels.push(`金額: ${min} 〜 ${max}`)
  }
  if (filters.confirmationStatus !== 'all') {
    labels.push(`確認: ${filters.confirmationStatus}`)
  }
  if (filters.hasReceipt !== 'all') {
    labels.push(`証憑: ${filters.hasReceipt === 'yes' ? 'あり' : 'なし'}`)
  }
  if (filters.hasInvoiceRegistration !== 'all') {
    labels.push(`インボイス登録: ${filters.hasInvoiceRegistration === 'yes' ? 'あり' : 'なし'}`)
  }
  if (filters.paymentMethod) {
    labels.push(`支払方法: ${filters.paymentMethod}`)
  }
  if (filters.includeDeleted) {
    labels.push('削除済みを含む')
  }
  if (filters.sortKey !== 'default') {
    const sortLabel =
      filters.sortKey === 'paymentDate'
        ? '支払日'
        : filters.sortKey === 'amount'
          ? '金額'
          : filters.sortKey === 'createdAt'
            ? '登録日時'
            : '更新日時'
    labels.push(`並び替え: ${sortLabel}（${filters.sortDirection === 'asc' ? '昇順' : '降順'}）`)
  }
  return labels
}

/**
 * 取得済み経費配列に対するクライアント側の検索・絞り込み・並び替え。
 * Firestore 再取得は行わない。将来のページング移行時は items をページ単位で切り出せる。
 */
export const queryExpenseList = (
  expenses: StoredAccountingExpense[],
  targetYearMonth: string,
  filters: ExpenseListFilters,
): ExpenseListQueryResult => {
  const amountMin = parseOptionalAmount(filters.amountMin)
  const amountMax = parseOptionalAmount(filters.amountMax)
  const paymentDateFrom = filters.paymentDateFrom.trim()
  const paymentDateTo = filters.paymentDateTo.trim()

  const filtered = expenses.filter((expense) => {
    if (!getExpensePostingDate(expense).startsWith(targetYearMonth)) {
      return false
    }
    if (!filters.includeDeleted && isExpenseDeleted(expense)) {
      return false
    }
    if (!matchesSearchQuery(expense, filters.searchQuery)) {
      return false
    }

    const paymentDate = getExpensePostingDate(expense)
    if (paymentDateFrom && paymentDate < paymentDateFrom) {
      return false
    }
    if (paymentDateTo && paymentDate > paymentDateTo) {
      return false
    }

    if (filters.expenseCategory && expense.expenseCategory !== filters.expenseCategory) {
      return false
    }

    if (amountMin !== null && expense.taxIncludedAmount < amountMin) {
      return false
    }
    if (amountMax !== null && expense.taxIncludedAmount > amountMax) {
      return false
    }

    if (filters.confirmationStatus !== 'all') {
      const status = expense.confirmationStatus as ExpenseConfirmationStatus | string
      if (status !== filters.confirmationStatus) {
        return false
      }
    }

    if (!matchesTriFilter(hasExpenseReceiptAttachment(expense), filters.hasReceipt)) {
      return false
    }

    if (!matchesTriFilter(hasInvoiceRegistration(expense), filters.hasInvoiceRegistration)) {
      return false
    }

    if (filters.paymentMethod && expense.paymentMethod !== filters.paymentMethod) {
      return false
    }

    return true
  })

  const items =
    filters.sortKey === 'default'
      ? filtered
      : [...filtered].sort((left, right) =>
          compareExpenses(left, right, filters.sortKey, filters.sortDirection),
        )

  const totalTaxIncludedAmount = items.reduce((sum, expense) => sum + (expense.taxIncludedAmount || 0), 0)
  const activeConditionLabels = describeExpenseListFilters(filters)
  const isFiltered = isExpenseListFilterActive(filters)

  return {
    items,
    totalCount: items.length,
    totalTaxIncludedAmount,
    activeConditionLabels,
    isFiltered,
  }
}

/** CSV「絞り込み結果」用。確認済み・未削除のみ（既存CSV方針を維持） */
export const selectExpensesForFilteredCsv = (
  filteredItems: StoredAccountingExpense[],
): StoredAccountingExpense[] =>
  filteredItems.filter((expense) => !isExpenseDeleted(expense) && expense.confirmationStatus === '確認済み')
