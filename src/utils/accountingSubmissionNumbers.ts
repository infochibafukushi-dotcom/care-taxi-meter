import type { StoredAccountingExpense } from '../types/accounting'
import { getExpensePostingDate, isExpenseDeleted } from '../types/accounting'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type { FiscalPeriod } from '../types/accountingFiscalPeriod'
import type { TemporaryNumberKind } from '../types/accountingSubmissionPackage'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import type { StoredCaseRecord } from '../services/caseRecords'
import { getFiscalPeriodMonths } from './accountingFiscalPeriod'

export type TemporaryNumberMaps = {
  expenses: Record<string, string>
  receipts: Record<string, string>
  fixedAssets: Record<string, string>
  sales: Record<string, string>
}

const compareJa = (a: string, b: string) => a.localeCompare(b, 'ja')

export const formatTemporaryNumber = (kind: TemporaryNumberKind, index: number): string =>
  `${kind}-${String(index).padStart(6, '0')}`

const receiptSortDate = (receipt: StoredAccountingReceipt): string => {
  if (receipt.confirmed?.date?.trim()) {
    return receipt.confirmed.date.trim()
  }
  if (receipt.receiptDate?.trim()) {
    return receipt.receiptDate.trim()
  }
  if (receipt.createdAt?.trim()) {
    return receipt.createdAt.trim().slice(0, 10)
  }
  return ''
}

const receiptVendor = (receipt: StoredAccountingReceipt): string =>
  receipt.confirmed?.vendorName?.trim() ||
  receipt.vendorNameCandidate?.trim() ||
  ''

const receiptAmount = (receipt: StoredAccountingReceipt): number => {
  const confirmed = receipt.confirmed?.amount
  if (typeof confirmed === 'number' && Number.isFinite(confirmed)) {
    return confirmed
  }
  return typeof receipt.amountTotalCandidate === 'number' ? receipt.amountTotalCandidate : 0
}

const isExpenseInFiscalMonths = (expense: StoredAccountingExpense, months: string[]): boolean => {
  if (months.length === 0) {
    return false
  }
  return months.includes(getExpensePostingDate(expense).slice(0, 7))
}

const receiptMonthCandidates = (receipt: StoredAccountingReceipt): string[] => {
  const months: string[] = []
  if (receipt.receiptDate?.trim()) {
    months.push(receipt.receiptDate.trim().slice(0, 7))
  }
  if (receipt.createdAt?.trim()) {
    months.push(receipt.createdAt.trim().slice(0, 7))
  }
  return months
}

export const selectPeriodExpensesForSubmission = (
  expenses: StoredAccountingExpense[],
  fiscalPeriod: FiscalPeriod,
): StoredAccountingExpense[] => {
  const months = getFiscalPeriodMonths(fiscalPeriod)
  return expenses.filter((expense) => !isExpenseDeleted(expense) && isExpenseInFiscalMonths(expense, months))
}

/**
 * Receipts in fiscal months (by receiptDate or createdAt) OR linked to a period expense.
 */
export const selectPeriodReceiptsForSubmission = (
  receipts: StoredAccountingReceipt[],
  periodExpenses: StoredAccountingExpense[],
  fiscalPeriod: FiscalPeriod,
): StoredAccountingReceipt[] => {
  const months = new Set(getFiscalPeriodMonths(fiscalPeriod))
  const periodExpenseIds = new Set(periodExpenses.map((expense) => expense.id))
  const linkedReceiptIds = new Set(
    periodExpenses.map((expense) => expense.receiptId?.trim()).filter((id): id is string => Boolean(id)),
  )

  return receipts.filter((receipt) => {
    if (linkedReceiptIds.has(receipt.id)) {
      return true
    }
    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    if (linkedExpenseId && periodExpenseIds.has(linkedExpenseId)) {
      return true
    }
    return receiptMonthCandidates(receipt).some((month) => months.has(month))
  })
}

export const selectFixedAssetsForSubmission = (
  fixedAssets: StoredAccountingFixedAsset[],
): StoredAccountingFixedAsset[] =>
  fixedAssets.filter((asset) => asset.assetKind === 'fixed' && asset.isDeleted !== true)

export const selectSalesForSubmission = (
  caseRecords: StoredCaseRecord[] | undefined,
  fiscalPeriod: FiscalPeriod,
): StoredCaseRecord[] => {
  if (!caseRecords?.length) {
    return []
  }
  const months = new Set(getFiscalPeriodMonths(fiscalPeriod))
  return caseRecords.filter((record) => {
    const amount = record.actualFareYen ?? record.totalFareYen ?? 0
    if (!(typeof amount === 'number' && Number.isFinite(amount) && amount !== 0)) {
      return false
    }
    const caseMonth = (record.caseDate || record.closedAt || '').slice(0, 7)
    return Boolean(caseMonth) && months.has(caseMonth)
  })
}

export const sortExpensesForTemporaryNumbers = (
  expenses: StoredAccountingExpense[],
): StoredAccountingExpense[] =>
  [...expenses].sort((a, b) => {
    const dateDiff = getExpensePostingDate(a).localeCompare(getExpensePostingDate(b))
    if (dateDiff !== 0) {
      return dateDiff
    }
    const vendorDiff = compareJa(a.vendorName ?? '', b.vendorName ?? '')
    if (vendorDiff !== 0) {
      return vendorDiff
    }
    const amountDiff = (a.taxIncludedAmount ?? 0) - (b.taxIncludedAmount ?? 0)
    if (amountDiff !== 0) {
      return amountDiff
    }
    return a.id.localeCompare(b.id)
  })

export const sortReceiptsForTemporaryNumbers = (
  receipts: StoredAccountingReceipt[],
): StoredAccountingReceipt[] =>
  [...receipts].sort((a, b) => {
    const dateDiff = receiptSortDate(a).localeCompare(receiptSortDate(b))
    if (dateDiff !== 0) {
      return dateDiff
    }
    const vendorDiff = compareJa(receiptVendor(a), receiptVendor(b))
    if (vendorDiff !== 0) {
      return vendorDiff
    }
    const amountDiff = receiptAmount(a) - receiptAmount(b)
    if (amountDiff !== 0) {
      return amountDiff
    }
    return a.id.localeCompare(b.id)
  })

export const sortFixedAssetsForTemporaryNumbers = (
  assets: StoredAccountingFixedAsset[],
): StoredAccountingFixedAsset[] =>
  [...assets].sort((a, b) => {
    const dateDiff = (a.purchaseDate || '').localeCompare(b.purchaseDate || '')
    if (dateDiff !== 0) {
      return dateDiff
    }
    const nameDiff = compareJa(a.assetName ?? '', b.assetName ?? '')
    if (nameDiff !== 0) {
      return nameDiff
    }
    const costDiff = (a.acquisitionCost ?? 0) - (b.acquisitionCost ?? 0)
    if (costDiff !== 0) {
      return costDiff
    }
    return a.id.localeCompare(b.id)
  })

export const sortSalesForTemporaryNumbers = (records: StoredCaseRecord[]): StoredCaseRecord[] =>
  [...records].sort((a, b) => {
    const dateA = (a.caseDate || a.closedAt || '').slice(0, 10)
    const dateB = (b.caseDate || b.closedAt || '').slice(0, 10)
    const dateDiff = dateA.localeCompare(dateB)
    if (dateDiff !== 0) {
      return dateDiff
    }
    const amountA = a.actualFareYen ?? a.totalFareYen ?? 0
    const amountB = b.actualFareYen ?? b.totalFareYen ?? 0
    if (amountA !== amountB) {
      return amountA - amountB
    }
    return a.id.localeCompare(b.id)
  })

const assignSequential = <T extends { id: string }>(
  rows: T[],
  kind: TemporaryNumberKind,
): Record<string, string> => {
  const map: Record<string, string> = {}
  rows.forEach((row, index) => {
    map[row.id] = formatTemporaryNumber(kind, index + 1)
  })
  return map
}

/**
 * Assign stable EXP/RCP/AST/SAL temporary numbers for a fiscal period.
 * Same logical rows → same numbers regardless of input array order.
 */
export const assignSubmissionTemporaryNumbers = (input: {
  fiscalPeriod: FiscalPeriod
  expenses: StoredAccountingExpense[]
  receipts: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  caseRecords?: StoredCaseRecord[]
}): TemporaryNumberMaps => {
  const periodExpenses = selectPeriodExpensesForSubmission(input.expenses, input.fiscalPeriod)
  const periodReceipts = selectPeriodReceiptsForSubmission(
    input.receipts,
    periodExpenses,
    input.fiscalPeriod,
  )
  const periodAssets = selectFixedAssetsForSubmission(input.fixedAssets)
  const periodSales = selectSalesForSubmission(input.caseRecords, input.fiscalPeriod)

  return {
    expenses: assignSequential(sortExpensesForTemporaryNumbers(periodExpenses), 'EXP'),
    receipts: assignSequential(sortReceiptsForTemporaryNumbers(periodReceipts), 'RCP'),
    fixedAssets: assignSequential(sortFixedAssetsForTemporaryNumbers(periodAssets), 'AST'),
    sales: assignSequential(sortSalesForTemporaryNumbers(periodSales), 'SAL'),
  }
}

export const getReceiptDisplayDate = receiptSortDate
export const getReceiptDisplayVendor = receiptVendor
export const getReceiptDisplayAmount = receiptAmount
