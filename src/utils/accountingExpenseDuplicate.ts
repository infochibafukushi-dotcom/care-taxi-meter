import type { StoredAccountingExpense } from '../types/accounting'
import { getExpenseReceiptDate, isConfirmedForPl } from '../types/accounting'

export type ExpenseDuplicateReason =
  | 'sameDate'
  | 'sameAmount'
  | 'sameVendor'
  | 'sameInvoiceNumber'
  | 'sameImageHash'

export type ExpenseDuplicateMatch = {
  expense: StoredAccountingExpense
  reasons: ExpenseDuplicateReason[]
  severity: 'warning' | 'strong'
}

export type ExpenseDuplicateCandidate = {
  expenseId?: string
  date: string
  amount: number
  vendorName?: string
  invoiceNumber?: string
  imageHash?: string
}

const normalizeVendor = (value?: string) => value?.trim().toLowerCase() ?? ''
const normalizeInvoice = (value?: string) => value?.trim().toUpperCase() ?? ''

const isConfirmedActiveExpense = (expense: StoredAccountingExpense) =>
  isConfirmedForPl(expense.confirmationStatus) && expense.isDeleted !== true

/** 確定済み・未削除の経費と候補を照合し、二重計上の可能性を返す */
export const findExpenseDuplicates = (
  expenses: StoredAccountingExpense[],
  candidate: ExpenseDuplicateCandidate,
): ExpenseDuplicateMatch[] => {
  if (!candidate.date || candidate.amount <= 0) {
    return []
  }

  const candidateVendor = normalizeVendor(candidate.vendorName)
  const candidateInvoice = normalizeInvoice(candidate.invoiceNumber)
  const candidateImageHash = candidate.imageHash?.trim() ?? ''

  return expenses
    .filter((expense) => expense.id !== candidate.expenseId && isConfirmedActiveExpense(expense))
    .map((expense) => {
      const expenseDate = getExpenseReceiptDate(expense)
      const sameDate = expenseDate === candidate.date
      const sameAmount = expense.taxIncludedAmount === candidate.amount
      const sameVendor =
        Boolean(candidateVendor) &&
        normalizeVendor(expense.vendorName) === candidateVendor
      const sameInvoiceNumber =
        Boolean(candidateInvoice) &&
        normalizeInvoice(expense.invoiceNumber) === candidateInvoice
      const sameImageHash =
        Boolean(candidateImageHash) &&
        Boolean(expense.imageHash?.trim()) &&
        expense.imageHash?.trim() === candidateImageHash

      const isMinimumMatch = sameDate && sameAmount

      if (!isMinimumMatch && !sameImageHash) {
        return null
      }

      const reasons: ExpenseDuplicateReason[] = []
      if (sameDate) reasons.push('sameDate')
      if (sameAmount) reasons.push('sameAmount')
      if (sameVendor) reasons.push('sameVendor')
      if (sameInvoiceNumber) reasons.push('sameInvoiceNumber')
      if (sameImageHash) reasons.push('sameImageHash')

      return {
        expense,
        reasons,
        severity: sameImageHash ? ('strong' as const) : ('warning' as const),
      }
    })
    .filter((match): match is ExpenseDuplicateMatch => match !== null)
}

export const formatExpenseDuplicateLabel = (expense: StoredAccountingExpense) => {
  const date = getExpenseReceiptDate(expense)
  const vendor = expense.vendorName || '（仕入先なし）'
  const amount = expense.taxIncludedAmount
  const accountTitle = expense.expenseCategory || '（科目なし）'
  return `${date} ${vendor} ${amount}円 ${accountTitle}`
}
