import type { AccountingReceiptLegalStatus } from '../types/accountingReceiptLegal'

const ALLOWED_TRANSITIONS: Record<AccountingReceiptLegalStatus, AccountingReceiptLegalStatus[]> = {
  draft: ['image_review', 'deleted'],
  image_review: ['draft', 'legal_pending_timestamp', 'deleted'],
  legal_pending_timestamp: ['legal_saved_accounting_pending', 'deleted'],
  legal_saved_accounting_pending: ['accounting_confirmed', 'deleted'],
  accounting_confirmed: ['deleted'],
  late_saved: ['deleted'],
  deleted: [],
}

export function canTransitionAccountingReceiptLegalStatus(
  from: AccountingReceiptLegalStatus,
  to: AccountingReceiptLegalStatus,
): boolean {
  if (from === to) {
    return true
  }
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransitionAccountingReceiptLegalStatus(
  from: AccountingReceiptLegalStatus,
  to: AccountingReceiptLegalStatus,
): void {
  if (!canTransitionAccountingReceiptLegalStatus(from, to)) {
    throw new Error(`不正な法定ステータス遷移です: ${from} → ${to}`)
  }
}

/** 正式保存準備前（端末内のみ想定）は完全破棄可能 */
export function canDiscardReceiptScanSession(legalStatus: AccountingReceiptLegalStatus | undefined) {
  return !legalStatus || legalStatus === 'draft' || legalStatus === 'image_review'
}
