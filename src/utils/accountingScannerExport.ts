import type { StoredAccountingReceipt } from '../types/accounting'
import { isScannerCaptureMode } from '../types/accountingReceiptLegal'

const CSV_EOL = '\r\n'
const UTF8_BOM = '\uFEFF'

const escapeCsv = (value: string | number | null | undefined) => {
  if (value == null) {
    return ''
  }
  const stringValue = String(value)
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue
  }
  return `"${stringValue.replaceAll('"', '""')}"`
}

const csvLine = (values: Array<string | number | null | undefined>) =>
  values.map(escapeCsv).join(',')

export const SCANNER_RECEIPT_EXPORT_CSV_HEADERS = [
  'receiptId',
  'version',
  'transactionDate',
  'receivedDate',
  'amount',
  'vendorName',
  'expenseId',
  'legalStatus',
  'fileName',
  'fileHash',
  'timestampedAt',
  'deleted',
  'deleteReason',
  'franchiseeId',
  'storeId',
  'foundDate',
  'timestampStatus',
  'captureMode',
  'activeVersion',
  'deadlineDueDate',
  'requiresPaperOriginal',
] as const

export type ScannerReceiptExportRow = Record<
  (typeof SCANNER_RECEIPT_EXPORT_CSV_HEADERS)[number],
  string | number
>

export const toScannerReceiptExportRow = (
  receipt: StoredAccountingReceipt,
): ScannerReceiptExportRow => ({
  receiptId: receipt.id,
  version: receipt.activeVersion ?? receipt.version ?? 1,
  transactionDate: receipt.transactionDate ?? '',
  receivedDate: receipt.receivedDate ?? '',
  amount: receipt.confirmed?.amount ?? receipt.amountTotalCandidate ?? '',
  vendorName: receipt.confirmed?.vendorName ?? receipt.vendorNameCandidate ?? '',
  expenseId: receipt.linkedExpenseId ?? '',
  legalStatus: receipt.legalStatus ?? '',
  fileName: `${receipt.id}_v${receipt.activeVersion ?? receipt.version ?? 1}.jpg`,
  fileHash: receipt.fileHash ?? receipt.imageHash ?? '',
  timestampedAt: receipt.timestampedAt ?? '',
  deleted: receipt.isDeleted || receipt.legalStatus === 'deleted' ? 'yes' : 'no',
  deleteReason: receipt.deleteReason ?? '',
  franchiseeId: receipt.franchiseeId,
  storeId: receipt.storeId,
  foundDate: receipt.foundDate ?? '',
  timestampStatus: receipt.timestampStatus ?? 'none',
  captureMode: receipt.captureMode ?? '',
  activeVersion: receipt.activeVersion ?? receipt.version ?? 1,
  deadlineDueDate: receipt.deadlineDueDate ?? '',
  requiresPaperOriginal: receipt.requiresPaperOriginal ? 'yes' : 'no',
})

export const buildScannerReceiptExportCsv = (
  receipts: StoredAccountingReceipt[],
): string => {
  const scannerReceipts = receipts.filter((receipt) => isScannerCaptureMode(receipt.captureMode))
  const lines = [
    csvLine([...SCANNER_RECEIPT_EXPORT_CSV_HEADERS]),
    ...scannerReceipts.map((receipt) => {
      const row = toScannerReceiptExportRow(receipt)
      return csvLine(SCANNER_RECEIPT_EXPORT_CSV_HEADERS.map((key) => row[key]))
    }),
  ]
  return `${UTF8_BOM}${lines.join(CSV_EOL)}${CSV_EOL}`
}

export const buildScannerReceiptExportFileName = (exportedAtIso: string): string => {
  const date = exportedAtIso.slice(0, 10).replaceAll('-', '')
  return `scanner-receipts-${date}.csv`
}

export type ScannerReceiptExportIndexEntry = {
  receiptId: string
  version: number
  legalMasterStoragePath: string
  timestampTokenStoragePath: string
  fileHash: string
}

/** ZIP 同梱用の最小インデックス（JSON 文字列） */
export const buildScannerReceiptExportIndexJson = (
  receipts: StoredAccountingReceipt[],
): string => {
  const entries: ScannerReceiptExportIndexEntry[] = receipts
    .filter((receipt) => isScannerCaptureMode(receipt.captureMode))
    .map((receipt) => ({
      receiptId: receipt.id,
      version: receipt.activeVersion ?? receipt.version ?? 1,
      legalMasterStoragePath: receipt.legalMasterStoragePath ?? '',
      timestampTokenStoragePath: receipt.timestampTokenStoragePath ?? '',
      fileHash: receipt.fileHash ?? '',
    }))
  return JSON.stringify({ schemaVersion: 1, entries }, null, 2)
}
