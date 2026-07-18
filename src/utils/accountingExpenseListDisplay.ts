import {
  INVOICE_STATUS_LABELS,
  normalizeInvoiceStatus,
  type ExpenseConfirmationStatus,
  type InvoiceStatus,
  type StoredAccountingExpense,
} from '../types/accounting'

/** 経費一覧の確認状態列ヘッダー（旧「状態」） */
export const EXPENSE_LIST_CONFIRMATION_STATUS_HEADER = '確認状態'

/** フォーム入力の placeholder 例。保存値としては扱わない。 */
export const EXPENSE_INVOICE_NUMBER_PLACEHOLDER_EXAMPLE = 'T4200001013662'

/** 操作列：証憑未添付 */
export const EXPENSE_LIST_RECEIPT_PENDING_LABEL = '証憑待ち'

/** 操作列：証憑添付済み・未確認 */
export const EXPENSE_LIST_CONFIRMATION_PENDING_LABEL = '確認待ち'

export type ExpenseListActionStatusLabel =
  | typeof EXPENSE_LIST_RECEIPT_PENDING_LABEL
  | typeof EXPENSE_LIST_CONFIRMATION_PENDING_LABEL

const hasOpenableReceiptUrl = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

/**
 * 経費に証憑（PDF/画像）が添付されているか。
 * 開ける URL（原本・プレビュー・互換画像）のみを「添付あり」とみなし、
 * ファイル名だけでは添付あり扱いにしない。
 */
export const hasExpenseReceiptAttachment = (
  expense: Pick<
    StoredAccountingExpense,
    | 'receiptFileUrl'
    | 'receiptPreviewImageUrl'
    | 'receiptImageUrl'
    | 'receiptFileName'
    | 'receiptFileStoragePath'
    | 'receiptPreviewStoragePath'
    | 'receiptStoragePath'
  >,
): boolean =>
  hasOpenableReceiptUrl(expense.receiptFileUrl) ||
  hasOpenableReceiptUrl(expense.receiptPreviewImageUrl) ||
  hasOpenableReceiptUrl(expense.receiptImageUrl)

/**
 * 経費一覧の操作列に出す証憑／確認の待ち状態。
 * - 未添付 → 証憑待ち
 * - 添付ありかつ未確認 → 確認待ち
 * - 添付ありかつ確認済み（または無効等）→ 表示なし
 */
export const getExpenseListActionStatusLabel = (
  expense: Pick<
    StoredAccountingExpense,
    | 'confirmationStatus'
    | 'receiptFileUrl'
    | 'receiptPreviewImageUrl'
    | 'receiptImageUrl'
    | 'receiptFileName'
    | 'receiptFileStoragePath'
    | 'receiptPreviewStoragePath'
    | 'receiptStoragePath'
  >,
): ExpenseListActionStatusLabel | null => {
  if (!hasExpenseReceiptAttachment(expense)) {
    return EXPENSE_LIST_RECEIPT_PENDING_LABEL
  }
  if (expense.confirmationStatus === '未確認') {
    return EXPENSE_LIST_CONFIRMATION_PENDING_LABEL
  }
  return null
}

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

export const formatExpenseListBillingInvoiceNumber = (
  billingInvoiceNumber: string | null | undefined,
): string => {
  if (typeof billingInvoiceNumber !== 'string') {
    return '－'
  }
  const trimmed = billingInvoiceNumber.trim()
  return trimmed || '－'
}

/** 確認状態の表示（既存どおり保存値をそのまま表示） */
export const formatExpenseListConfirmationStatus = (
  confirmationStatus: ExpenseConfirmationStatus | string | null | undefined,
): string => {
  if (confirmationStatus === '確認済み' || confirmationStatus === '未確認' || confirmationStatus === '無効') {
    return confirmationStatus
  }
  return confirmationStatus?.trim() || '未確認'
}
