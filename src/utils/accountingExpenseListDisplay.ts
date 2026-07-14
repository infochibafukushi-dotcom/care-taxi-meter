import {
  INVOICE_STATUS_LABELS,
  normalizeInvoiceStatus,
  type ExpenseConfirmationStatus,
  type InvoiceStatus,
} from '../types/accounting'

/** 経費一覧の確認状態列ヘッダー（旧「状態」） */
export const EXPENSE_LIST_CONFIRMATION_STATUS_HEADER = '確認状態'

/** フォーム入力の placeholder 例。保存値としては扱わない。 */
export const EXPENSE_INVOICE_NUMBER_PLACEHOLDER_EXAMPLE = 'T4200001013662'

/**
 * 経費一覧の T番号表示。
 * 保存済み invoiceNumber を trim し、空なら「－」。
 * placeholder 値はデータに含まれない限り表示しない（呼び出し側は保存フィールドのみ渡す）。
 */
export const formatExpenseListInvoiceNumber = (
  invoiceNumber: string | null | undefined,
): string => {
  if (typeof invoiceNumber !== 'string') {
    return '－'
  }
  const trimmed = invoiceNumber.trim()
  return trimmed || '－'
}

/**
 * 経費一覧のインボイス状態表示（フォームと同じ日本語ラベル）。
 * 未定義・不正値は安全側で「未確認」。
 */
export const formatExpenseListInvoiceStatus = (
  invoiceStatus: InvoiceStatus | null | undefined | unknown,
): string => INVOICE_STATUS_LABELS[normalizeInvoiceStatus(invoiceStatus)]

/** 確認状態の表示（既存どおり保存値をそのまま表示） */
export const formatExpenseListConfirmationStatus = (
  confirmationStatus: ExpenseConfirmationStatus | string | null | undefined,
): string => {
  if (confirmationStatus === '確認済み' || confirmationStatus === '未確認' || confirmationStatus === '無効') {
    return confirmationStatus
  }
  return confirmationStatus?.trim() || '未確認'
}
