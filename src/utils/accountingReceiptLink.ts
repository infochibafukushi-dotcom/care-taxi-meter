import type { StoredAccountingExpense, StoredAccountingReceipt } from '../types/accounting'
import {
  isExpenseDeleted,
  mapLegacyStatusToWorkflow,
} from '../types/accounting'

export type AccountingReceiptInboxKind = 'unorganized' | 'orphan'

export type AccountingReceiptInboxEntry = {
  kind: AccountingReceiptInboxKind
  receipt: StoredAccountingReceipt
}

const isInvalidatedReceipt = (receipt: StoredAccountingReceipt) =>
  receipt.status === 'invalid' || receipt.receiptStatus === 'rejected'

/** 証憑リンク対象として有効な経費か（削除・無効は対象外） */
export const isExpenseEligibleForReceiptLink = (
  expense: Pick<StoredAccountingExpense, 'confirmationStatus' | 'isDeleted'>,
) => !isExpenseDeleted(expense) && expense.confirmationStatus !== '無効'

/**
 * linkedExpenseId があるが参照先が不正なリンク切れ証憑。
 * - 対象経費が存在しない
 * - 削除済み
 * - 無効化済み（証憑リンク対象外）
 * - 経費側 receiptId が別証憑を参照している
 *
 * 一方向リンク（経費側 receiptId 未設定）は正常扱い。
 * 無効化された証憑自体は対象外。
 */
export const isOrphanLinkedReceipt = (
  receipt: Pick<StoredAccountingReceipt, 'id' | 'status' | 'receiptStatus' | 'linkedExpenseId'>,
  expensesById: Map<string, StoredAccountingExpense>,
): boolean => {
  if (isInvalidatedReceipt(receipt as StoredAccountingReceipt)) {
    return false
  }

  const linkedExpenseId = receipt.linkedExpenseId?.trim()
  if (!linkedExpenseId) {
    return false
  }

  const expense = expensesById.get(linkedExpenseId)
  if (!expense) {
    return true
  }
  if (!isExpenseEligibleForReceiptLink(expense)) {
    return true
  }

  const expenseReceiptId = expense.receiptId?.trim()
  if (expenseReceiptId && expenseReceiptId !== receipt.id) {
    return true
  }

  return false
}

export const isPlainUnorganizedReceipt = (
  receipt: Pick<
    StoredAccountingReceipt,
    'status' | 'receiptStatus' | 'linkedExpenseId' | 'ocrCandidates' | 'ocrRawText'
  >,
): boolean => {
  if (receipt.status !== 'unorganized') {
    return false
  }
  const workflow =
    receipt.receiptStatus ??
    mapLegacyStatusToWorkflow(
      receipt.status,
      Boolean(receipt.ocrCandidates || receipt.ocrRawText),
      receipt.linkedExpenseId,
    )
  return workflow === 'draft' || workflow === 'ocr_ready'
}

export const buildExpensesById = (expenses: StoredAccountingExpense[]) =>
  new Map(expenses.map((expense) => [expense.id, expense]))

/** 未整理画面用: 通常未整理 + リンク切れ */
export const selectAccountingReceiptInbox = (
  receipts: StoredAccountingReceipt[],
  expenses: StoredAccountingExpense[],
): AccountingReceiptInboxEntry[] => {
  const expensesById = buildExpensesById(expenses)
  const entries: AccountingReceiptInboxEntry[] = []

  for (const receipt of receipts) {
    if (isOrphanLinkedReceipt(receipt, expensesById)) {
      entries.push({ kind: 'orphan', receipt })
      continue
    }
    if (isPlainUnorganizedReceipt(receipt)) {
      entries.push({ kind: 'unorganized', receipt })
    }
  }

  return entries
}

export const ORPHAN_RECEIPT_WARNING =
  '経費へのリンクが残っていますが、参照先経費が存在しません。'
