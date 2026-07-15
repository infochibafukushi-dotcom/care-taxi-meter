import type { StoredAccountingExpense } from '../types/accounting'
import {
  getExpensePostingDate,
  isExpenseDeleted,
  isExpenseEligibleForReporting,
  normalizePlTreatment,
} from '../types/accounting'
import { isExpenseCategorySelected } from '../types/accountingCategoryMaster'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type { FiscalPeriod } from '../types/accountingFiscalPeriod'
import type { AccountingExportReadinessSnapshot } from '../types/accountingExportHistory'
import type {
  FilingCheckActionTarget,
  FilingCheckFilter,
  FilingCheckItem,
  FilingCheckStatus,
  FilingCheckSummary,
} from '../types/accountingFilingCheck'
import { FILING_CHECK_STATUS_LABELS } from '../types/accountingFilingCheck'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'
import { normalizeTaxCategory } from '../types/accountingReceiptWorkflow'
import type { Company } from '../types/work'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import { detectFixedAssetRegistrationWarning } from './accountingAssetDetection'
import { calculateRemainingBookValue } from './accountingDepreciation'
import { getFiscalPeriodMonths } from './accountingFiscalPeriod'
import {
  hasPositiveSettlementAmount,
  isSettlementAmountEntered,
  sumReceivableBreakdownByKind,
  sumSettlementBreakdownBalances,
} from './accountingSettlementAuxiliaryForm'
import { isOrphanLinkedReceipt } from './accountingReceiptLink'

export type SettlementAmountCompareInput = {
  expectedAmountYen: number | null
  actualAmountYen: number | null
  expectedEntered: boolean
  actualEntered: boolean
  notApplicable?: boolean
}

export type SettlementAmountCompareResult = {
  status: Exclude<FilingCheckStatus, 'planned'>
  expectedAmountYen: number | null
  actualAmountYen: number | null
  differenceYen: number | null
  summary: string
}

export const formatYen = (n: number): string =>
  `${Math.trunc(n).toLocaleString('ja-JP')}円`

const STATUS_SORT_ORDER: Record<FilingCheckStatus, number> = {
  blocking: 0,
  warning: 1,
  planned: 2,
  notApplicable: 3,
  complete: 4,
}

export const filingChecksSort = (items: FilingCheckItem[]): FilingCheckItem[] =>
  [...items].sort((a, b) => {
    const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]
    if (statusDiff !== 0) {
      return statusDiff
    }
    return a.id.localeCompare(b.id, 'ja')
  })

export const filterFilingChecks = (
  items: FilingCheckItem[],
  filter: FilingCheckFilter,
): FilingCheckItem[] => {
  switch (filter) {
    case 'blocking':
      return items.filter((item) => item.status === 'blocking')
    case 'warning':
      return items.filter((item) => item.status === 'warning')
    case 'planned':
      return items.filter((item) => item.status === 'planned')
    case 'actionable':
      return items.filter((item) => item.status === 'blocking' || item.status === 'warning')
    default:
      return items
  }
}

export const summarizeFilingChecks = (items: FilingCheckItem[]): FilingCheckSummary => {
  const sorted = filingChecksSort(items)
  const blockingCount = sorted.filter((item) => item.status === 'blocking').length
  return {
    items: sorted,
    blockingCount,
    warningCount: sorted.filter((item) => item.status === 'warning').length,
    plannedCount: sorted.filter((item) => item.status === 'planned').length,
    completeCount: sorted.filter((item) => item.status === 'complete').length,
    notApplicableCount: sorted.filter((item) => item.status === 'notApplicable').length,
    isFilingReady: blockingCount === 0,
  }
}

export const buildReadinessSnapshot = (
  summary: FilingCheckSummary,
): AccountingExportReadinessSnapshot => ({
  blockingCount: summary.blockingCount,
  warningCount: summary.warningCount,
  plannedCount: summary.plannedCount,
  completeCount: summary.completeCount,
  notApplicableCount: summary.notApplicableCount,
  isFilingReady: summary.isFilingReady,
})

/**
 * 決算残高と内訳合計の突合。円単位の整数比較。
 * Mirror of e-Tax pushBalanceBreakdownMatchCheck semantics, expanded with unset/zero-na cases.
 */
export const compareSettlementAmount = ({
  expectedAmountYen,
  actualAmountYen,
  expectedEntered,
  actualEntered,
  notApplicable = false,
}: SettlementAmountCompareInput): SettlementAmountCompareResult => {
  const expected =
    expectedEntered && expectedAmountYen != null && !Number.isNaN(expectedAmountYen)
      ? Math.trunc(expectedAmountYen)
      : null
  const actual =
    actualEntered && actualAmountYen != null && !Number.isNaN(actualAmountYen)
      ? Math.trunc(actualAmountYen)
      : null

  if (notApplicable) {
    return {
      status: 'notApplicable',
      expectedAmountYen: expected,
      actualAmountYen: actual,
      differenceYen: null,
      summary: '該当なし',
    }
  }

  if (!expectedEntered && !actualEntered) {
    return {
      status: 'warning',
      expectedAmountYen: null,
      actualAmountYen: null,
      differenceYen: null,
      summary: '未入力',
    }
  }

  // 残高 0 円入力済みは該当なし（内訳がなくても）
  if (expectedEntered && expected === 0) {
    return {
      status: 'notApplicable',
      expectedAmountYen: 0,
      actualAmountYen: actual,
      differenceYen: null,
      summary: '該当なし（0円）',
    }
  }

  if (!expectedEntered && actualEntered) {
    return {
      status: 'warning',
      expectedAmountYen: null,
      actualAmountYen: actual,
      differenceYen: null,
      summary: '内訳のみ入力',
    }
  }

  // expectedEntered && expected > 0
  if (!actualEntered) {
    return {
      status: 'blocking',
      expectedAmountYen: expected,
      actualAmountYen: null,
      differenceYen: expected,
      summary: '内訳未入力',
    }
  }

  const differenceYen = (expected ?? 0) - (actual ?? 0)
  if (differenceYen === 0) {
    return {
      status: 'complete',
      expectedAmountYen: expected,
      actualAmountYen: actual,
      differenceYen: 0,
      summary: '一致しています',
    }
  }

  return {
    status: 'blocking',
    expectedAmountYen: expected,
    actualAmountYen: actual,
    differenceYen,
    summary: `不一致（差額 ${formatYen(Math.abs(differenceYen))}）`,
  }
}

const pushMatchItem = (
  items: FilingCheckItem[],
  params: {
    id: string
    category: FilingCheckItem['category']
    label: string
    balance: number | null | undefined
    breakdownSum: number
    breakdownCount: number
    actionTarget?: FilingCheckActionTarget
  },
) => {
  const expectedEntered = isSettlementAmountEntered(params.balance)
  const actualEntered = params.breakdownCount > 0
  const result = compareSettlementAmount({
    expectedAmountYen: expectedEntered ? params.balance! : null,
    actualAmountYen: actualEntered ? params.breakdownSum : null,
    expectedEntered,
    actualEntered,
  })

  const detailParts: string[] = []
  if (result.expectedAmountYen != null) {
    detailParts.push(`残高：${formatYen(result.expectedAmountYen)}`)
  } else {
    detailParts.push('残高：未入力')
  }
  if (result.actualAmountYen != null) {
    detailParts.push(`内訳合計：${formatYen(result.actualAmountYen)}`)
  } else if (params.breakdownCount === 0) {
    detailParts.push('内訳：なし')
  }
  if (result.differenceYen != null && result.differenceYen !== 0) {
    detailParts.push(`差額：${formatYen(Math.abs(result.differenceYen))}`)
  }

  items.push({
    id: params.id,
    category: params.category,
    label: params.label,
    status: result.status,
    summary: result.summary,
    detail: detailParts.join(' / '),
    expectedAmountYen: result.expectedAmountYen ?? undefined,
    actualAmountYen: result.actualAmountYen ?? undefined,
    differenceYen: result.differenceYen ?? undefined,
    actionTarget: params.actionTarget,
  })
}

const hasExpenseVoucher = (expense: StoredAccountingExpense): boolean => {
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

const getConsumptionTaxAmount = (expense: StoredAccountingExpense): number =>
  expense.consumptionTaxAmount ?? expense.taxAmount ?? 0

const isNonTaxableCategory = (expense: StoredAccountingExpense): boolean => {
  const category = normalizeTaxCategory(expense.taxCategory)
  return category === 'non_taxable' || category === 'out_of_scope'
}

const isExpenseInPeriodMonths = (
  expense: StoredAccountingExpense,
  months: string[],
): boolean => {
  if (months.length === 0) {
    return false
  }
  const month = getExpensePostingDate(expense).slice(0, 7)
  return months.includes(month)
}

const pushPlannedItems = (items: FilingCheckItem[]) => {
  const planned: Array<{ id: string; label: string; summary: string; category: FilingCheckItem['category'] }> = [
    {
      id: 'planned.corporateTax',
      label: '法人税額の本計算',
      summary: 'Phase 4で対応予定',
      category: 'tax',
    },
    {
      id: 'planned.localTax',
      label: '地方税額の本計算',
      summary: 'Phase 4で対応予定',
      category: 'tax',
    },
    {
      id: 'planned.betsuhyo4',
      label: '別表四の加算・減算',
      summary: 'Phase 4で対応予定',
      category: 'tax',
    },
    {
      id: 'planned.betsuhyo5',
      label: '別表五',
      summary: 'Phase 4で対応予定',
      category: 'tax',
    },
    {
      id: 'planned.consumptionTaxReturn',
      label: '消費税申告額の本計算',
      summary: 'Phase 4で対応予定',
      category: 'tax',
    },
    {
      id: 'planned.fullBalanceSheetEquality',
      label: '正式な資産合計と負債・純資産合計の一致確認',
      summary: '全BS項目が揃った後の別Phaseで対応予定',
      category: 'settlement',
    },
    {
      id: 'planned.ledgers',
      label: '仕訳帳・総勘定元帳との整合確認',
      summary: 'Phase 5で対応予定',
      category: 'system',
    },
    {
      id: 'nonOperating.planned',
      label: '営業外収益・費用',
      summary: '営業外収益・費用は今後対応',
      category: 'settlement',
    },
  ]

  for (const item of planned) {
    items.push({
      id: item.id,
      category: item.category,
      label: item.label,
      status: 'planned',
      summary: item.summary,
    })
  }
}

export type BuildAccountingFilingChecksInput = {
  targetYear: number
  fiscalPeriod: FiscalPeriod | null
  expenses: StoredAccountingExpense[]
  receipts: StoredAccountingReceipt[]
  unorganizedReceipts: StoredAccountingReceipt[]
  fixedAssets: StoredAccountingFixedAsset[]
  settlementAuxiliary: AccountingSettlementAuxiliaryInput | null
  company: Company | null
  /**
   * When set, treat settlement-auxiliary fetch failure as blocking.
   * Do not treat permission-denied / load errors as “empty defaults”.
   */
  settlementAuxiliaryLoadError?: string | null
}

export const buildAccountingFilingChecks = (
  input: BuildAccountingFilingChecksInput,
): FilingCheckSummary => {
  const items: FilingCheckItem[] = []
  const {
    fiscalPeriod,
    expenses,
    receipts,
    unorganizedReceipts,
    fixedAssets,
    settlementAuxiliary,
    settlementAuxiliaryLoadError,
  } = input
  void input.company
  void input.targetYear

  if (settlementAuxiliaryLoadError) {
    items.push({
      id: 'system.settlementAuxiliaryLoad',
      category: 'system',
      label: '決算補助データの取得',
      status: 'blocking',
      summary: '決算補助データの取得に失敗したため、提出準備を完了扱いにできません',
      detail: settlementAuxiliaryLoadError,
      actionTarget: 'settlement-auxiliary',
    })
  }

  // --- period ---
  if (!fiscalPeriod) {
    items.push({
      id: 'period.available',
      category: 'period',
      label: '会計年度',
      status: 'blocking',
      summary: '会社設立前の年度です',
      actionTarget: 'etax',
    })
  } else {
    items.push({
      id: 'period.available',
      category: 'period',
      label: '会計年度',
      status: 'complete',
      summary: fiscalPeriod.label,
      detail: `${fiscalPeriod.startDate}〜${fiscalPeriod.endDate}`,
    })

    const basic = settlementAuxiliary?.companyBasic
    if (basic?.fiscalYearStartDate || basic?.fiscalYearEndDate) {
      const startMismatch =
        basic.fiscalYearStartDate && basic.fiscalYearStartDate !== fiscalPeriod.startDate
      const endMismatch =
        basic.fiscalYearEndDate && basic.fiscalYearEndDate !== fiscalPeriod.endDate
      if (startMismatch || endMismatch) {
        items.push({
          id: 'period.auxiliaryDates',
          category: 'period',
          label: '決算補助の会計期間',
          status: 'warning',
          summary: '決算補助の開始日・終了日が会計年度と異なります',
          detail: `補助：${basic.fiscalYearStartDate || '未設定'}〜${basic.fiscalYearEndDate || '未設定'} / 期間：${fiscalPeriod.startDate}〜${fiscalPeriod.endDate}`,
          actionTarget: 'settlement-auxiliary',
        })
      } else {
        items.push({
          id: 'period.auxiliaryDates',
          category: 'period',
          label: '決算補助の会計期間',
          status: 'complete',
          summary: '会計年度と一致しています',
        })
      }
    }

    items.push({
      id: 'period.asOfMonth',
      category: 'period',
      label: '基準月（期末）',
      status: 'notApplicable',
      summary: '比較対象となる保存済み基準月がありません',
      detail: `申告資料の基準月は会計年度期末（${fiscalPeriod.endYearMonth}）を使用します`,
    })
  }

  const fiscalMonths = fiscalPeriod ? getFiscalPeriodMonths(fiscalPeriod) : []
  const periodExpenses = expenses.filter(
    (expense) => !isExpenseDeleted(expense) && isExpenseInPeriodMonths(expense, fiscalMonths),
  )
  const eligibleExpenses = periodExpenses.filter((expense) => isExpenseEligibleForReporting(expense))
  const receiptsById = new Map(receipts.map((receipt) => [receipt.id, receipt]))
  const expensesById = new Map(expenses.map((expense) => [expense.id, expense]))
  const periodExpenseIds = new Set(periodExpenses.map((expense) => expense.id))

  // --- receipts ---
  if (unorganizedReceipts.length > 0) {
    items.push({
      id: 'receipts.unorganized',
      category: 'receipts',
      label: '未整理領収書',
      status: 'blocking',
      summary: `${unorganizedReceipts.length}件の未整理領収書があります`,
      affectedCount: unorganizedReceipts.length,
      sourceIds: unorganizedReceipts.map((row) => row.id),
      actionTarget: 'unorganized-receipts',
    })
  } else {
    items.push({
      id: 'receipts.unorganized',
      category: 'receipts',
      label: '未整理領収書',
      status: 'complete',
      summary: '未整理領収書はありません',
      affectedCount: 0,
    })
  }

  const missingVoucherBlocking = eligibleExpenses.filter(
    (expense) => !hasExpenseVoucher(expense) && !expense.normalExpenseOverrideConfirmed,
  )
  const missingVoucherWarning = eligibleExpenses.filter(
    (expense) => !hasExpenseVoucher(expense) && expense.normalExpenseOverrideConfirmed,
  )

  if (missingVoucherBlocking.length > 0) {
    items.push({
      id: 'receipts.expenseMissingVoucher',
      category: 'receipts',
      label: '証憑なし経費',
      status: 'blocking',
      summary: `${missingVoucherBlocking.length}件の経費に証憑がありません`,
      affectedCount: missingVoucherBlocking.length,
      sourceIds: missingVoucherBlocking.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else if (missingVoucherWarning.length > 0) {
    items.push({
      id: 'receipts.expenseMissingVoucher',
      category: 'receipts',
      label: '証憑なし経費',
      status: 'warning',
      summary: `${missingVoucherWarning.length}件は通常経費上書き確認済みの証憑なし経費です`,
      affectedCount: missingVoucherWarning.length,
      sourceIds: missingVoucherWarning.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'receipts.expenseMissingVoucher',
      category: 'receipts',
      label: '証憑なし経費',
      status: 'complete',
      summary: '証憑が必要な経費は揃っています',
      affectedCount: 0,
    })
  }

  const expenseReceiptMissing = eligibleExpenses.filter((expense) => {
    const receiptId = expense.receiptId?.trim()
    if (!receiptId) {
      return false
    }
    return !receiptsById.has(receiptId)
  })
  if (expenseReceiptMissing.length > 0) {
    items.push({
      id: 'receipts.expenseReceiptMissing',
      category: 'receipts',
      label: '経費の領収書リンク切れ',
      status: 'blocking',
      summary: `${expenseReceiptMissing.length}件の経費で参照先領収書がありません`,
      affectedCount: expenseReceiptMissing.length,
      sourceIds: expenseReceiptMissing.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'receipts.expenseReceiptMissing',
      category: 'receipts',
      label: '経費の領収書リンク切れ',
      status: 'complete',
      summary: '経費の領収書リンクは有効です',
      affectedCount: 0,
    })
  }

  const orphanLinkedExpense = receipts.filter((receipt) =>
    isOrphanLinkedReceipt(receipt, expensesById),
  )
  if (orphanLinkedExpense.length > 0) {
    items.push({
      id: 'receipts.orphanLinkedExpense',
      category: 'receipts',
      label: '領収書の経費リンク切れ',
      status: 'blocking',
      summary: `${orphanLinkedExpense.length}件の領収書で参照先経費がありません`,
      affectedCount: orphanLinkedExpense.length,
      sourceIds: orphanLinkedExpense.map((row) => row.id),
      actionTarget: 'unorganized-receipts',
    })
  } else {
    items.push({
      id: 'receipts.orphanLinkedExpense',
      category: 'receipts',
      label: '領収書の経費リンク切れ',
      status: 'complete',
      summary: '領収書の経費リンクは有効です',
      affectedCount: 0,
    })
  }

  const linkMismatchIds = new Set<string>()
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
      linkMismatchIds.add(expense.id)
      linkMismatchIds.add(receipt.id)
    }
  }
  for (const receipt of receipts) {
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
      linkMismatchIds.add(expense.id)
      linkMismatchIds.add(receipt.id)
    }
  }
  if (linkMismatchIds.size > 0) {
    items.push({
      id: 'receipts.linkMismatch',
      category: 'receipts',
      label: '経費・領収書の双方向リンク不一致',
      status: 'blocking',
      summary: `${linkMismatchIds.size}件で経費と領収書の相互リンクが矛盾しています`,
      affectedCount: linkMismatchIds.size,
      sourceIds: [...linkMismatchIds],
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'receipts.linkMismatch',
      category: 'receipts',
      label: '経費・領収書の双方向リンク不一致',
      status: 'complete',
      summary: '双方向リンクの矛盾はありません',
      affectedCount: 0,
    })
  }

  const periodLinkedReceipts = receipts.filter((receipt) => {
    const isLinked = Boolean(receipt.linkedExpenseId?.trim()) || receipt.status === 'linked'
    if (!isLinked) {
      return false
    }
    const receiptMonth = receipt.receiptDate?.slice(0, 7) ?? ''
    const inPeriodByDate = Boolean(receiptMonth) && fiscalMonths.includes(receiptMonth)
    const linkedExpenseId = receipt.linkedExpenseId?.trim()
    const inPeriodByExpense = Boolean(linkedExpenseId && periodExpenseIds.has(linkedExpenseId))
    return inPeriodByDate || inPeriodByExpense
  })
  const missingOriginalStorage = periodLinkedReceipts.filter(
    (receipt) => !hasReceiptOriginalStorage(receipt),
  )
  if (missingOriginalStorage.length > 0) {
    items.push({
      id: 'receipts.missingOriginalStorage',
      category: 'receipts',
      label: '証憑原本ファイル',
      status: 'blocking',
      summary: `${missingOriginalStorage.length}件の連結領収書に原本ファイルがありません`,
      detail: '原本ファイルがありません',
      affectedCount: missingOriginalStorage.length,
      sourceIds: missingOriginalStorage.map((row) => row.id),
      actionTarget: 'unorganized-receipts',
    })
  } else {
    items.push({
      id: 'receipts.missingOriginalStorage',
      category: 'receipts',
      label: '証憑原本ファイル',
      status: 'complete',
      summary: '連結領収書の原本ファイルは揃っています',
      affectedCount: 0,
    })
  }

  // --- expenses ---
  const unconfirmed = periodExpenses.filter((expense) => expense.confirmationStatus === '未確認')
  if (unconfirmed.length > 0) {
    items.push({
      id: 'expenses.unconfirmed',
      category: 'expenses',
      label: '未確認経費',
      status: 'blocking',
      summary: `${unconfirmed.length}件の未確認経費があります`,
      affectedCount: unconfirmed.length,
      sourceIds: unconfirmed.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'expenses.unconfirmed',
      category: 'expenses',
      label: '未確認経費',
      status: 'complete',
      summary: '未確認経費はありません',
      affectedCount: 0,
    })
  }

  const missingCategory = eligibleExpenses.filter(
    (expense) =>
      normalizePlTreatment(expense.plTreatment) === 'expense' &&
      !isExpenseCategorySelected(expense.expenseCategory),
  )
  if (missingCategory.length > 0) {
    items.push({
      id: 'expenses.missingCategory',
      category: 'expenses',
      label: '勘定科目未設定',
      status: 'blocking',
      summary: `${missingCategory.length}件の経費で勘定科目が未設定です`,
      affectedCount: missingCategory.length,
      sourceIds: missingCategory.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'expenses.missingCategory',
      category: 'expenses',
      label: '勘定科目未設定',
      status: 'complete',
      summary: '勘定科目は設定済みです',
      affectedCount: 0,
    })
  }

  const missingTaxRateBlocking = eligibleExpenses.filter((expense) => {
    if (expense.taxRate != null) {
      return false
    }
    if (isNonTaxableCategory(expense)) {
      return false
    }
    return true
  })

  if (missingTaxRateBlocking.length > 0) {
    items.push({
      id: 'expenses.missingTaxRate',
      category: 'expenses',
      label: '消費税率未設定',
      status: 'blocking',
      summary: `${missingTaxRateBlocking.length}件の経費で消費税率が未設定です`,
      affectedCount: missingTaxRateBlocking.length,
      sourceIds: missingTaxRateBlocking.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'expenses.missingTaxRate',
      category: 'expenses',
      label: '消費税率未設定',
      status: 'complete',
      summary: '消費税率は設定済みです',
      affectedCount: 0,
    })
  }

  const taxOnExempt = eligibleExpenses.filter(
    (expense) => isNonTaxableCategory(expense) && getConsumptionTaxAmount(expense) > 0,
  )
  if (taxOnExempt.length > 0) {
    items.push({
      id: 'expenses.taxAmountOnExempt',
      category: 'tax',
      label: '非課税等に消費税額あり',
      status: 'warning',
      summary: `${taxOnExempt.length}件の非課税・対象外経費に消費税額が残っています`,
      affectedCount: taxOnExempt.length,
      sourceIds: taxOnExempt.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'expenses.taxAmountOnExempt',
      category: 'tax',
      label: '非課税等に消費税額あり',
      status: 'complete',
      summary: '税区分と税額に矛盾はありません',
      affectedCount: 0,
    })
  }

  const fixedAssetCandidatesBlocking = eligibleExpenses.filter((expense) => {
    if (normalizePlTreatment(expense.plTreatment) !== 'expense') {
      return false
    }
    if (expense.normalExpenseOverrideConfirmed) {
      return false
    }
    return detectFixedAssetRegistrationWarning({
      amountYen: expense.taxIncludedAmount,
      description: expense.description,
      vendorName: expense.vendorName,
    }).shouldWarn
  })
  const fixedAssetCandidatesOverridden = eligibleExpenses.filter((expense) => {
    if (normalizePlTreatment(expense.plTreatment) !== 'expense') {
      return false
    }
    if (!expense.normalExpenseOverrideConfirmed) {
      return false
    }
    return detectFixedAssetRegistrationWarning({
      amountYen: expense.taxIncludedAmount,
      description: expense.description,
      vendorName: expense.vendorName,
    }).shouldWarn
  })

  if (fixedAssetCandidatesBlocking.length > 0) {
    items.push({
      id: 'expenses.fixedAssetCandidate',
      category: 'expenses',
      label: '固定資産候補',
      status: 'blocking',
      summary: `${fixedAssetCandidatesBlocking.length}件が固定資産候補のまま通常経費です`,
      affectedCount: fixedAssetCandidatesBlocking.length,
      sourceIds: fixedAssetCandidatesBlocking.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else if (fixedAssetCandidatesOverridden.length > 0) {
    items.push({
      id: 'expenses.fixedAssetCandidate',
      category: 'expenses',
      label: '固定資産候補',
      status: 'warning',
      summary: `${fixedAssetCandidatesOverridden.length}件は通常経費上書き確認済みです`,
      affectedCount: fixedAssetCandidatesOverridden.length,
      sourceIds: fixedAssetCandidatesOverridden.map((row) => row.id),
      actionTarget: 'expenses',
    })
  } else {
    items.push({
      id: 'expenses.fixedAssetCandidate',
      category: 'expenses',
      label: '固定資産候補',
      status: 'complete',
      summary: '未確認の固定資産候補はありません',
      affectedCount: 0,
    })
  }

  // --- fixed assets ---
  const ledgerAssets = fixedAssets.filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
  const asOfYearMonth = fiscalPeriod?.endYearMonth ?? ''

  const negativeBookValue = ledgerAssets.filter((asset) => {
    // Official calc clamps to 0; also flag corrupt stored ledger values.
    if (typeof asset.remainingBookValue === 'number' && asset.remainingBookValue < 0) {
      return true
    }
    if (!asOfYearMonth) {
      return false
    }
    return calculateRemainingBookValue(asset, asOfYearMonth) < 0
  })
  if (negativeBookValue.length > 0) {
    items.push({
      id: 'fixedAssets.negativeBookValue',
      category: 'fixedAssets',
      label: '負の帳簿価額',
      status: 'blocking',
      summary: `${negativeBookValue.length}件の固定資産で期末帳簿価額がマイナスです`,
      affectedCount: negativeBookValue.length,
      sourceIds: negativeBookValue.map((row) => row.id),
      actionTarget: 'fixed-assets',
    })
  } else {
    items.push({
      id: 'fixedAssets.negativeBookValue',
      category: 'fixedAssets',
      label: '負の帳簿価額',
      status: 'complete',
      summary: '期末帳簿価額がマイナスの資産はありません',
      affectedCount: 0,
    })
  }

  const incompleteAssets = ledgerAssets.filter(
    (asset) =>
      !asset.purchaseDate?.trim() ||
      !asset.useStartDate?.trim() ||
      !asset.appliedUsefulLifeYears ||
      !asset.depreciationStartYearMonth?.trim(),
  )
  if (incompleteAssets.length > 0) {
    items.push({
      id: 'fixedAssets.incomplete',
      category: 'fixedAssets',
      label: '固定資産台帳の未入力',
      status: 'warning',
      summary: `${incompleteAssets.length}件の固定資産で必須項目が不足しています`,
      detail: '取得日・使用開始日・耐用年数・償却開始月を確認してください',
      affectedCount: incompleteAssets.length,
      sourceIds: incompleteAssets.map((row) => row.id),
      actionTarget: 'fixed-assets',
    })
  } else if (ledgerAssets.length === 0) {
    items.push({
      id: 'fixedAssets.incomplete',
      category: 'fixedAssets',
      label: '固定資産台帳の未入力',
      status: 'notApplicable',
      summary: '固定資産はありません',
      affectedCount: 0,
    })
  } else {
    items.push({
      id: 'fixedAssets.incomplete',
      category: 'fixedAssets',
      label: '固定資産台帳の未入力',
      status: 'complete',
      summary: '固定資産台帳の必須項目は揃っています',
      affectedCount: 0,
    })
  }

  const netBookValue = asOfYearMonth
    ? ledgerAssets.reduce((sum, asset) => sum + calculateRemainingBookValue(asset, asOfYearMonth), 0)
    : 0
  const shortYearMonthsOutOfRange =
    fiscalPeriod?.isShortFiscalYear === true &&
    getFiscalPeriodMonths(fiscalPeriod).some((month) => month < fiscalPeriod.startYearMonth)
  const shortYearNote =
    fiscalPeriod?.isShortFiscalYear === true && !shortYearMonthsOutOfRange
      ? '初年度短縮のため償却対象月は期末会計年度の月のみ'
      : undefined

  if (ledgerAssets.length === 0) {
    items.push({
      id: 'fixedAssets.endingBookValue',
      category: 'fixedAssets',
      label: '固定資産台帳の期末帳簿価額',
      status: 'notApplicable',
      summary: '固定資産台帳に登録がありません',
      affectedCount: 0,
      actionTarget: 'fixed-assets',
    })
  } else if (negativeBookValue.length > 0 || shortYearMonthsOutOfRange) {
    items.push({
      id: 'fixedAssets.endingBookValue',
      category: 'fixedAssets',
      label: '固定資産台帳の期末帳簿価額',
      status: 'blocking',
      summary: shortYearMonthsOutOfRange
        ? '初年度短縮の償却対象月に会計年度開始前の月が含まれています'
        : `${negativeBookValue.length}件で期末帳簿価額がマイナスです`,
      detail: [
        '決算補助に独立した固定資産残高が無いため突合は未実施',
        shortYearNote,
      ]
        .filter(Boolean)
        .join(' / '),
      actualAmountYen: netBookValue,
      sourceIds: negativeBookValue.map((row) => row.id),
      actionTarget: 'fixed-assets',
    })
  } else {
    items.push({
      id: 'fixedAssets.endingBookValue',
      category: 'fixedAssets',
      label: '固定資産台帳の期末帳簿価額',
      status: 'complete',
      summary: `期末基準月=${asOfYearMonth} / 台帳合計=${formatYen(netBookValue)}`,
      detail: [
        '決算補助に独立した固定資産残高が無いため突合は未実施',
        shortYearNote,
      ]
        .filter(Boolean)
        .join(' / '),
      actualAmountYen: netBookValue,
      actionTarget: 'fixed-assets',
    })
  }

  // --- settlement balance / breakdown ---
  // Fetch failure must not look like “empty auxiliary defaults”.
  if (settlementAuxiliaryLoadError) {
    pushPlannedItems(items)
    return summarizeFilingChecks(items)
  }

  const balance = settlementAuxiliary?.yearEndBalance
  const auxiliary = settlementAuxiliary

  pushMatchItem(items, {
    id: 'settlement.depositsMatch',
    category: 'cashAndBank',
    label: '預金残高と内訳合計',
    balance: balance?.deposits,
    breakdownSum: sumSettlementBreakdownBalances(auxiliary?.bankAccounts ?? []),
    breakdownCount: auxiliary?.bankAccounts.length ?? 0,
    actionTarget: 'settlement-auxiliary',
  })

  pushMatchItem(items, {
    id: 'settlement.borrowingsMatch',
    category: 'liabilities',
    label: '借入金残高と内訳合計',
    balance: balance?.borrowings,
    breakdownSum: sumSettlementBreakdownBalances(auxiliary?.loans ?? []),
    breakdownCount: auxiliary?.loans.length ?? 0,
    actionTarget: 'settlement-auxiliary',
  })

  pushMatchItem(items, {
    id: 'settlement.accountsPayableMatch',
    category: 'liabilities',
    label: '未払金残高と内訳合計',
    balance: balance?.accountsPayable,
    breakdownSum: sumSettlementBreakdownBalances(auxiliary?.payables ?? []),
    breakdownCount: auxiliary?.payables.length ?? 0,
    actionTarget: 'settlement-auxiliary',
  })

  pushMatchItem(items, {
    id: 'settlement.officerLoansMatch',
    category: 'liabilities',
    label: '役員借入金残高と内訳合計',
    balance: balance?.officerLoans,
    breakdownSum: sumSettlementBreakdownBalances(auxiliary?.officerLoans ?? []),
    breakdownCount: auxiliary?.officerLoans.length ?? 0,
    actionTarget: 'settlement-auxiliary',
  })

  pushMatchItem(items, {
    id: 'settlement.accountsReceivableMatch',
    category: 'cashAndBank',
    label: '売掛金残高と内訳合計',
    balance: balance?.accountsReceivable,
    breakdownSum: sumReceivableBreakdownByKind(auxiliary?.receivables ?? [], 'accountsReceivable'),
    breakdownCount: (auxiliary?.receivables ?? []).filter(
      (row) => (row.receivableKind ?? 'accountsReceivable') === 'accountsReceivable',
    ).length,
    actionTarget: 'settlement-auxiliary',
  })

  pushMatchItem(items, {
    id: 'settlement.accruedIncomeMatch',
    category: 'cashAndBank',
    label: '未収金残高と内訳合計',
    balance: balance?.accruedIncome,
    breakdownSum: sumReceivableBreakdownByKind(auxiliary?.receivables ?? [], 'accruedIncome'),
    breakdownCount: (auxiliary?.receivables ?? []).filter((row) => row.receivableKind === 'accruedIncome')
      .length,
    actionTarget: 'settlement-auxiliary',
  })

  // unset key balances → warning (not blocking)
  const cashEntered = isSettlementAmountEntered(balance?.cash)
  if (!cashEntered) {
    items.push({
      id: 'settlement.cashUnset',
      category: 'cashAndBank',
      label: '現金残高',
      status: 'warning',
      summary: '現金残高が未入力です',
      actionTarget: 'settlement-auxiliary',
    })
  } else if (balance!.cash === 0) {
    items.push({
      id: 'settlement.cashUnset',
      category: 'cashAndBank',
      label: '現金残高',
      status: 'notApplicable',
      summary: '該当なし（0円）',
      expectedAmountYen: 0,
      actionTarget: 'settlement-auxiliary',
    })
  } else {
    items.push({
      id: 'settlement.cashUnset',
      category: 'cashAndBank',
      label: '現金残高',
      status: 'complete',
      summary: `現金残高 ${formatYen(balance!.cash!)}`,
      expectedAmountYen: balance!.cash!,
      actionTarget: 'settlement-auxiliary',
    })
  }

  // capital — always warning; never invent company master match / never notApplicable for 0
  const capitalEntered = isSettlementAmountEntered(balance?.capital)
  if (!capitalEntered) {
    items.push({
      id: 'settlement.capital',
      category: 'capital',
      label: '資本金と会社基本情報',
      status: 'warning',
      summary: '資本金が未入力です',
      actionTarget: 'settlement-auxiliary',
    })
  } else if (balance!.capital === 0) {
    items.push({
      id: 'settlement.capital',
      category: 'capital',
      label: '資本金と会社基本情報',
      status: 'warning',
      summary:
        '資本金が0円で入力されています。株式会社では通常想定しにくいため確認してください。',
      expectedAmountYen: 0,
      actionTarget: 'settlement-auxiliary',
    })
  } else if (hasPositiveSettlementAmount(balance?.capital)) {
    items.push({
      id: 'settlement.capital',
      category: 'capital',
      label: '資本金と会社基本情報',
      status: 'warning',
      summary: '資本金の入力額は確認できましたが、会社基本情報との自動照合には未対応です。',
      detail: `入力額：${formatYen(balance!.capital!)}`,
      expectedAmountYen: balance!.capital!,
      actionTarget: 'settlement-auxiliary',
    })
  }

  pushPlannedItems(items)

  return summarizeFilingChecks(items)
}

/** Optional adapter for display — does not replace buildETaxCheckItems used by PDF/CSV. */
export const toETaxCheckItems = (
  summary: FilingCheckSummary,
): Array<{
  mappingId: string
  label: string
  status: 'required' | 'na' | 'review' | 'planned'
  category: string
  detail?: string
}> =>
  summary.items
    .filter((item) => item.status === 'blocking' || item.status === 'warning' || item.status === 'planned')
    .map((item) => ({
      mappingId: item.id,
      label: item.label,
      status:
        item.status === 'blocking' ? 'required' : item.status === 'warning' ? 'review' : 'planned',
      category: item.category,
      detail: item.detail ?? item.summary,
    }))

export const formatFilingCheckStatus = (status: FilingCheckStatus): string =>
  FILING_CHECK_STATUS_LABELS[status]
