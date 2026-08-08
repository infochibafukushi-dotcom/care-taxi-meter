import type { StoredAccountingReceipt } from '../types/accounting'
import type { AccountingReceiptLegalStatus } from '../types/accountingReceiptLegal'
import { isScannerCaptureMode } from '../types/accountingReceiptLegal'
import { normalizeExpenseSearchText } from './accountingExpenseListQuery'

export type ScannerReceiptLegalStatusFilter = AccountingReceiptLegalStatus | 'all'

export type ScannerReceiptListFilters = {
  /** 取引日（transactionDate）開始 YYYY-MM-DD */
  transactionDateFrom: string
  /** 取引日（transactionDate）終了 YYYY-MM-DD */
  transactionDateTo: string
  /** 受領日（receivedDate）開始 */
  receivedDateFrom: string
  /** 受領日（receivedDate）終了 */
  receivedDateTo: string
  /** 支払先候補・メモ・ID の部分一致 */
  vendorQuery: string
  /** 最低金額（amountTotalCandidate）。空文字は未指定 */
  amountMin: string
  /** 最高金額（amountTotalCandidate）。空文字は未指定 */
  amountMax: string
  legalStatus: ScannerReceiptLegalStatusFilter
  /** true のとき論理削除済み（legalStatus=deleted / isDeleted）を含む */
  includeDeleted: boolean
  /** 完全一致（任意） */
  receiptId: string
  /** 書類種別 image/pdf（空=すべて） */
  documentType: '' | 'image' | 'pdf'
  /** 勘定科目（confirmed.expenseCategory 部分一致） */
  accountCategory: string
}

export const DEFAULT_SCANNER_RECEIPT_LIST_FILTERS: ScannerReceiptListFilters = {
  transactionDateFrom: '',
  transactionDateTo: '',
  receivedDateFrom: '',
  receivedDateTo: '',
  vendorQuery: '',
  amountMin: '',
  amountMax: '',
  legalStatus: 'all',
  includeDeleted: false,
  receiptId: '',
  documentType: '',
  accountCategory: '',
}

export type ScannerReceiptListQueryResult = {
  items: StoredAccountingReceipt[]
  totalCount: number
  activeConditionLabels: string[]
  isFiltered: boolean
}

const parseOptionalAmount = (raw: string): number | null => {
  const normalized = normalizeExpenseSearchText(raw).replace(/,/g, '')
  if (!normalized) {
    return null
  }
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

const isScannerReceiptDeleted = (receipt: StoredAccountingReceipt): boolean =>
  receipt.legalStatus === 'deleted' || receipt.isDeleted === true

const inDateRange = (value: string | undefined | null, from: string, to: string): boolean => {
  const date = (value ?? '').trim()
  if (!date) {
    return false
  }
  if (from && date < from) {
    return false
  }
  if (to && date > to) {
    return false
  }
  return true
}

const matchesVendorQuery = (receipt: StoredAccountingReceipt, rawQuery: string): boolean => {
  const query = normalizeExpenseSearchText(rawQuery)
  if (!query) {
    return true
  }
  const haystack = [
    receipt.vendorNameCandidate,
    receipt.memo,
    receipt.id,
    receipt.invoiceNumberCandidate,
    receipt.confirmed?.vendorName,
  ]
    .filter(Boolean)
    .map((value) => normalizeExpenseSearchText(String(value)))
    .join(' ')
  return haystack.includes(query)
}

const matchesAmountRange = (
  receipt: StoredAccountingReceipt,
  amountMin: string,
  amountMax: string,
): boolean => {
  const amount = receipt.amountTotalCandidate ?? receipt.confirmed?.amount
  if (amount == null || !Number.isFinite(amount)) {
    return !amountMin && !amountMax
  }
  const min = parseOptionalAmount(amountMin)
  const max = parseOptionalAmount(amountMax)
  if (min != null && amount < min) {
    return false
  }
  if (max != null && amount > max) {
    return false
  }
  return true
}

export function queryScannerReceiptList(input: {
  receipts: StoredAccountingReceipt[]
  filters?: Partial<ScannerReceiptListFilters>
}): ScannerReceiptListQueryResult {
  const filters: ScannerReceiptListFilters = {
    ...DEFAULT_SCANNER_RECEIPT_LIST_FILTERS,
    ...input.filters,
  }

  const activeConditionLabels = describeScannerReceiptFilters(filters)
  const isFiltered = activeConditionLabels.length > 0

  const items = input.receipts.filter((receipt) => {
    if (!isScannerCaptureMode(receipt.captureMode)) {
      return false
    }
    if (!filters.includeDeleted && isScannerReceiptDeleted(receipt)) {
      return false
    }
    if (
      filters.transactionDateFrom ||
      filters.transactionDateTo
    ) {
      if (
        !inDateRange(
          receipt.transactionDate,
          filters.transactionDateFrom,
          filters.transactionDateTo,
        )
      ) {
        return false
      }
    }
    if (filters.receivedDateFrom || filters.receivedDateTo) {
      if (
        !inDateRange(
          receipt.receivedDate,
          filters.receivedDateFrom,
          filters.receivedDateTo,
        )
      ) {
        return false
      }
    }
    if (filters.legalStatus !== 'all' && receipt.legalStatus !== filters.legalStatus) {
      return false
    }
    if (!matchesVendorQuery(receipt, filters.vendorQuery)) {
      return false
    }
    if (!matchesAmountRange(receipt, filters.amountMin, filters.amountMax)) {
      return false
    }
    const receiptIdQuery = filters.receiptId.trim()
    if (receiptIdQuery && receipt.id !== receiptIdQuery) {
      return false
    }
    if (filters.documentType && (receipt.documentType || 'image') !== filters.documentType) {
      return false
    }
    const accountQuery = normalizeExpenseSearchText(filters.accountCategory)
    if (accountQuery) {
      const category = normalizeExpenseSearchText(String(receipt.confirmed?.accountTitle ?? ''))
      if (!category.includes(accountQuery)) {
        return false
      }
    }
    return true
  })

  return {
    items,
    totalCount: items.length,
    activeConditionLabels,
    isFiltered,
  }
}

export function describeScannerReceiptFilters(
  filters: ScannerReceiptListFilters,
): string[] {
  const labels: string[] = []
  if (filters.transactionDateFrom || filters.transactionDateTo) {
    labels.push(
      `取引日 ${filters.transactionDateFrom || '…'} ～ ${filters.transactionDateTo || '…'}`,
    )
  }
  if (filters.receivedDateFrom || filters.receivedDateTo) {
    labels.push(
      `受領日 ${filters.receivedDateFrom || '…'} ～ ${filters.receivedDateTo || '…'}`,
    )
  }
  if (filters.vendorQuery.trim()) {
    labels.push(`支払先: ${filters.vendorQuery.trim()}`)
  }
  if (filters.amountMin.trim() || filters.amountMax.trim()) {
    labels.push(`金額 ${filters.amountMin || '…'} ～ ${filters.amountMax || '…'}`)
  }
  if (filters.legalStatus !== 'all') {
    labels.push(`法定状態: ${filters.legalStatus}`)
  }
  if (filters.includeDeleted) {
    labels.push('削除済みを含む')
  }
  if (filters.receiptId.trim()) {
    labels.push(`receiptId: ${filters.receiptId.trim()}`)
  }
  if (filters.documentType) {
    labels.push(`書類種別: ${filters.documentType}`)
  }
  if (filters.accountCategory.trim()) {
    labels.push(`勘定科目: ${filters.accountCategory.trim()}`)
  }
  return labels
}

/** Firestore 側で使う正規化支払先キー（前方一致用） */
export function normalizeScannerSearchVendorName(value: string | undefined | null): string {
  return normalizeExpenseSearchText(value ?? '')
}
