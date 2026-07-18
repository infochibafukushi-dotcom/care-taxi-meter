import type { StoredAccountingExpense, StoredAccountingReceipt } from '../types/accounting'
import { isFranchiseeOwnerRole, isHqRole } from '../services/tenancy'

export const IMAGE_HARD_DELETE_CONFIRM_MESSAGE =
  'この画像は削除後に復元できません。完全に削除しますか？'

export const IMAGE_SOFT_HIDE_MESSAGE =
  'この証憑は経理記録に紐付いているため完全削除できません。非表示・無効化のみ行います。'

export const IMAGE_SOFT_HIDE_DELETE_REASON = 'accounting_linked_evidence_soft_hide'

export type AccountingImageDeleteAction = 'hard_delete' | 'soft_hide'

export type AccountingImageDeleteDecision = {
  action: AccountingImageDeleteAction
  reason:
    | 'unorganized_never_linked'
    | 'linked_to_expense'
    | 'confirmed_receipt'
    | 'fixed_asset_evidence'
    | 'invoice_or_accounting_status'
    | 'already_hidden'
}

const hasLinkedExpenseId = (receipt: Pick<StoredAccountingReceipt, 'linkedExpenseId'>) =>
  Boolean(receipt.linkedExpenseId?.trim())

const isAlreadyHidden = (
  receipt: Pick<StoredAccountingReceipt, 'status' | 'receiptStatus' | 'deletedAt'>,
) =>
  Boolean(receipt.deletedAt?.trim()) ||
  receipt.status === 'invalid' ||
  receipt.receiptStatus === 'rejected'

/**
 * 即時完全削除を許可するのは、経費へ一度も紐付いていない未整理証憑のみ。
 * 経理紐付・確認済み・固定資産取得証憑・リンク切れ（過去に紐付）は soft-hide。
 */
export function resolveAccountingImageDeleteAction(
  receipt: Pick<
    StoredAccountingReceipt,
    'status' | 'receiptStatus' | 'linkedExpenseId' | 'deletedAt'
  >,
  options?: {
    linkedExpense?: Pick<
      StoredAccountingExpense,
      'linkedAssetId' | 'confirmationStatus' | 'receiptId'
    > | null
  },
): AccountingImageDeleteDecision {
  if (isAlreadyHidden(receipt)) {
    return { action: 'soft_hide', reason: 'already_hidden' }
  }

  const linkedExpense = options?.linkedExpense ?? null
  if (linkedExpense?.linkedAssetId?.trim()) {
    return { action: 'soft_hide', reason: 'fixed_asset_evidence' }
  }

  if (receipt.status === 'linked' || hasLinkedExpenseId(receipt)) {
    return { action: 'soft_hide', reason: 'linked_to_expense' }
  }

  if (receipt.receiptStatus === 'confirmed') {
    return { action: 'soft_hide', reason: 'confirmed_receipt' }
  }

  if (linkedExpense && linkedExpense.confirmationStatus === '確認済み') {
    return { action: 'soft_hide', reason: 'invoice_or_accounting_status' }
  }

  if (receipt.status === 'unorganized') {
    return { action: 'hard_delete', reason: 'unorganized_never_linked' }
  }

  return { action: 'soft_hide', reason: 'invoice_or_accounting_status' }
}

export function canHardDeleteAccountingImage(
  receipt: Pick<
    StoredAccountingReceipt,
    'status' | 'receiptStatus' | 'linkedExpenseId' | 'deletedAt'
  >,
  options?: {
    linkedExpense?: Pick<
      StoredAccountingExpense,
      'linkedAssetId' | 'confirmationStatus' | 'receiptId'
    > | null
  },
): boolean {
  return resolveAccountingImageDeleteAction(receipt, options).action === 'hard_delete'
}

export function assertTenantCanDeleteAccountingImage(
  receipt: Pick<StoredAccountingReceipt, 'franchiseeId' | 'companyId' | 'storeId'>,
  scope: { franchiseeId?: string; storeId?: string; role?: string } | undefined,
): void {
  if (!scope) {
    return
  }

  if (isHqRole(scope.role)) {
    return
  }

  const scopeFranchisee = scope.franchiseeId?.trim()
  const receiptFranchisee = (receipt.franchiseeId || receipt.companyId || '').trim()
  if (scopeFranchisee && receiptFranchisee && scopeFranchisee !== receiptFranchisee) {
    throw new Error('他加盟店の画像は削除できません。')
  }

  const scopeStore = scope.storeId?.trim()
  const receiptStore = receipt.storeId?.trim()
  if (
    scopeStore &&
    receiptStore &&
    scopeStore !== receiptStore &&
    !isFranchiseeOwnerRole(scope.role)
  ) {
    throw new Error('他店舗の画像は削除できません。')
  }
}
