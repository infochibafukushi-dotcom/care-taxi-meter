import type { StoredAccountingExpense } from '../types/accounting'
import {
  getExpensePostingDate,
  getExpenseReceiptDate,
  getPlTreatmentLabel,
  isExpenseDeleted,
  normalizePlTreatment,
} from '../types/accounting'
import {
  INVOICE_STATUS_LABELS,
  TAX_CATEGORY_LABELS,
  normalizeInvoiceStatus,
  normalizeTaxCategory,
} from '../types/accountingReceiptWorkflow'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type { FiscalPeriod } from '../types/accountingFiscalPeriod'
import type { FilingCheckSummary } from '../types/accountingFilingCheck'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'
import {
  SUBMISSION_ITEM_AVAILABILITY_LABELS,
  SUBMISSION_PACKAGE_SCHEMA_VERSION,
  type AccountingSubmissionPackage,
  type InternalSubmissionManifest,
  type PublicCatalogRow,
  type PublicMissingVoucherRow,
  type PublicSubmissionManifest,
  type SubmissionItemAvailability,
  type SubmissionPackageIssue,
  type SubmissionPackageItem,
  type SubmissionPackageSummary,
  type SubmissionVoucherRef,
} from '../types/accountingSubmissionPackage'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import type { StoredCaseRecord } from '../services/caseRecords'
import {
  buildUnlinkedVoucherFileName,
  buildVoucherFileName,
  ensureUniqueRelativePath,
  resolveSafeSubmissionExtension,
} from './accountingSubmissionFileName'
import {
  assignSubmissionTemporaryNumbers,
  getReceiptDisplayAmount,
  getReceiptDisplayDate,
  getReceiptDisplayVendor,
  selectFixedAssetsForSubmission,
  selectPeriodExpensesForSubmission,
  selectPeriodReceiptsForSubmission,
  selectSalesForSubmission,
  sortExpensesForTemporaryNumbers,
  sortReceiptsForTemporaryNumbers,
} from './accountingSubmissionNumbers'

const CSV_EOL = '\r\n'

/** Prefix dangerous spreadsheet formula prefixes before CSV quoting. */
export const escapeSpreadsheetFormula = (value: string): string => {
  const trimmedForCheck = value.replace(/^[\t\r\n ]+/, '')
  return /^[=+\-@]/.test(trimmedForCheck) ? `'${value}` : value
}

const escapeCsv = (value: string | number) => {
  const stringValue = typeof value === 'string' ? escapeSpreadsheetFormula(value) : String(value)
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue
  }
  return `"${stringValue.replaceAll('"', '""')}"`
}

const csvLine = (values: Array<string | number>) => values.map(escapeCsv).join(',')

export type BuildAccountingSubmissionPackageInput = {
  fiscalPeriod: FiscalPeriod | null
  expenses: StoredAccountingExpense[]
  receipts: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  caseRecords?: StoredCaseRecord[]
  settlementAuxiliary?: AccountingSettlementAuxiliaryInput | null
  filingSummary: FilingCheckSummary
  sourceFingerprint?: string
  createdAt?: string
  companyName?: string
  targetYear: number
}

type PlannedReportDef = {
  id: string
  relativePath: string
  label: string
  format: 'csv' | 'pdf'
  availability: SubmissionItemAvailability
  note?: string
}

const PLANNED_REPORTS: PlannedReportDef[] = [
  {
    id: 'report.summary',
    relativePath: '01_決算サマリー.pdf',
    label: '決算サマリー',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
    note: 'tax-advisor/etax summary → ZIP生成時に同梱',
  },
  {
    id: 'report.pl',
    relativePath: '02_損益計算書.pdf',
    label: '損益計算書',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
  },
  {
    id: 'report.bs',
    relativePath: '03_貸借対照表.pdf',
    label: '貸借対照表',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
  },
  {
    id: 'report.sales',
    relativePath: '04_売上一覧.csv',
    label: '売上一覧',
    format: 'csv',
    availability: 'available',
    note: '構造プレビュー（既存売上エクスポート概念）',
  },
  {
    id: 'report.expenses',
    relativePath: '05_経費一覧.csv',
    label: '経費一覧',
    format: 'csv',
    availability: 'available',
    note: '構造プレビュー（税理士CSV相当）',
  },
  {
    id: 'report.receipts',
    relativePath: '06_領収書一覧.csv',
    label: '領収書一覧',
    format: 'csv',
    availability: 'available',
    note: '構造プレビュー（税理士CSV相当）',
  },
  {
    id: 'report.fixedAssets',
    relativePath: '07_固定資産台帳.pdf',
    label: '固定資産台帳',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
  },
  {
    id: 'report.depreciation',
    relativePath: '08_減価償却明細.pdf',
    label: '減価償却明細',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
  },
  {
    id: 'report.consumptionTax',
    relativePath: '09_消費税集計.pdf',
    label: '消費税集計',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
  },
  {
    id: 'report.accountBreakdown',
    relativePath: '10_勘定科目内訳.csv',
    label: '勘定科目内訳',
    format: 'csv',
    availability: 'available',
    note: '構造プレビュー（税理士CSV相当）',
  },
  {
    id: 'report.filingCheck',
    relativePath: '11_申告前チェック.pdf',
    label: '申告前チェック',
    format: 'pdf',
    availability: 'voucherPendingPhase2B',
    note: '画面確認は既存。PDFはZIP生成時に同梱',
  },
]

const hasReceiptOriginalStorage = (receipt: StoredAccountingReceipt): boolean => {
  const hasPath = Boolean(
    receipt.originalStoragePath?.trim() ||
      receipt.storagePath?.trim() ||
      receipt.ocrImageStoragePath?.trim(),
  )
  const hasUrl = Boolean(
    receipt.downloadUrl?.trim() ||
      receipt.originalDownloadUrl?.trim() ||
      receipt.ocrImageDownloadUrl?.trim(),
  )
  return hasPath || hasUrl
}

/** Phase 1C と同じ「経費に証憑がある」判定（receiptId または経費側の画像URL/パス） */
const hasExpenseVoucherAttachment = (expense: StoredAccountingExpense): boolean => {
  const hasReceiptLink = Boolean(expense.receiptId?.trim())
  const hasPathOrUrl = Boolean(
    expense.receiptImageUrl?.trim() ||
      expense.receiptFileUrl?.trim() ||
      expense.receiptPreviewImageUrl?.trim() ||
      expense.receiptFileStoragePath?.trim() ||
      expense.receiptStoragePath?.trim() ||
      expense.receiptPreviewStoragePath?.trim(),
  )
  return hasReceiptLink || hasPathOrUrl
}

const resolveReceiptStoragePath = (receipt: StoredAccountingReceipt): string | undefined => {
  const path =
    receipt.originalStoragePath?.trim() ||
    receipt.storagePath?.trim() ||
    receipt.ocrImageStoragePath?.trim()
  return path || undefined
}

const resolveReceiptMime = (receipt: StoredAccountingReceipt): string | undefined =>
  receipt.originalMimeType?.trim() || receipt.mimeType?.trim() || receipt.ocrImageMimeType?.trim() || undefined

const resolveReceiptFileName = (receipt: StoredAccountingReceipt): string | undefined =>
  receipt.originalFileName?.trim() || receipt.fileName?.trim() || receipt.ocrImageFileName?.trim() || undefined

const emptyTemporaryNumbers = () => ({
  expenses: {} as Record<string, string>,
  receipts: {} as Record<string, string>,
  fixedAssets: {} as Record<string, string>,
  sales: {} as Record<string, string>,
})

const makeItem = (
  partial: Omit<SubmissionPackageItem, 'isAvailable'> & { isAvailable?: boolean },
): SubmissionPackageItem => ({
  ...partial,
  isAvailable: partial.isAvailable ?? partial.availability === 'available',
})

const formatTaxRate = (expense: StoredAccountingExpense): string => {
  const category = normalizeTaxCategory(expense.taxCategory)
  if (category === 'non_taxable' || category === 'out_of_scope') {
    return '0'
  }
  if (typeof expense.taxRate === 'number' && Number.isFinite(expense.taxRate)) {
    return String(expense.taxRate)
  }
  return ''
}

const formatConsumptionTax = (expense: StoredAccountingExpense): number => {
  const category = normalizeTaxCategory(expense.taxCategory)
  if (category === 'non_taxable' || category === 'out_of_scope') {
    return 0
  }
  const amount = expense.consumptionTaxAmount ?? expense.taxAmount ?? 0
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
}

const formatPlReflection = (expense: StoredAccountingExpense): string => {
  const treatment = normalizePlTreatment(expense.plTreatment)
  if (treatment === 'expense') {
    return '反映'
  }
  if (treatment === 'excluded') {
    return '非反映'
  }
  return getPlTreatmentLabel(treatment)
}

const basenameOf = (relativePath: string): string => {
  const slash = relativePath.lastIndexOf('/')
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath
}

const summarize = (input: {
  items: SubmissionPackageItem[]
  issues: SubmissionPackageIssue[]
  filingSummary: FilingCheckSummary
  expenseCount: number
  receiptCount: number
  fixedAssetCount: number
  salesCount: number
  linkedVoucherCount: number
  unlinkedVoucherCount: number
  missingVoucherCount: number
  /** False when package structure/technical ZIP assembly is impossible */
  canGenerateZip: boolean
}): SubmissionPackageSummary => {
  const reportItemCount = input.items.filter((item) => item.type === 'report').length
  const availableItemCount = input.items.filter((item) => item.availability === 'available').length
  const pendingPhase2BCount = input.items.filter(
    (item) => item.availability === 'voucherPendingPhase2B',
  ).length
  const notImplementedCount = input.items.filter((item) => item.availability === 'notImplemented').length
  const dataMissingCount = input.items.filter((item) => item.availability === 'dataMissing').length
  const blockingIssueCount = input.issues.filter((issue) => issue.severity === 'blocking').length
  const warningIssueCount = input.issues.filter((issue) => issue.severity === 'warning').length
  const isSubmissionReady =
    input.filingSummary.blockingCount === 0 && blockingIssueCount === 0

  return {
    expenseCount: input.expenseCount,
    receiptCount: input.receiptCount,
    fixedAssetCount: input.fixedAssetCount,
    salesCount: input.salesCount,
    linkedVoucherCount: input.linkedVoucherCount,
    unlinkedVoucherCount: input.unlinkedVoucherCount,
    missingVoucherCount: input.missingVoucherCount,
    reportItemCount,
    availableItemCount,
    pendingPhase2BCount,
    notImplementedCount,
    dataMissingCount,
    blockingIssueCount,
    warningIssueCount,
    filingBlockingCount: input.filingSummary.blockingCount,
    filingWarningCount: input.filingSummary.warningCount,
    canGenerateZip: input.canGenerateZip,
    isSubmissionReady,
  }
}

const emptyPackage = (
  input: BuildAccountingSubmissionPackageInput,
  issues: SubmissionPackageIssue[],
): AccountingSubmissionPackage => {
  const items: SubmissionPackageItem[] = []
  const summary = summarize({
    items,
    issues,
    filingSummary: input.filingSummary,
    expenseCount: 0,
    receiptCount: 0,
    fixedAssetCount: 0,
    salesCount: 0,
    linkedVoucherCount: 0,
    unlinkedVoucherCount: 0,
    missingVoucherCount: 0,
    canGenerateZip: false,
  })
  summary.isSubmissionReady = false

  return {
    schemaVersion: SUBMISSION_PACKAGE_SCHEMA_VERSION,
    targetYear: input.targetYear,
    fiscalPeriod: null,
    fiscalPeriodLabel: null,
    companyName: input.companyName,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceFingerprint: input.sourceFingerprint,
    temporaryNumbers: emptyTemporaryNumbers(),
    items,
    issues,
    summary,
    catalogRows: [],
    missingVoucherRows: [],
  }
}

/**
 * Pure Phase 2A builder: temporary numbers, planned tree, voucher path preview, issues.
 * Does not fetch Storage, write Firestore, or build ZIP.
 */
export const buildAccountingSubmissionPackage = (
  input: BuildAccountingSubmissionPackageInput,
): AccountingSubmissionPackage => {
  void input.settlementAuxiliary

  if (!input.fiscalPeriod) {
    return emptyPackage(input, [
      {
        code: 'period.unavailable',
        severity: 'blocking',
        message: '会計年度が利用できないため提出パッケージを組み立てられません',
      },
    ])
  }

  const fiscalPeriod = input.fiscalPeriod
  const temporaryNumbers = assignSubmissionTemporaryNumbers({
    fiscalPeriod,
    expenses: input.expenses,
    receipts: input.receipts,
    fixedAssets: input.fixedAssets,
    caseRecords: input.caseRecords,
  })

  const periodExpenses = sortExpensesForTemporaryNumbers(
    selectPeriodExpensesForSubmission(input.expenses, fiscalPeriod),
  )
  const periodReceipts = sortReceiptsForTemporaryNumbers(
    selectPeriodReceiptsForSubmission(input.receipts, periodExpenses, fiscalPeriod),
  )
  const periodAssets = selectFixedAssetsForSubmission(input.fixedAssets)
  const periodSales = selectSalesForSubmission(input.caseRecords, fiscalPeriod)

  const receiptsById = new Map(input.receipts.map((receipt) => [receipt.id, receipt]))
  const expensesById = new Map(input.expenses.map((expense) => [expense.id, expense]))
  const reverseReceiptByExpenseId = new Map<string, StoredAccountingReceipt>()
  for (const receipt of periodReceipts) {
    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    if (!linkedExpenseId || reverseReceiptByExpenseId.has(linkedExpenseId)) {
      continue
    }
    reverseReceiptByExpenseId.set(linkedExpenseId, receipt)
  }

  const occupiedPaths = new Set<string>()
  const items: SubmissionPackageItem[] = []
  const issues: SubmissionPackageIssue[] = []
  const catalogRows: PublicCatalogRow[] = []
  const missingVoucherRows: PublicMissingVoucherRow[] = []
  const voucherReceiptIds = new Set<string>()
  const relativePathByReceiptId = new Map<string, string>()

  items.push(
    makeItem({
      id: 'catalog.00',
      type: 'catalog',
      relativePath: '00_資料一覧.csv',
      label: '資料一覧',
      format: 'csv',
      availability: 'available',
      note: '経費・証憑対応の公開用CSV（Phase 2A で生成可能）',
    }),
  )
  occupiedPaths.add('00_資料一覧.csv')

  for (const report of PLANNED_REPORTS) {
    items.push(
      makeItem({
        id: report.id,
        type: 'report',
        relativePath: report.relativePath,
        label: report.label,
        format: report.format,
        availability: report.availability,
        note: report.note,
      }),
    )
    occupiedPaths.add(report.relativePath)
  }

  items.push(
    makeItem({
      id: 'missing.12',
      type: 'missingVoucherList',
      relativePath: '12_不足証憑一覧.csv',
      label: '不足証憑一覧',
      format: 'csv',
      availability: 'available',
      note: 'Phase 2A で生成可能',
    }),
  )
  occupiedPaths.add('12_不足証憑一覧.csv')

  let linkedVoucherCount = 0
  let unlinkedVoucherCount = 0
  let missingVoucherCount = 0

  const resolveLinkedReceipt = (
    expense: StoredAccountingExpense,
  ): StoredAccountingReceipt | undefined => {
    const receiptId = expense.receiptId?.trim()
    if (receiptId) {
      return receiptsById.get(receiptId)
    }
    return reverseReceiptByExpenseId.get(expense.id)
  }

  /** Count expense→receipt refs so shared receipts omit EXP from file names. */
  const receiptLinkCounts = new Map<string, number>()
  for (const expense of periodExpenses) {
    const linked = resolveLinkedReceipt(expense)
    if (!linked) {
      continue
    }
    receiptLinkCounts.set(linked.id, (receiptLinkCounts.get(linked.id) ?? 0) + 1)
  }

  const pushMissingRow = (row: PublicMissingVoucherRow) => {
    missingVoucherRows.push(row)
    missingVoucherCount += 1
  }

  const buildLinkedVoucherPathParts = (inputParts: {
    expense: StoredAccountingExpense
    receipt: StoredAccountingReceipt
    expenseNo: string
    receiptNo: string
    shared: boolean
  }): {
    expenseNo?: string
    receiptNo: string
    date: string
    vendor: string
    amountYen: number
  } => {
    const { expense, receipt, expenseNo, receiptNo, shared } = inputParts
    if (shared) {
      // Stable across expense iteration order — receipt fields only, no EXP prefix
      return {
        receiptNo,
        date: getReceiptDisplayDate(receipt) || 'unknown-date',
        vendor: getReceiptDisplayVendor(receipt) || 'unknown-vendor',
        amountYen: getReceiptDisplayAmount(receipt),
      }
    }
    return {
      expenseNo,
      receiptNo,
      date: getReceiptDisplayDate(receipt) || getExpensePostingDate(expense),
      vendor: expense.vendorName || getReceiptDisplayVendor(receipt),
      amountYen: expense.taxIncludedAmount ?? getReceiptDisplayAmount(receipt),
    }
  }

  const addVoucherItemForReceipt = (inputVoucher: {
    expense: StoredAccountingExpense
    receipt: StoredAccountingReceipt
    expenseNo: string
    receiptNo: string
  }): { relativePath: string; availableOriginal: boolean } => {
    const { expense, receipt, expenseNo, receiptNo } = inputVoucher
    const existing = relativePathByReceiptId.get(receipt.id)
    if (existing) {
      return {
        relativePath: existing,
        availableOriginal: !existing.endsWith('.pending'),
      }
    }

    const shared = (receiptLinkCounts.get(receipt.id) ?? 0) > 1
    const pathParts = buildLinkedVoucherPathParts({
      expense,
      receipt,
      expenseNo,
      receiptNo,
      shared,
    })

    const extResult = resolveSafeSubmissionExtension({
      mimeType: resolveReceiptMime(receipt),
      originalFileName: resolveReceiptFileName(receipt),
    })
    const hasStorage = hasReceiptOriginalStorage(receipt)

    if ('issue' in extResult || !hasStorage) {
      const issueCode = !hasStorage ? 'voucher.missingOriginal' : 'voucher.unsupportedFormat'
      const relativePath = ensureUniqueRelativePath(
        occupiedPaths,
        buildVoucherFileName({
          ...pathParts,
          ext: 'pdf',
        }).replace(/\.pdf$/i, '.pending'),
      )
      issues.push({
        code: issueCode,
        severity: 'blocking',
        message: !hasStorage
          ? `${expenseNo}/${receiptNo}: 証憑原本ファイルがありません`
          : `${expenseNo}/${receiptNo}: 証憑形式が提出対象外です`,
        relatedTemporaryNos: [expenseNo, receiptNo],
        relatedRelativePaths: [relativePath],
      })
      pushMissingRow({
        expenseNo,
        postingDate: getExpensePostingDate(expense),
        vendorName: expense.vendorName ?? '',
        description: expense.description ?? '',
        amountYen: expense.taxIncludedAmount ?? 0,
        missingReason: !hasStorage ? '原本Storageパスなし' : '原本形式不明',
        exceptionReason: '',
        severity: 'blocking',
        reviewTarget: '経費・領収書',
      })
      items.push(
        makeItem({
          id: `voucher.missing.${receipt.id}`,
          type: 'voucher',
          relativePath,
          label: `不足証憑（${receiptNo}）`,
          availability: 'dataMissing',
          isAvailable: false,
          expenseTemporaryNo: shared ? undefined : expenseNo,
          receiptTemporaryNo: receiptNo,
          receiptRefs: [receiptNo],
          temporaryNumbers: shared ? [receiptNo] : [expenseNo, receiptNo],
          issueCodes: [issueCode],
          sourceExpenseId: expense.id,
          sourceReceiptId: receipt.id,
          note: !hasStorage ? '原本ファイルがありません' : '形式非対応',
        }),
      )
      voucherReceiptIds.add(receipt.id)
      relativePathByReceiptId.set(receipt.id, relativePath)
      return { relativePath, availableOriginal: false }
    }

    const candidate = buildVoucherFileName({
      ...pathParts,
      ext: extResult.ext,
    })
    const relativePath = ensureUniqueRelativePath(occupiedPaths, candidate)
    linkedVoucherCount += 1
    voucherReceiptIds.add(receipt.id)
    relativePathByReceiptId.set(receipt.id, relativePath)
    items.push(
      makeItem({
        id: `voucher.${receipt.id}`,
        type: 'voucher',
        relativePath,
        label: `証憑 ${receiptNo}`,
        format: extResult.ext,
        availability: 'voucherPendingPhase2B',
        isAvailable: false,
        expenseTemporaryNo: shared ? undefined : expenseNo,
        receiptTemporaryNo: receiptNo,
        receiptRefs: [receiptNo],
        temporaryNumbers: shared ? [receiptNo] : [expenseNo, receiptNo],
        sourceExpenseId: expense.id,
        sourceReceiptId: receipt.id,
        sourceStoragePath: resolveReceiptStoragePath(receipt),
        sourceMimeType: resolveReceiptMime(receipt),
        note: shared ? '共有証憑（複数経費参照）・ZIP生成時に同梱' : '原本はZIP生成時に同梱',
      }),
    )
    return { relativePath, availableOriginal: true }
  }

  for (const expense of periodExpenses) {
    const expenseNo = temporaryNumbers.expenses[expense.id] ?? ''
    const receiptId = expense.receiptId?.trim()
    const receipt = resolveLinkedReceipt(expense)
    const taxCategory = normalizeTaxCategory(expense.taxCategory)
    const invoiceStatus = normalizeInvoiceStatus(expense.invoiceStatus)

    let receiptNo = ''
    let voucherRelativePath = ''
    let hasOriginalLabel = 'いいえ'
    let note = ''

    if (receiptId && !receipt) {
      pushMissingRow({
        expenseNo,
        postingDate: getExpensePostingDate(expense),
        vendorName: expense.vendorName ?? '',
        description: expense.description ?? '',
        amountYen: expense.taxIncludedAmount ?? 0,
        missingReason: '領収書データなし',
        exceptionReason: '',
        severity: 'blocking',
        reviewTarget: '経費',
      })
      issues.push({
        code: 'voucher.expenseReceiptMissing',
        severity: 'blocking',
        message: `${expenseNo}: 参照先領収書が見つかりません`,
        relatedTemporaryNos: expenseNo ? [expenseNo] : [],
      })
      items.push(
        makeItem({
          id: `voucher.missing.${expense.id}`,
          type: 'voucher',
          relativePath: `証憑/${expenseNo}_領収書欠落`,
          label: `不足証憑（${expenseNo}）`,
          availability: 'dataMissing',
          isAvailable: false,
          expenseTemporaryNo: expenseNo,
          temporaryNumbers: expenseNo ? [expenseNo] : [],
          issueCodes: ['voucher.expenseReceiptMissing'],
          sourceExpenseId: expense.id,
          note: '参照先領収書がありません',
        }),
      )
      note = '領収書データなし'
    } else if (receipt) {
      receiptNo = temporaryNumbers.receipts[receipt.id] ?? ''
      const voucher = addVoucherItemForReceipt({
        expense,
        receipt,
        expenseNo,
        receiptNo,
      })
      voucherRelativePath = voucher.relativePath.endsWith('.pending')
        ? ''
        : basenameOf(voucher.relativePath)
      hasOriginalLabel = voucher.availableOriginal ? 'はい' : 'いいえ'
      if (!receiptId && receipt.linkedExpenseId?.trim() === expense.id) {
        note = '領収書側一方向リンク'
      }
    } else if (!hasExpenseVoucherAttachment(expense)) {
      const isOverride = Boolean(expense.normalExpenseOverrideConfirmed)
      const severity = isOverride ? 'warning' : 'blocking'
      pushMissingRow({
        expenseNo,
        postingDate: getExpensePostingDate(expense),
        vendorName: expense.vendorName ?? '',
        description: expense.description ?? '',
        amountYen: expense.taxIncludedAmount ?? 0,
        missingReason: '証憑紐付けなし',
        exceptionReason: isOverride ? expense.normalExpenseOverrideReason?.trim() || '通常経費上書き確認済み' : '',
        severity,
        reviewTarget: '経費',
      })
      issues.push({
        code: 'voucher.missingLink',
        severity,
        message: `${expenseNo}: 証憑が紐付いていません`,
        relatedTemporaryNos: expenseNo ? [expenseNo] : [],
      })
      note = isOverride ? '証憑なし（例外確認済み）' : '証憑紐付けなし'
    } else {
      hasOriginalLabel = 'はい'
      note = '経費直付ファイル（領収書番号なし）'
    }

    if (expense.confirmationStatus && expense.confirmationStatus !== '確認済み') {
      if (!missingVoucherRows.some((row) => row.expenseNo === expenseNo && row.missingReason === '証憑確認未完了')) {
        issues.push({
          code: 'voucher.unconfirmed',
          severity: 'warning',
          message: `${expenseNo}: 確認状態が確認済みではありません`,
          relatedTemporaryNos: expenseNo ? [expenseNo] : [],
        })
      }
      if (!note) {
        note = '確認未完了'
      }
    }

    catalogRows.push({
      expenseNo,
      receiptNo,
      postingDate: getExpensePostingDate(expense),
      receiptDate: receipt
        ? getReceiptDisplayDate(receipt) || getExpenseReceiptDate(expense)
        : getExpenseReceiptDate(expense),
      vendorName: expense.vendorName ?? '',
      description: expense.description ?? '',
      category: expense.expenseCategory ?? '',
      amountYen: expense.taxIncludedAmount ?? 0,
      taxCategoryLabel: TAX_CATEGORY_LABELS[taxCategory] ?? taxCategory,
      taxRate: formatTaxRate(expense),
      consumptionTaxYen: formatConsumptionTax(expense),
      invoiceStatusLabel: INVOICE_STATUS_LABELS[invoiceStatus] ?? invoiceStatus,
      voucherFileName: voucherRelativePath,
      hasOriginal: hasOriginalLabel,
      confirmationStatus: expense.confirmationStatus ?? '',
      plReflection: formatPlReflection(expense),
      note,
    })
  }

  // --- Unlinked / orphan receipts in period ---
  const unlinkedReceipts = periodReceipts.filter((receipt) => {
    if (voucherReceiptIds.has(receipt.id)) {
      return false
    }
    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    if (!linkedExpenseId) {
      return true
    }
    const linkedExpense = expensesById.get(linkedExpenseId)
    if (!linkedExpense || isExpenseDeleted(linkedExpense)) {
      return true
    }
    // Linked one-way to a period expense that somehow skipped voucher packaging
    if (periodExpenses.some((expense) => expense.id === linkedExpenseId)) {
      return false
    }
    return true
  })

  if (unlinkedReceipts.length > 0) {
    items.push(
      makeItem({
        id: 'unlinked.list',
        type: 'unlinkedList',
        relativePath: '未紐付け一覧.csv',
        label: '未紐付け証憑一覧',
        format: 'csv',
        availability: 'available',
        note: 'Phase 2A で生成可能',
      }),
    )
    occupiedPaths.add('未紐付け一覧.csv')
  }

  for (const receipt of unlinkedReceipts) {
    const receiptNo = temporaryNumbers.receipts[receipt.id]
    if (!receiptNo) {
      continue
    }

    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    if (linkedExpenseId) {
      const linkedExpense = expensesById.get(linkedExpenseId)
      if (!linkedExpense || isExpenseDeleted(linkedExpense)) {
        issues.push({
          code: 'receipts.orphanLinkedExpense',
          severity: 'blocking',
          message: `${receiptNo}: 参照先経費がありません`,
          relatedTemporaryNos: [receiptNo],
        })
      }
    } else {
      issues.push({
        code: 'voucher.unlinked',
        severity: 'warning',
        message: `${receiptNo}: 経費未紐付けの領収書です`,
        relatedTemporaryNos: [receiptNo],
      })
    }

    const extResult = resolveSafeSubmissionExtension({
      mimeType: resolveReceiptMime(receipt),
      originalFileName: resolveReceiptFileName(receipt),
    })
    const hasStorage = hasReceiptOriginalStorage(receipt)

    if ('issue' in extResult || !hasStorage) {
      const plannedPath = ensureUniqueRelativePath(
        occupiedPaths,
        `証憑/未紐付け/${receiptNo}.pending`,
      )
      const issueCode = !hasStorage ? 'voucher.missingOriginal' : 'voucher.unsupportedFormat'
      issues.push({
        code: issueCode,
        severity: 'blocking',
        message: !hasStorage
          ? `${receiptNo}: 未紐付け証憑の原本がありません`
          : `${receiptNo}: 未紐付け証憑の形式が提出対象外です`,
        relatedTemporaryNos: [receiptNo],
        relatedRelativePaths: [plannedPath],
      })
      missingVoucherCount += 1
      items.push(
        makeItem({
          id: `unlinked.missing.${receipt.id}`,
          type: 'unlinkedVoucher',
          relativePath: plannedPath,
          label: `未紐付け不足（${receiptNo}）`,
          availability: 'dataMissing',
          isAvailable: false,
          receiptTemporaryNo: receiptNo,
          receiptRefs: [receiptNo],
          temporaryNumbers: [receiptNo],
          sourceReceiptId: receipt.id,
          issueCodes: [issueCode],
        }),
      )
      continue
    }

    const candidate = buildUnlinkedVoucherFileName({
      receiptNo,
      date: getReceiptDisplayDate(receipt),
      vendor: getReceiptDisplayVendor(receipt),
      amountYen: getReceiptDisplayAmount(receipt),
      ext: extResult.ext,
    })
    const relativePath = ensureUniqueRelativePath(occupiedPaths, candidate)
    unlinkedVoucherCount += 1
    items.push(
      makeItem({
        id: `unlinked.${receipt.id}`,
        type: 'unlinkedVoucher',
        relativePath,
        label: `未紐付け証憑 ${receiptNo}`,
        format: extResult.ext,
        availability: 'voucherPendingPhase2B',
        isAvailable: false,
        receiptTemporaryNo: receiptNo,
        receiptRefs: [receiptNo],
        temporaryNumbers: [receiptNo],
        sourceReceiptId: receipt.id,
        sourceStoragePath: resolveReceiptStoragePath(receipt),
        sourceMimeType: resolveReceiptMime(receipt),
        note: '原本はZIP生成時に同梱',
      }),
    )
  }

  // Link mismatch: only when both sides are set and disagree (Phase 1C)
  for (const expense of periodExpenses) {
    const receiptId = expense.receiptId?.trim()
    if (!receiptId) {
      continue
    }
    const receipt = receiptsById.get(receiptId)
    if (!receipt) {
      continue
    }
    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    if (linkedExpenseId && linkedExpenseId !== expense.id) {
      const expenseNo = temporaryNumbers.expenses[expense.id]
      const receiptNo = temporaryNumbers.receipts[receipt.id]
      issues.push({
        code: 'receipts.linkMismatch',
        severity: 'blocking',
        message: `${expenseNo}/${receiptNo}: 経費と領収書の相互リンクが矛盾しています`,
        relatedTemporaryNos: [expenseNo, receiptNo].filter(Boolean) as string[],
      })
      pushMissingRow({
        expenseNo: expenseNo ?? '',
        postingDate: getExpensePostingDate(expense),
        vendorName: expense.vendorName ?? '',
        description: expense.description ?? '',
        amountYen: expense.taxIncludedAmount ?? 0,
        missingReason: '双方向リンク不一致',
        exceptionReason: '',
        severity: 'blocking',
        reviewTarget: '経費・領収書',
      })
    }
  }
  for (const receipt of periodReceipts) {
    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    if (!linkedExpenseId) {
      continue
    }
    const expense = expensesById.get(linkedExpenseId)
    if (!expense || isExpenseDeleted(expense)) {
      continue
    }
    const expenseReceiptId = expense.receiptId?.trim()
    if (expenseReceiptId && expenseReceiptId !== receipt.id) {
      const expenseNo = temporaryNumbers.expenses[expense.id]
      const receiptNo = temporaryNumbers.receipts[receipt.id]
      const already = issues.some(
        (issue) =>
          issue.code === 'receipts.linkMismatch' &&
          issue.relatedTemporaryNos?.includes(expenseNo) &&
          issue.relatedTemporaryNos?.includes(receiptNo),
      )
      if (!already) {
        issues.push({
          code: 'receipts.linkMismatch',
          severity: 'blocking',
          message: `${expenseNo}/${receiptNo}: 経費と領収書の相互リンクが矛盾しています`,
          relatedTemporaryNos: [expenseNo, receiptNo].filter(Boolean) as string[],
        })
      }
    }
  }

  const hasEmptyPath = items.some((item) => !item.relativePath?.trim())
  const pathSet = new Set<string>()
  let hasPathCollision = false
  for (const item of items) {
    const path = item.relativePath.trim()
    if (pathSet.has(path)) {
      hasPathCollision = true
      break
    }
    pathSet.add(path)
  }

  const canGenerateZip = !hasEmptyPath && !hasPathCollision && items.length > 0

  const summary = summarize({
    items,
    issues,
    filingSummary: input.filingSummary,
    expenseCount: periodExpenses.length,
    receiptCount: periodReceipts.length,
    fixedAssetCount: periodAssets.length,
    salesCount: periodSales.length,
    linkedVoucherCount,
    unlinkedVoucherCount,
    missingVoucherCount,
    canGenerateZip,
  })

  return {
    schemaVersion: SUBMISSION_PACKAGE_SCHEMA_VERSION,
    targetYear: input.targetYear,
    fiscalPeriod,
    fiscalPeriodLabel: fiscalPeriod.label,
    companyName: input.companyName,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceFingerprint: input.sourceFingerprint,
    temporaryNumbers,
    items,
    issues,
    summary,
    catalogRows,
    missingVoucherRows,
  }
}

export const buildSubmissionCatalogCsv = (pkg: AccountingSubmissionPackage): string => {
  const headers = [
    '経費番号',
    '証憑番号',
    '計上日',
    '証憑日',
    '取引先',
    '内容',
    '科目',
    '金額',
    '税区分',
    '税率',
    '消費税額',
    'インボイス状態',
    '証憑ファイル',
    '原本あり',
    '確認状態',
    'PL反映',
    '備考',
  ]
  const lines = [
    csvLine(headers),
    ...pkg.catalogRows.map((row) =>
      csvLine([
        row.expenseNo,
        row.receiptNo,
        row.postingDate,
        row.receiptDate,
        row.vendorName,
        row.description,
        row.category,
        row.amountYen,
        row.taxCategoryLabel,
        row.taxRate,
        row.consumptionTaxYen,
        row.invoiceStatusLabel,
        row.voucherFileName,
        row.hasOriginal,
        row.confirmationStatus,
        row.plReflection,
        row.note,
      ]),
    ),
  ]
  return `\uFEFF${lines.join(CSV_EOL)}${CSV_EOL}`
}

export const buildMissingVoucherCsv = (pkg: AccountingSubmissionPackage): string => {
  const headers = [
    '経費番号',
    '計上日',
    '取引先',
    '内容',
    '金額',
    '不足理由',
    '例外理由',
    'blocking／warning',
    '確認先',
  ]
  const lines = [
    csvLine(headers),
    ...pkg.missingVoucherRows.map((row) =>
      csvLine([
        row.expenseNo,
        row.postingDate,
        row.vendorName,
        row.description,
        row.amountYen,
        row.missingReason,
        row.exceptionReason,
        row.severity,
        row.reviewTarget,
      ]),
    ),
  ]
  return `\uFEFF${lines.join(CSV_EOL)}${CSV_EOL}`
}

export const buildUnlinkedVoucherCsv = (pkg: AccountingSubmissionPackage): string => {
  const headers = ['証憑番号', '証憑日', '取引先候補', '金額候補', '証憑ファイル', '状態', '備考']
  const unlinked = pkg.items.filter((item) => item.type === 'unlinkedVoucher')
  const lines = [
    csvLine(headers),
    ...unlinked.map((item) =>
      csvLine([
        item.receiptTemporaryNo ?? (item.temporaryNumbers?.[0] ?? ''),
        '',
        '',
        '',
        basenameOf(item.relativePath),
        SUBMISSION_ITEM_AVAILABILITY_LABELS[item.availability],
        item.note ?? '',
      ]),
    ),
  ]
  return `\uFEFF${lines.join(CSV_EOL)}${CSV_EOL}`
}

export const toInternalSubmissionManifest = (
  pkg: AccountingSubmissionPackage,
): InternalSubmissionManifest => {
  const voucherRefs: SubmissionVoucherRef[] = pkg.items
    .filter(
      (item) =>
        (item.type === 'voucher' || item.type === 'unlinkedVoucher') &&
        item.receiptTemporaryNo &&
        item.relativePath,
    )
    .map((item) => ({
      temporaryNo: item.receiptTemporaryNo!,
      relativePath: item.relativePath,
      receiptInternalId: item.sourceReceiptId,
    }))

  return {
    schemaVersion: pkg.schemaVersion,
    targetYear: pkg.targetYear,
    fiscalPeriodLabel: pkg.fiscalPeriodLabel,
    createdAt: pkg.createdAt,
    sourceFingerprint: pkg.sourceFingerprint,
    voucherRefs,
    items: pkg.items.map((item) => ({
      packageItemId: item.id,
      type: item.type,
      relativePath: item.relativePath,
      format: item.format,
      temporaryNumbers: item.temporaryNumbers,
      availability: item.availability,
      sourceExpenseId: item.sourceExpenseId,
      sourceReceiptId: item.sourceReceiptId,
      sourceStoragePath: item.sourceStoragePath,
      sourceMimeType: item.sourceMimeType,
      receiptRefs: item.receiptRefs,
    })),
  }
}

export const toPublicSubmissionManifest = (
  pkg: AccountingSubmissionPackage,
): PublicSubmissionManifest => ({
  schemaVersion: pkg.schemaVersion,
  targetYear: pkg.targetYear,
  fiscalPeriodLabel: pkg.fiscalPeriodLabel,
  createdAt: pkg.createdAt,
  items: pkg.items.map((item) => ({
    packageItemId:
      item.expenseTemporaryNo ||
      item.receiptTemporaryNo ||
      (item.temporaryNumbers?.[0] ?? item.id),
    type: item.type,
    relativePath: item.relativePath,
    format: item.format,
    temporaryNumbers: item.temporaryNumbers,
    availability: item.availability,
  })),
})

/** Nested text tree for structure preview (no secrets). */
export const formatSubmissionPackageTree = (pkg: AccountingSubmissionPackage): string => {
  const root = `税務確認提出パッケージ/${pkg.targetYear}`
  const lines = [root + '/']
  const paths = pkg.items.map((item) => item.relativePath).sort((a, b) => a.localeCompare(b, 'ja'))
  for (const path of paths) {
    const parts = path.split('/')
    let indent = '  '
    for (let i = 0; i < parts.length; i += 1) {
      const isLastPart = i === parts.length - 1
      if (isLastPart) {
        lines.push(`${indent}${parts[i]}`)
      } else {
        const dirName = parts[i]
        const exists = lines.some((line) => line.trim() === `${dirName}/`)
        if (!exists) {
          lines.push(`${indent}${dirName}/`)
        }
        indent += '  '
      }
    }
  }
  return lines.join('\n')
}

export const buildSubmissionPackageTreeNodes = (
  pkg: AccountingSubmissionPackage,
): Array<{ path: string; label: string; availability: SubmissionItemAvailability }> =>
  [...pkg.items]
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ja'))
    .map((item) => ({
      path: item.relativePath,
      label: item.label,
      availability: item.availability,
    }))
