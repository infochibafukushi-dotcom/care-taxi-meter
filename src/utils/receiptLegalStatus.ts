import type {
  AccountingReceiptLegalStatus,
  AccountingReceiptTimestampStatus,
} from '../types/accountingReceiptLegal'

const ALLOWED_TRANSITIONS: Record<AccountingReceiptLegalStatus, AccountingReceiptLegalStatus[]> = {
  draft: ['image_review', 'deleted'],
  image_review: ['draft', 'legal_pending_timestamp', 'deleted'],
  legal_pending_timestamp: [
    'legal_saved_accounting_pending',
    'late_saved',
    'deleted',
  ],
  legal_saved_accounting_pending: ['accounting_confirmed', 'deleted'],
  accounting_confirmed: ['deleted'],
  late_saved: ['accounting_confirmed', 'deleted'],
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

/** 正式タイムスタンプ発行前は完全破棄可能 */
export function canHardDeleteScannerReceipt(input: {
  legalStatus?: AccountingReceiptLegalStatus
  timestampStatus?: AccountingReceiptTimestampStatus
}): boolean {
  if (input.timestampStatus === 'issued') {
    return false
  }
  const status = input.legalStatus
  return (
    !status ||
    status === 'draft' ||
    status === 'image_review' ||
    status === 'legal_pending_timestamp'
  )
}

export function canDiscardReceiptScanSession(legalStatus: AccountingReceiptLegalStatus | undefined) {
  return !legalStatus || legalStatus === 'draft' || legalStatus === 'image_review'
}

/** issued 後は legal_saved 系へ進められる。未発行なら進めない。 */
export function canPromoteToLegalSaved(timestampStatus?: AccountingReceiptTimestampStatus) {
  return timestampStatus === 'issued'
}
