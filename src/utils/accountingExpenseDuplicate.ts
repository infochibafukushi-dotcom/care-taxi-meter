import type { StoredAccountingExpense } from '../types/accounting'
import { getExpenseReceiptDate, isConfirmedForPl } from '../types/accounting'

export type ExpenseDuplicateReason =
  | 'sameDate'
  | 'sameAmount'
  | 'sameVendor'
  | 'sameInvoiceNumber'
  | 'sameBillingInvoiceNumber'
  | 'sameImageHash'
  | 'exactBillingMatch'
  | 'sameDescription'

export type ExpenseDuplicateMatch = {
  expense: StoredAccountingExpense
  reasons: ExpenseDuplicateReason[]
  /** warning: 続行可 / strong: 画像ハッシュ等 / blocking: 仕入先×請求書番号一致で保存停止 */
  severity: 'warning' | 'strong' | 'blocking'
}

export type ExpenseDuplicateCandidate = {
  expenseId?: string
  date: string
  amount: number
  vendorName?: string
  description?: string
  /** 適格請求書発行事業者登録番号（T番号）。後方互換の照合用 */
  invoiceNumber?: string
  /** 請求書番号（仕入先の請求書・注文番号） */
  billingInvoiceNumber?: string
  imageHash?: string
}

const normalizeVendor = (value?: string) => value?.trim().toLowerCase() ?? ''
const normalizeInvoice = (value?: string) => value?.trim().toUpperCase() ?? ''
const normalizeBillingInvoice = (value?: string) => value?.trim() ?? ''
const normalizeDescription = (value?: string) => value?.trim().toLowerCase() ?? ''

const isConfirmedActiveExpense = (expense: StoredAccountingExpense) =>
  isConfirmedForPl(expense.confirmationStatus) && expense.isDeleted !== true

const isActiveExpenseForBillingCheck = (expense: StoredAccountingExpense) =>
  expense.isDeleted !== true && expense.confirmationStatus !== '無効'

/** 確定済み・未削除の経費と候補を照合し、二重計上の可能性を返す（従来ロジック） */
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
  const candidateDescription = normalizeDescription(candidate.description)

  return expenses
    .filter((expense) => expense.id !== candidate.expenseId && isConfirmedActiveExpense(expense))
    .flatMap((expense): ExpenseDuplicateMatch[] => {
      const expenseDate = getExpenseReceiptDate(expense)
      const sameDate = expenseDate === candidate.date
      const sameAmount = expense.taxIncludedAmount === candidate.amount
      const sameVendor =
        Boolean(candidateVendor) && normalizeVendor(expense.vendorName) === candidateVendor
      const sameInvoiceNumber =
        Boolean(candidateInvoice) &&
        normalizeInvoice(expense.invoiceNumber) === candidateInvoice
      const sameImageHash =
        Boolean(candidateImageHash) &&
        Boolean(expense.imageHash?.trim()) &&
        expense.imageHash?.trim() === candidateImageHash
      const sameDescription =
        Boolean(candidateDescription) &&
        normalizeDescription(expense.description) === candidateDescription

      const isMinimumMatch = sameDate && sameAmount
      const isContentWarning = sameVendor && sameDate && sameAmount && sameDescription

      if (!isMinimumMatch && !sameImageHash) {
        return []
      }

      const reasons: ExpenseDuplicateReason[] = []
      if (sameDate) reasons.push('sameDate')
      if (sameAmount) reasons.push('sameAmount')
      if (sameVendor) reasons.push('sameVendor')
      if (sameInvoiceNumber) reasons.push('sameInvoiceNumber')
      if (sameImageHash) reasons.push('sameImageHash')
      if (isContentWarning) reasons.push('sameDescription')

      return [
        {
          expense,
          reasons,
          severity: sameImageHash ? ('strong' as const) : ('warning' as const),
        },
      ]
    })
}

/**
 * 請求書番号ベースの重複判定。
 * - 取引先×請求書番号が一致 → blocking（保存停止）
 * - 請求書番号が空欄の場合は判定しない（過去データ互換）
 * - 別仕入先の同一番号は許可
 *
 * 同一請求書の明細分割登録は、請求書番号を明細ごとに区別するか空欄にする運用とする。
 * 警告無視での保存は不可。
 */
export const findBillingInvoiceDuplicates = (
  expenses: StoredAccountingExpense[],
  candidate: ExpenseDuplicateCandidate,
): ExpenseDuplicateMatch[] => {
  const candidateBilling = normalizeBillingInvoice(candidate.billingInvoiceNumber)
  if (!candidateBilling) {
    return []
  }

  const candidateVendor = normalizeVendor(candidate.vendorName)
  if (!candidateVendor) {
    return []
  }

  return expenses
    .filter((expense) => expense.id !== candidate.expenseId && isActiveExpenseForBillingCheck(expense))
    .flatMap((expense): ExpenseDuplicateMatch[] => {
      const expenseBilling = normalizeBillingInvoice(expense.billingInvoiceNumber)
      if (!expenseBilling || expenseBilling !== candidateBilling) {
        return []
      }

      const sameVendor = normalizeVendor(expense.vendorName) === candidateVendor
      if (!sameVendor) {
        return []
      }

      const reasons: ExpenseDuplicateReason[] = [
        'sameVendor',
        'sameBillingInvoiceNumber',
        'exactBillingMatch',
      ]
      const sameDate = candidate.date ? getExpenseReceiptDate(expense) === candidate.date : false
      const sameAmount =
        candidate.amount > 0 ? expense.taxIncludedAmount === candidate.amount : false
      if (sameDate) reasons.push('sameDate')
      if (sameAmount) reasons.push('sameAmount')

      return [
        {
          expense,
          reasons,
          severity: 'blocking' as const,
        },
      ]
    })
}

/** 従来照合 + 請求書番号照合をまとめて返す */
export const findExpenseDuplicatesIncludingBilling = (
  expenses: StoredAccountingExpense[],
  candidate: ExpenseDuplicateCandidate,
): ExpenseDuplicateMatch[] => {
  const byId = new Map<string, ExpenseDuplicateMatch>()

  const merge = (match: ExpenseDuplicateMatch) => {
    const existing = byId.get(match.expense.id)
    if (!existing) {
      byId.set(match.expense.id, match)
      return
    }
    const reasons = Array.from(new Set([...existing.reasons, ...match.reasons]))
    const severityRank = { warning: 1, strong: 2, blocking: 3 } as const
    const severity =
      severityRank[match.severity] > severityRank[existing.severity]
        ? match.severity
        : existing.severity
    byId.set(match.expense.id, { expense: match.expense, reasons, severity })
  }

  for (const match of findExpenseDuplicates(expenses, candidate)) {
    merge(match)
  }
  for (const match of findBillingInvoiceDuplicates(expenses, candidate)) {
    merge(match)
  }

  return Array.from(byId.values())
}

export const hasBlockingExpenseDuplicate = (matches: ExpenseDuplicateMatch[]) =>
  matches.some((match) => match.severity === 'blocking')

export const formatExpenseDuplicateLabel = (expense: StoredAccountingExpense) => {
  const date = getExpenseReceiptDate(expense)
  const vendor = expense.vendorName || '（仕入先なし）'
  const amount = expense.taxIncludedAmount
  const accountTitle = expense.expenseCategory || '（科目なし）'
  const description = expense.description?.trim() || '（内容なし）'
  const confirmation = expense.confirmationStatus || '未確認'
  const billing = expense.billingInvoiceNumber?.trim()
  const base = `${date} ${vendor} ${description} ${amount}円 ${accountTitle} [${confirmation}]`
  return billing ? `${base} 請求書:${billing}` : base
}
