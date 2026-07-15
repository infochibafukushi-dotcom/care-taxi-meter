import type { StoredCaseRecord } from '../services/caseRecords'
import type {
  MonthlyProfitLoss,
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
} from '../types/accounting'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type {
  ETaxAccountBreakdownSection,
  ETaxBreakdownDetailRow,
  ETaxCheckItem,
  ETaxCheckStatus,
  ETaxCompanyProfile,
  ETaxFixedAssetRow,
  ETaxInputStatusSummary,
  ETaxPackage,
  ETaxReportLine,
  ETaxSmallAssetRow,
} from '../types/accountingETax'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'
import {
  calculateCumulativeDepreciationYen,
  calculateRemainingBookValue,
} from './accountingDepreciation'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod, getFiscalPeriodMonths } from './accountingFiscalPeriod'
import {
  FIXED_EXPENSE_CATEGORIES,
  getExpensePostingDate,
  isExpenseEligibleForReporting,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../types/accounting'
import { calculateMonthlyProfitLoss } from './accountingPl'
import { corporateNumberFromInvoiceNumber } from '../services/invoiceRegistrantLookup'
import type { Company } from '../types/work'
import type { MeterSettings } from '../services/meterSettings'
import {
  formatSettlementAmountDisplay,
  getSettlementAmountStatus,
  hasPositiveSettlementAmount,
  hasSettlementCount,
  hasSettlementText,
  isSettlementAmountEntered,
  SETTLEMENT_NOT_APPLICABLE,
  sumReceivableBreakdownByKind,
  sumSettlementBreakdownBalances,
} from './accountingSettlementAuxiliaryForm'

const UNSET = '未設定'
const PLANNED = '今後対応予定'

export const ETaxCheckStatusLabels: Record<ETaxCheckStatus, string> = {
  required: '要入力',
  na: '該当なし',
  review: '要確認',
  planned: '今後対応予定',
}

export const formatETaxCheckItemStatus = (status: ETaxCheckStatus) => ETaxCheckStatusLabels[status]

/** @deprecated use formatETaxCheckItemStatus */
export const formatETaxMissingItemStatus = formatETaxCheckItemStatus

const line = (
  mappingId: string,
  label: string,
  amountYen: number | null | undefined,
  status: ETaxReportLine['status'] = amountYen != null && amountYen !== 0 ? 'set' : 'unset',
): ETaxReportLine => ({
  mappingId,
  label,
  amountYen: amountYen ?? null,
  displayValue:
    status === 'unset'
      ? UNSET
      : status === 'na'
        ? SETTLEMENT_NOT_APPLICABLE
        : status === 'planned'
          ? PLANNED
          : typeof amountYen === 'number'
            ? String(amountYen)
            : UNSET,
  status,
})

const textLine = (
  mappingId: string,
  label: string,
  textValue: string | null | undefined,
  status: ETaxReportLine['status'] = hasSettlementText(textValue) ? 'set' : 'unset',
): ETaxReportLine => ({
  mappingId,
  label,
  displayValue: status === 'planned' ? PLANNED : hasSettlementText(textValue) ? String(textValue) : UNSET,
  status,
})

const plannedLine = (mappingId: string, label: string): ETaxReportLine => ({
  mappingId,
  label,
  displayValue: PLANNED,
  status: 'planned',
})

const unsetLine = (mappingId: string, label: string): ETaxReportLine => ({
  mappingId,
  label,
  displayValue: UNSET,
  status: 'unset',
})

const balanceLine = (
  mappingId: string,
  label: string,
  amountYen: number | null | undefined,
): ETaxReportLine => {
  const status = getSettlementAmountStatus(amountYen)
  return {
    mappingId,
    label,
    amountYen: isSettlementAmountEntered(amountYen) ? amountYen : null,
    displayValue: formatSettlementAmountDisplay(amountYen),
    status,
  }
}

/** @deprecated Prefer accountingFiscalPeriod APIs. Kept for callers. */
export const getFiscalYearMonths = (fiscalYear: number) => {
  const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, fiscalYear)
  return period ? getFiscalPeriodMonths(period) : []
}

const sumProfitLossColumns = (rows: MonthlyProfitLoss[]): MonthlyProfitLoss => {
  if (rows.length === 0) {
    return calculateMonthlyProfitLoss({
      caseRecords: [],
      expenses: [],
      adjustments: [],
      fixedCosts: [],
      fixedAssets: [],
      targetYearMonth: '',
    })
  }

  const [first, ...rest] = rows
  return rest.reduce((accumulator, current) => {
    const sales = { ...accumulator.sales }
    Object.keys(sales).forEach((key) => {
      const category = key as keyof typeof sales
      sales[category] += current.sales[category]
    })

    const mergeBreakdown = (
      left: MonthlyProfitLoss['costOfSales'],
      right: MonthlyProfitLoss['costOfSales'],
    ) => {
      const next = { ...left }
      Object.keys(next).forEach((key) => {
        const category = key as keyof typeof next
        next[category] += right[category]
      })
      return next
    }

    const costOfSales = mergeBreakdown(accumulator.costOfSales, current.costOfSales)
    const fixedCosts = mergeBreakdown(accumulator.fixedCosts, current.fixedCosts)
    const variableExpenses = mergeBreakdown(accumulator.variableExpenses, current.variableExpenses)
    const deferredCandidate = mergeBreakdown(accumulator.deferredCandidate, current.deferredCandidate)
    const expenses = mergeBreakdown(accumulator.expenses, current.expenses)

    const salesTotalYen = accumulator.salesTotalYen + current.salesTotalYen
    const costOfSalesTotalYen = accumulator.costOfSalesTotalYen + current.costOfSalesTotalYen
    const fixedCostsTotalYen = accumulator.fixedCostsTotalYen + current.fixedCostsTotalYen
    const variableExpensesTotalYen = accumulator.variableExpensesTotalYen + current.variableExpensesTotalYen
    const grossProfitYen = salesTotalYen - costOfSalesTotalYen
    const operatingProfitYen = grossProfitYen - fixedCostsTotalYen - variableExpensesTotalYen

    return {
      ...accumulator,
      sales,
      salesTotalYen,
      costOfSales,
      costOfSalesTotalYen,
      grossProfitYen,
      fixedCosts,
      fixedCostsTotalYen,
      variableExpenses,
      variableExpensesTotalYen,
      deferredCandidate,
      expenses,
      expensesTotalYen: accumulator.expensesTotalYen + current.expensesTotalYen,
      deferredCandidateTotalYen: accumulator.deferredCandidateTotalYen + current.deferredCandidateTotalYen,
      operatingProfitYen,
      caseRecordCount: accumulator.caseRecordCount + current.caseRecordCount,
      confirmedExpenseCount: accumulator.confirmedExpenseCount + current.confirmedExpenseCount,
      fixedCostCount: accumulator.fixedCostCount + current.fixedCostCount,
      deferredCandidateCount: accumulator.deferredCandidateCount + current.deferredCandidateCount,
    }
  }, first)
}

export const calculateFiscalYearProfitLoss = ({
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  targetYear,
}: {
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  targetYear: number
}): MonthlyProfitLoss => {
  const months = getFiscalYearMonths(targetYear)
  const monthlyRows = months.map((targetYearMonth) =>
    calculateMonthlyProfitLoss({
      caseRecords,
      expenses,
      adjustments,
      fixedCosts,
      fixedAssets,
      targetYearMonth,
    }),
  )
  const merged = sumProfitLossColumns(monthlyRows)
  return { ...merged, targetYearMonth: `${targetYear}-FY` }
}

export const calculateFiscalYearMonthlyProfitLoss = ({
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  targetYear,
}: {
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  targetYear: number
}) =>
  getFiscalYearMonths(targetYear).map((targetYearMonth) =>
    calculateMonthlyProfitLoss({
      caseRecords,
      expenses,
      adjustments,
      fixedCosts,
      fixedAssets,
      targetYearMonth,
    }),
  )

export const buildETaxCompanyProfile = ({
  targetYear,
  company,
  meterSettings,
}: {
  targetYear: number
  company: Company | null
  meterSettings: MeterSettings | null
}): ETaxCompanyProfile => {
  const invoiceNumber = meterSettings?.receipt?.invoiceNumber ?? company?.invoiceNumber ?? ''
  const corporateNumber = corporateNumberFromInvoiceNumber(invoiceNumber) || UNSET

  return {
    targetYear,
    fiscalYearLabel:
      getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, targetYear)?.label ?? '会社設立前の年度です',
    companyName:
      company?.corporateName ||
      company?.name ||
      meterSettings?.company?.corporateName ||
      meterSettings?.company?.companyName ||
      UNSET,
    corporateNumber,
    address: company?.address || meterSettings?.company?.address || UNSET,
    representativeName: company?.representativeName || company?.ownerName || UNSET,
  }
}

const isExpenseInFiscalYear = (expense: StoredAccountingExpense, targetYear: number) => {
  const month = getExpensePostingDate(expense).slice(0, 7)
  return getFiscalYearMonths(targetYear).includes(month)
}

const getFixedAssetTotals = (
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
) => {
  const ledgerAssets = fixedAssets.filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
  const grossFixedAssets = ledgerAssets.reduce((sum, asset) => sum + asset.acquisitionCost, 0)
  const accumulatedDepreciation = ledgerAssets.reduce(
    (sum, asset) => sum + (asset.acquisitionCost - calculateRemainingBookValue(asset, asOfYearMonth)),
    0,
  )
  const netFixedAssets = grossFixedAssets - accumulatedDepreciation
  return { grossFixedAssets, accumulatedDepreciation, netFixedAssets, ledgerAssets }
}

export const buildETaxSettlementSummary = (
  pl: MonthlyProfitLoss,
  fiscalYearLabel: string,
  fixedAssets: StoredAccountingFixedAsset[],
  smallAssets: StoredAccountingFixedAsset[],
  targetYear: number,
  auxiliary: AccountingSettlementAuxiliaryInput | null,
): ETaxReportLine[] => {
  const depreciationYen = pl.fixedCosts['減価償却費'] ?? 0
  const sgaYen = pl.fixedCostsTotalYen + pl.variableExpensesTotalYen - depreciationYen
  const balance = auxiliary?.yearEndBalance

  const fiscalMonths = getFiscalYearMonths(targetYear)
  const smallAssetTotal = smallAssets
    .filter((asset) => fiscalMonths.some((month) => asset.purchaseDate.startsWith(month)))
    .reduce((sum, asset) => sum + asset.acquisitionCost, 0)

  const fixedAssetAcquisitionTotal = fixedAssets
    .filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
    .filter((asset) => fiscalMonths.some((month) => asset.purchaseDate.startsWith(month)))
    .reduce((sum, asset) => sum + asset.acquisitionCost, 0)

  return [
    {
      mappingId: 'etax.summary.fiscalYear',
      label: '会計年度',
      displayValue: fiscalYearLabel,
      status: 'set',
    },
    line('etax.summary.sales', '売上高', pl.salesTotalYen),
    line('etax.summary.costOfSales', '売上原価', pl.costOfSalesTotalYen),
    line('etax.summary.grossProfit', '売上総利益', pl.grossProfitYen),
    line('etax.summary.sga', '販売管理費', sgaYen),
    line('etax.summary.operatingProfit', '営業利益', pl.operatingProfitYen),
    plannedLine('etax.summary.nonOperatingIncome', '営業外収益'),
    plannedLine('etax.summary.nonOperatingExpense', '営業外費用'),
    plannedLine('etax.summary.ordinaryProfit', '経常利益'),
    plannedLine('etax.summary.corporateTax', '法人税等'),
    plannedLine('etax.summary.netIncome', '当期純利益'),
    line('etax.summary.depreciation', '減価償却費', depreciationYen),
    line('etax.summary.smallAssets', '少額資産合計', smallAssetTotal),
    line('etax.summary.fixedAssetAcquisition', '固定資産取得額', fixedAssetAcquisitionTotal),
    balanceLine('etax.summary.cash', '現金残高', balance?.cash),
    balanceLine('etax.summary.deposits', '預金残高', balance?.deposits),
    balanceLine('etax.summary.borrowings', '借入金残高', balance?.borrowings),
    balanceLine('etax.summary.capital', '資本金', balance?.capital),
    balanceLine('etax.summary.officerLoan', '役員借入金', balance?.officerLoans),
  ]
}

export const buildETaxBalanceSheet = (
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
  auxiliary: AccountingSettlementAuxiliaryInput | null,
): ETaxReportLine[] => {
  const { grossFixedAssets, accumulatedDepreciation, netFixedAssets } = getFixedAssetTotals(
    fixedAssets,
    asOfYearMonth,
  )
  const balance = auxiliary?.yearEndBalance

  return [
    balanceLine('etax.bs.cash', '現金', balance?.cash),
    balanceLine('etax.bs.deposits', '普通預金', balance?.deposits),
    balanceLine('etax.bs.accountsReceivable', '売掛金', balance?.accountsReceivable),
    balanceLine('etax.bs.accruedIncome', '未収金', balance?.accruedIncome),
    balanceLine('etax.bs.prepayments', '仮払金', balance?.prepayments),
    line(
      'etax.bs.fixedAssetsGross',
      '固定資産（取得価額）',
      grossFixedAssets || null,
      grossFixedAssets > 0 ? 'set' : 'unset',
    ),
    line(
      'etax.bs.accumulatedDepreciation',
      '減価償却累計額',
      accumulatedDepreciation || null,
      accumulatedDepreciation > 0 ? 'set' : 'unset',
    ),
    line(
      'etax.bs.fixedAssetsNet',
      '固定資産（帳簿価額）',
      netFixedAssets || null,
      netFixedAssets > 0 ? 'set' : 'unset',
    ),
    balanceLine('etax.bs.borrowings', '借入金', balance?.borrowings),
    balanceLine('etax.bs.accountsPayable', '未払金', balance?.accountsPayable),
    balanceLine('etax.bs.officerLoans', '役員借入金', balance?.officerLoans),
    balanceLine('etax.bs.capital', '資本金', balance?.capital),
    balanceLine('etax.bs.retainedEarnings', '利益剰余金', balance?.retainedEarnings),
    ...(balance?.customAccounts ?? []).map((account) =>
      balanceLine(
        account.mappingId || `etax.bs.custom.${account.id}`,
        account.accountName,
        account.amountYen,
      ),
    ),
  ]
}

export const buildETaxBsInput = (
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
  auxiliary: AccountingSettlementAuxiliaryInput | null,
): ETaxReportLine[] => {
  const { netFixedAssets, accumulatedDepreciation } = getFixedAssetTotals(fixedAssets, asOfYearMonth)
  const balance = auxiliary?.yearEndBalance

  return [
    balanceLine('etax.bsInput.cash', '現金', balance?.cash),
    balanceLine('etax.bsInput.deposits', '普通預金', balance?.deposits),
    balanceLine('etax.bsInput.accountsReceivable', '売掛金', balance?.accountsReceivable),
    balanceLine('etax.bsInput.accruedIncome', '未収金', balance?.accruedIncome),
    balanceLine('etax.bsInput.prepayments', '仮払金', balance?.prepayments),
    line('etax.bsInput.fixedAssetsNet', '固定資産', netFixedAssets || null, netFixedAssets > 0 ? 'set' : 'unset'),
    line(
      'etax.bsInput.accumulatedDepreciation',
      '減価償却累計額',
      accumulatedDepreciation || null,
      accumulatedDepreciation > 0 ? 'set' : 'unset',
    ),
    balanceLine('etax.bsInput.accountsPayable', '未払金', balance?.accountsPayable),
    balanceLine('etax.bsInput.borrowings', '借入金', balance?.borrowings),
    balanceLine('etax.bsInput.officerLoans', '役員借入金', balance?.officerLoans),
    balanceLine('etax.bsInput.capital', '資本金', balance?.capital),
    balanceLine('etax.bsInput.retainedEarnings', '利益剰余金', balance?.retainedEarnings),
  ]
}

export const buildETaxFixedAssetRows = (
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
): ETaxFixedAssetRow[] =>
  fixedAssets
    .filter((asset) => asset.assetKind === 'fixed' && !asset.isDeleted)
    .map((asset) => ({
      mappingId: `etax.fixedAsset.${asset.id}`,
      assetName: asset.assetName,
      assetCategory: asset.assetCategory,
      purchaseDate: asset.purchaseDate,
      acquisitionCost: asset.acquisitionCost,
      usefulLifeYears: asset.appliedUsefulLifeYears,
      depreciationMethod: '定額法',
      monthlyDepreciationYen: asset.monthlyDepreciationYen,
      annualDepreciationYen: asset.monthlyDepreciationYen * 12,
      cumulativeDepreciationYen: calculateCumulativeDepreciationYen(asset, asOfYearMonth),
      remainingBookValue: calculateRemainingBookValue(asset, asOfYearMonth),
    }))

export const buildETaxSmallAssetRows = (fixedAssets: StoredAccountingFixedAsset[]): ETaxSmallAssetRow[] =>
  fixedAssets
    .filter((asset) => asset.assetKind === 'small' && !asset.isDeleted)
    .map((asset) => ({
      mappingId: `etax.smallAsset.${asset.id}`,
      purchaseDate: asset.purchaseDate,
      assetName: asset.assetName,
      acquisitionCost: asset.acquisitionCost,
      treatment: '少額資産（取得月一括費用化）',
      plPostingYearMonth: asset.depreciationStartYearMonth,
      notes: asset.notes ?? '',
    }))

const buildBreakdownSection = (
  sectionId: string,
  sectionLabel: string,
  mappingIdPrefix: string,
  headers: string[],
  rows: ETaxBreakdownDetailRow[],
  emptyStatus: 'unset' | 'na' = 'unset',
): ETaxAccountBreakdownSection => ({
  sectionId,
  sectionLabel,
  mappingIdPrefix,
  headers,
  rows,
  emptyStatus,
})

const resolveBreakdownEmptyStatus = (balance: number | null | undefined): 'unset' | 'na' => {
  const status = getSettlementAmountStatus(balance)
  return status === 'na' ? 'na' : 'unset'
}

const resolveReceivableBreakdownEmptyStatus = (
  accountsReceivable: number | null | undefined,
  accruedIncome: number | null | undefined,
): 'unset' | 'na' => {
  const receivableStatus = getSettlementAmountStatus(accountsReceivable)
  const accruedStatus = getSettlementAmountStatus(accruedIncome)
  if (receivableStatus === 'unset' || accruedStatus === 'unset') {
    return 'unset'
  }
  if (hasPositiveSettlementAmount(accountsReceivable) || hasPositiveSettlementAmount(accruedIncome)) {
    return 'unset'
  }
  return 'na'
}

export const buildETaxAccountBreakdown = (
  auxiliary: AccountingSettlementAuxiliaryInput | null,
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
): ETaxReportLine[] => {
  const balance = auxiliary?.yearEndBalance
  const { netFixedAssets } = getFixedAssetTotals(fixedAssets, asOfYearMonth)

  return [
    balanceLine('etax.account.cash', '現金', balance?.cash),
    balanceLine('etax.account.deposits', '普通預金', balance?.deposits),
    balanceLine('etax.account.accountsReceivable', '売掛金', balance?.accountsReceivable),
    balanceLine('etax.account.accruedIncome', '未収金', balance?.accruedIncome),
    balanceLine('etax.account.prepayments', '仮払金', balance?.prepayments),
    balanceLine('etax.account.accountsPayable', '未払金', balance?.accountsPayable),
    balanceLine('etax.account.borrowings', '借入金', balance?.borrowings),
    balanceLine('etax.account.officerLoan', '役員借入金', balance?.officerLoans),
    line('etax.account.fixedAssets', '固定資産', netFixedAssets || null, netFixedAssets > 0 ? 'set' : 'unset'),
  ]
}

export const buildETaxAccountBreakdownDetail = (
  auxiliary: AccountingSettlementAuxiliaryInput | null,
  fixedAssets: StoredAccountingFixedAsset[],
  asOfYearMonth: string,
): ETaxAccountBreakdownSection[] => {
  const balance = auxiliary?.yearEndBalance

  const bankRows: ETaxBreakdownDetailRow[] = (auxiliary?.bankAccounts ?? []).map((row) => ({
    mappingId: `etax.breakdown.bank.${row.id}`,
    values: [
      row.institutionName,
      row.branchName,
      row.accountType,
      row.accountLastFour,
      formatSettlementAmountDisplay(row.yearEndBalance),
      row.notes || '―',
    ],
  }))

  const receivableRows: ETaxBreakdownDetailRow[] = (auxiliary?.receivables ?? []).map((row) => ({
    mappingId: `etax.breakdown.receivable.${row.id}`,
    values: [
      row.receivableKind === 'accruedIncome' ? '未収金' : '売掛金',
      row.counterpartyName,
      row.registrationNumber,
      row.description,
      row.occurrenceDate,
      formatSettlementAmountDisplay(row.yearEndBalance),
      row.notes || '―',
    ],
  }))

  const prepaymentRows: ETaxBreakdownDetailRow[] = hasPositiveSettlementAmount(balance?.prepayments)
    ? [
        {
          mappingId: 'etax.breakdown.prepayments.summary',
          values: ['仮払金合計', '', '', '', String(balance?.prepayments), ''],
        },
      ]
    : []

  const payableRows: ETaxBreakdownDetailRow[] = (auxiliary?.payables ?? []).map((row) => ({
    mappingId: `etax.breakdown.payable.${row.id}`,
    values: [
      row.counterpartyName,
      row.registrationNumber,
      row.description,
      row.occurrenceDate,
      formatSettlementAmountDisplay(row.yearEndBalance),
      row.notes || '―',
    ],
  }))

  const loanRows: ETaxBreakdownDetailRow[] = (auxiliary?.loans ?? []).map((row) => ({
    mappingId: `etax.breakdown.loan.${row.id}`,
    values: [
      row.lenderName,
      row.loanDate,
      formatSettlementAmountDisplay(row.originalAmount),
      formatSettlementAmountDisplay(row.yearEndBalance),
      row.repaymentDueDate || UNSET,
      row.interestRate || UNSET,
      row.hasCollateral || UNSET,
      row.notes || '―',
    ],
  }))

  const officerLoanRows: ETaxBreakdownDetailRow[] = (auxiliary?.officerLoans ?? []).map((row) => ({
    mappingId: `etax.breakdown.officerLoan.${row.id}`,
    values: [
      row.officerName,
      row.occurrenceDate,
      row.description,
      formatSettlementAmountDisplay(row.yearEndBalance),
      row.notes || '―',
    ],
  }))

  const fixedAssetRows: ETaxBreakdownDetailRow[] = buildETaxFixedAssetRows(fixedAssets, asOfYearMonth).map(
    (row) => ({
      mappingId: row.mappingId,
      values: [
        row.assetName,
        row.assetCategory,
        row.purchaseDate,
        String(row.acquisitionCost),
        String(row.cumulativeDepreciationYen),
        String(row.remainingBookValue),
      ],
    }),
  )

  const resolveDetailEmptyStatus = (
    rows: ETaxBreakdownDetailRow[],
    amount: number | null | undefined,
  ): 'unset' | 'na' =>
    rows.length > 0
      ? 'unset'
      : hasPositiveSettlementAmount(amount)
        ? 'unset'
        : resolveBreakdownEmptyStatus(amount)

  const resolveReceivableDetailEmptyStatus = (rows: ETaxBreakdownDetailRow[]): 'unset' | 'na' => {
    if (rows.length > 0) {
      return 'unset'
    }
    if (
      hasPositiveSettlementAmount(balance?.accountsReceivable) ||
      hasPositiveSettlementAmount(balance?.accruedIncome)
    ) {
      return 'unset'
    }
    return resolveReceivableBreakdownEmptyStatus(balance?.accountsReceivable, balance?.accruedIncome)
  }

  return [
    buildBreakdownSection(
      'bank',
      '預貯金等の内訳',
      'etax.breakdown.bank',
      ['金融機関名', '支店名', '口座種別', '口座番号下4桁', '期末残高', '備考'],
      bankRows,
      resolveDetailEmptyStatus(bankRows, balance?.deposits),
    ),
    buildBreakdownSection(
      'receivable',
      '売掛金・未収金の内訳',
      'etax.breakdown.receivable',
      ['区分', '相手先名', '登録番号/法人番号', '内容', '発生日', '期末残高', '備考'],
      receivableRows,
      resolveReceivableDetailEmptyStatus(receivableRows),
    ),
    buildBreakdownSection(
      'prepayment',
      '仮払金の内訳',
      'etax.breakdown.prepayments',
      ['項目', '登録番号/法人番号', '内容', '発生日', '期末残高', '備考'],
      prepaymentRows,
      resolveDetailEmptyStatus(prepaymentRows, balance?.prepayments),
    ),
    buildBreakdownSection(
      'payable',
      '未払金の内訳',
      'etax.breakdown.payable',
      ['相手先名', '登録番号/法人番号', '内容', '発生日', '期末残高', '備考'],
      payableRows,
      resolveDetailEmptyStatus(payableRows, balance?.accountsPayable),
    ),
    buildBreakdownSection(
      'loan',
      '借入金の内訳',
      'etax.breakdown.loan',
      ['借入先', '借入日', '当初借入額', '期末残高', '返済期限', '利率', '担保有無', '備考'],
      loanRows,
      resolveDetailEmptyStatus(loanRows, balance?.borrowings),
    ),
    buildBreakdownSection(
      'officer-loan',
      '役員借入金の内訳',
      'etax.breakdown.officerLoan',
      ['役員名', '発生日', '内容', '期末残高', '備考'],
      officerLoanRows,
      resolveDetailEmptyStatus(officerLoanRows, balance?.officerLoans),
    ),
    buildBreakdownSection(
      'fixed-asset',
      '固定資産の内訳',
      'etax.breakdown.fixedAsset',
      ['資産名', '区分', '取得日', '取得価額', '累計償却', '帳簿価額'],
      fixedAssetRows,
      fixedAssetRows.length > 0 ? 'unset' : 'na',
    ),
  ]
}

const aggregateFiscalExpenseTax = (expenses: StoredAccountingExpense[], targetYear: number) => {
  const totals = {
    expense10: 0,
    expense8: 0,
    expenseOutOfScope: 0,
    expenseNonTaxable: 0,
    invoiceExpenseCount: 0,
  }

  expenses.forEach((expense) => {
    if (!isExpenseEligibleForReporting(expense) || !isExpenseInFiscalYear(expense, targetYear)) {
      return
    }

    if (expense.invoiceNumber?.trim()) {
      totals.invoiceExpenseCount += 1
    }

    const amount = expense.taxIncludedAmount

    if (expense.taxCategory === 'non_taxable') {
      totals.expenseNonTaxable += amount
      return
    }
    if (expense.taxCategory === 'out_of_scope') {
      totals.expenseOutOfScope += amount
      return
    }

    const rate = expense.taxRate ?? 10
    if (rate === 8) {
      totals.expense8 += amount
    } else {
      totals.expense10 += amount
    }
  })

  return totals
}

export const buildETaxConsumptionTaxSummary = (
  pl: MonthlyProfitLoss,
  expenses: StoredAccountingExpense[],
  targetYear: number,
): ETaxReportLine[] => {
  const expenseTax = aggregateFiscalExpenseTax(expenses, targetYear)

  return [
    line('etax.tax.taxableSales', '課税売上', pl.salesTotalYen),
    plannedLine('etax.tax.nonTaxableSales', '非課税売上'),
    plannedLine('etax.tax.outOfScopeSales', '対象外売上'),
    line(
      'etax.tax.expense10',
      '10%対象経費',
      expenseTax.expense10 || null,
      expenseTax.expense10 > 0 ? 'set' : 'unset',
    ),
    line('etax.tax.expense8', '8%対象経費', expenseTax.expense8 || null, expenseTax.expense8 > 0 ? 'set' : 'unset'),
    line(
      'etax.tax.expenseOutOfScope',
      '対象外経費',
      expenseTax.expenseOutOfScope || null,
      expenseTax.expenseOutOfScope > 0 ? 'set' : 'unset',
    ),
    line(
      'etax.tax.expenseNonTaxable',
      '非課税経費',
      expenseTax.expenseNonTaxable || null,
      expenseTax.expenseNonTaxable > 0 ? 'set' : 'unset',
    ),
    plannedLine('etax.tax.prepaidTax', '仮払消費税'),
    plannedLine('etax.tax.collectedTax', '仮受消費税'),
    plannedLine('etax.tax.difference', '差額'),
    line(
      'etax.tax.invoiceExpenseCount',
      'インボイス番号付き経費件数',
      expenseTax.invoiceExpenseCount,
      expenseTax.invoiceExpenseCount > 0 ? 'set' : 'unset',
    ),
  ]
}

const topExpenseCategories = (pl: MonthlyProfitLoss, limit = 5) => {
  const totals = new Map<string, number>()

  ;[...FIXED_EXPENSE_CATEGORIES, ...VARIABLE_EXPENSE_CATEGORIES].forEach((category) => {
    const amount = (pl.fixedCosts[category] ?? 0) + (pl.variableExpenses[category] ?? 0)
    if (amount > 0) {
      totals.set(category, amount)
    }
  })

  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([category, amount]) => `${category}: ${amount}`)
}

export const buildETaxBusinessOverview = (
  company: ETaxCompanyProfile,
  pl: MonthlyProfitLoss,
  expenses: StoredAccountingExpense[],
  auxiliary: AccountingSettlementAuxiliaryInput | null,
  monthlyRows: MonthlyProfitLoss[],
): ETaxReportLine[] => {
  const basic = auxiliary?.companyBasic
  const vendors = [
    ...new Set(
      expenses
        .filter((expense) => isExpenseEligibleForReporting(expense) && expense.vendorName)
        .map((expense) => expense.vendorName.trim())
        .filter(Boolean),
    ),
  ].slice(0, 5)

  const financialInstitutions = [
    ...new Set((auxiliary?.bankAccounts ?? []).map((row) => row.institutionName.trim()).filter(Boolean)),
  ]

  const monthlySales = monthlyRows
    .map((row) => `${row.targetYearMonth}=${row.salesTotalYen}`)
    .join(' / ')
  const monthlyExpenses = monthlyRows
    .map((row) => `${row.targetYearMonth}=${row.expensesTotalYen}`)
    .join(' / ')
  const topCategories = topExpenseCategories(pl)

  return [
    textLine(
      'etax.overview.companyName',
      '会社名',
      basic?.companyName || (company.companyName !== UNSET ? company.companyName : ''),
    ),
    textLine(
      'etax.overview.address',
      '所在地',
      basic?.address || (company.address !== UNSET ? company.address : ''),
    ),
    textLine(
      'etax.overview.representative',
      '代表者',
      basic?.representativeName || (company.representativeName !== UNSET ? company.representativeName : ''),
    ),
    textLine('etax.overview.businessDescription', '事業内容', basic?.businessDescription),
    textLine(
      'etax.overview.employeeCount',
      '従業員数',
      hasSettlementCount(basic?.employeeCount) ? String(basic?.employeeCount) : null,
      hasSettlementCount(basic?.employeeCount) ? 'set' : 'unset',
    ),
    textLine(
      'etax.overview.officerCount',
      '役員数',
      hasSettlementCount(basic?.officerCount) ? String(basic?.officerCount) : null,
      hasSettlementCount(basic?.officerCount) ? 'set' : 'unset',
    ),
    line('etax.overview.sales', '売上高', pl.salesTotalYen),
    line('etax.overview.operatingProfit', '営業利益', pl.operatingProfitYen),
    {
      mappingId: 'etax.overview.monthlySales',
      label: '月別売上',
      displayValue: monthlySales || UNSET,
      status: monthlySales ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.overview.monthlyExpenses',
      label: '月別経費',
      displayValue: monthlyExpenses || UNSET,
      status: monthlyExpenses ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.overview.topExpenseCategories',
      label: '主要な経費科目',
      displayValue: topCategories.length > 0 ? topCategories.join(' / ') : UNSET,
      status: topCategories.length > 0 ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.overview.vendors',
      label: '主要仕入先',
      displayValue: vendors.length > 0 ? vendors.join(' / ') : UNSET,
      status: vendors.length > 0 ? 'set' : 'unset',
    },
    plannedLine('etax.overview.customers', '主要取引先'),
    {
      mappingId: 'etax.overview.financialInstitutions',
      label: '金融機関',
      displayValue: financialInstitutions.length > 0 ? financialInstitutions.join(' / ') : UNSET,
      status: financialInstitutions.length > 0 ? 'set' : 'unset',
    },
  ]
}

export const buildETaxAuxiliaryDataLines = (
  auxiliary: AccountingSettlementAuxiliaryInput | null,
): ETaxReportLine[] => {
  if (!auxiliary) {
    return [unsetLine('etax.auxiliary.none', '決算補助データ')]
  }

  const basic = auxiliary.companyBasic
  const balance = auxiliary.yearEndBalance

  return [
    textLine('etax.aux.companyName', '会社名', basic.companyName),
    textLine('etax.aux.corporateNumber', '法人番号', basic.corporateNumber),
    textLine('etax.aux.address', '所在地', basic.address),
    textLine('etax.aux.representative', '代表者名', basic.representativeName),
    textLine('etax.aux.businessDescription', '事業内容', basic.businessDescription),
    textLine(
      'etax.aux.officerCount',
      '役員数',
      hasSettlementCount(basic.officerCount) ? String(basic.officerCount) : null,
      hasSettlementCount(basic.officerCount) ? 'set' : 'unset',
    ),
    textLine(
      'etax.aux.employeeCount',
      '従業員数',
      hasSettlementCount(basic.employeeCount) ? String(basic.employeeCount) : null,
      hasSettlementCount(basic.employeeCount) ? 'set' : 'unset',
    ),
    textLine(
      'etax.aux.fiscalMonthEnd',
      '決算月',
      hasSettlementCount(basic.fiscalMonthEnd) ? `${basic.fiscalMonthEnd}月` : null,
      hasSettlementCount(basic.fiscalMonthEnd) ? 'set' : 'unset',
    ),
    textLine('etax.aux.fiscalYearStartDate', '会計年度開始日', basic.fiscalYearStartDate),
    textLine('etax.aux.fiscalYearEndDate', '会計年度終了日', basic.fiscalYearEndDate),
    balanceLine('etax.aux.balance.cash', '現金', balance.cash),
    balanceLine('etax.aux.balance.deposits', '普通預金', balance.deposits),
    balanceLine('etax.aux.balance.accountsReceivable', '売掛金', balance.accountsReceivable),
    balanceLine('etax.aux.balance.accruedIncome', '未収金', balance.accruedIncome),
    balanceLine('etax.aux.balance.prepayments', '仮払金', balance.prepayments),
    balanceLine('etax.aux.balance.accountsPayable', '未払金', balance.accountsPayable),
    balanceLine('etax.aux.balance.borrowings', '借入金', balance.borrowings),
    balanceLine('etax.aux.balance.officerLoans', '役員借入金', balance.officerLoans),
    balanceLine('etax.aux.balance.capital', '資本金', balance.capital),
    balanceLine('etax.aux.balance.retainedEarnings', '利益剰余金', balance.retainedEarnings),
    {
      mappingId: 'etax.aux.bankAccountCount',
      label: '預金内訳件数',
      displayValue: String(auxiliary.bankAccounts.length),
      status: auxiliary.bankAccounts.length > 0 ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.aux.loanCount',
      label: '借入金内訳件数',
      displayValue: String(auxiliary.loans.length),
      status: auxiliary.loans.length > 0 ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.aux.officerLoanCount',
      label: '役員借入金内訳件数',
      displayValue: String(auxiliary.officerLoans.length),
      status: auxiliary.officerLoans.length > 0 ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.aux.receivableCount',
      label: '売掛金・未収金内訳件数',
      displayValue: String(auxiliary.receivables.length),
      status: auxiliary.receivables.length > 0 ? 'set' : 'unset',
    },
    {
      mappingId: 'etax.aux.payableCount',
      label: '未払金内訳件数',
      displayValue: String(auxiliary.payables.length),
      status: auxiliary.payables.length > 0 ? 'set' : 'unset',
    },
  ]
}

const pushBalanceCheck = (
  items: ETaxCheckItem[],
  mappingId: string,
  label: string,
  category: string,
  amount: number | null | undefined,
) => {
  const amountStatus = getSettlementAmountStatus(amount)
  if (amountStatus === 'unset') {
    items.push({ mappingId, label, status: 'required', category })
    return
  }
  if (amountStatus === 'na') {
    items.push({ mappingId, label, status: 'na', category })
  }
}

const pushTextCheck = (
  items: ETaxCheckItem[],
  mappingId: string,
  label: string,
  category: string,
  isComplete: boolean,
) => {
  if (!isComplete) {
    items.push({ mappingId, label, status: 'required', category })
  }
}

const pushCountCheck = (
  items: ETaxCheckItem[],
  mappingId: string,
  label: string,
  category: string,
  isComplete: boolean,
) => {
  if (!isComplete) {
    items.push({ mappingId, label, status: 'required', category })
  }
}

const pushBalanceBreakdownMatchCheck = (
  items: ETaxCheckItem[],
  mappingId: string,
  label: string,
  balance: number | null | undefined,
  breakdownSum: number,
  breakdownCount: number,
) => {
  if (!hasPositiveSettlementAmount(balance)) {
    return
  }
  if (breakdownCount === 0) {
    items.push({
      mappingId: `${mappingId}.missingBreakdown`,
      label: `${label}内訳`,
      status: 'required',
      category: '内訳明細',
    })
    return
  }
  if (balance !== breakdownSum) {
    items.push({
      mappingId: `${mappingId}.mismatch`,
      label: `${label}（残高と内訳の一致）`,
      status: 'review',
      category: '一致確認',
      detail: `残高 ${balance} / 内訳合計 ${breakdownSum}`,
    })
  }
}

export const buildETaxCheckItems = (
  auxiliary: AccountingSettlementAuxiliaryInput | null,
): ETaxCheckItem[] => {
  const items: ETaxCheckItem[] = []
  const basic = auxiliary?.companyBasic
  const balance = auxiliary?.yearEndBalance

  pushTextCheck(items, 'etax.check.businessDescription', '事業内容', '会社基本情報', hasSettlementText(basic?.businessDescription))
  pushCountCheck(items, 'etax.check.officerCount', '役員数', '会社基本情報', hasSettlementCount(basic?.officerCount))
  pushCountCheck(items, 'etax.check.employeeCount', '従業員数', '会社基本情報', hasSettlementCount(basic?.employeeCount))

  pushBalanceCheck(items, 'etax.check.cash', '現金残高', '期末残高', balance?.cash)
  pushBalanceCheck(items, 'etax.check.deposits', '普通預金残高', '期末残高', balance?.deposits)
  pushBalanceCheck(items, 'etax.check.accountsReceivable', '売掛金残高', '期末残高', balance?.accountsReceivable)
  pushBalanceCheck(items, 'etax.check.accruedIncome', '未収金残高', '期末残高', balance?.accruedIncome)
  pushBalanceCheck(items, 'etax.check.prepayments', '仮払金残高', '期末残高', balance?.prepayments)
  pushBalanceCheck(items, 'etax.check.accountsPayable', '未払金残高', '期末残高', balance?.accountsPayable)
  pushBalanceCheck(items, 'etax.check.borrowings', '借入金残高', '期末残高', balance?.borrowings)
  pushBalanceCheck(items, 'etax.check.officerLoans', '役員借入金残高', '期末残高', balance?.officerLoans)
  pushBalanceCheck(items, 'etax.check.capital', '資本金', '期末残高', balance?.capital)
  pushBalanceCheck(items, 'etax.check.retainedEarnings', '利益剰余金', '期末残高', balance?.retainedEarnings)

  pushBalanceBreakdownMatchCheck(
    items,
    'etax.check.deposits',
    '普通預金',
    balance?.deposits,
    sumSettlementBreakdownBalances(auxiliary?.bankAccounts ?? []),
    auxiliary?.bankAccounts.length ?? 0,
  )
  pushBalanceBreakdownMatchCheck(
    items,
    'etax.check.borrowings',
    '借入金',
    balance?.borrowings,
    sumSettlementBreakdownBalances(auxiliary?.loans ?? []),
    auxiliary?.loans.length ?? 0,
  )
  pushBalanceBreakdownMatchCheck(
    items,
    'etax.check.accountsReceivable',
    '売掛金',
    balance?.accountsReceivable,
    sumReceivableBreakdownByKind(auxiliary?.receivables ?? [], 'accountsReceivable'),
    (auxiliary?.receivables ?? []).filter(
      (row) => (row.receivableKind ?? 'accountsReceivable') === 'accountsReceivable',
    ).length,
  )
  pushBalanceBreakdownMatchCheck(
    items,
    'etax.check.accruedIncome',
    '未収金',
    balance?.accruedIncome,
    sumReceivableBreakdownByKind(auxiliary?.receivables ?? [], 'accruedIncome'),
    (auxiliary?.receivables ?? []).filter((row) => row.receivableKind === 'accruedIncome').length,
  )
  pushBalanceBreakdownMatchCheck(
    items,
    'etax.check.accountsPayable',
    '未払金',
    balance?.accountsPayable,
    sumSettlementBreakdownBalances(auxiliary?.payables ?? []),
    auxiliary?.payables.length ?? 0,
  )
  pushBalanceBreakdownMatchCheck(
    items,
    'etax.check.officerLoans',
    '役員借入金',
    balance?.officerLoans,
    sumSettlementBreakdownBalances(auxiliary?.officerLoans ?? []),
    auxiliary?.officerLoans.length ?? 0,
  )

  items.push({
    mappingId: 'etax.check.consumptionTax',
    label: '仮払消費税・仮受消費税・差額',
    status: 'planned',
    category: '消費税',
  })

  return items
}

/** @deprecated use buildETaxCheckItems */
export const buildETaxMissingItems = buildETaxCheckItems

export const buildETaxInputStatus = (checkItems: ETaxCheckItem[]): ETaxInputStatusSummary => {
  const actionRequiredItems = checkItems.filter(
    (item) => item.status === 'required' || item.status === 'review',
  )

  return {
    requiredCount: checkItems.filter((item) => item.status === 'required').length,
    naCount: checkItems.filter((item) => item.status === 'na').length,
    reviewCount: checkItems.filter((item) => item.status === 'review').length,
    plannedCount: checkItems.filter((item) => item.status === 'planned').length,
    totalCount: checkItems.length,
    checkItems,
    actionRequiredItems,
  }
}

export const buildETaxPackage = ({
  targetYear,
  targetYearMonth,
  company,
  meterSettings,
  caseRecords,
  expenses,
  adjustments,
  fixedCosts,
  fixedAssets,
  auxiliary,
}: {
  targetYear: number
  targetYearMonth: string
  company: Company | null
  meterSettings: MeterSettings | null
  caseRecords: StoredCaseRecord[]
  expenses: StoredAccountingExpense[]
  adjustments: StoredAccountingAdjustment[]
  fixedCosts: StoredAccountingFixedCost[]
  fixedAssets: StoredAccountingFixedAsset[]
  auxiliary: AccountingSettlementAuxiliaryInput | null
}): ETaxPackage => {
  const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, targetYear)
  const asOfYearMonth = period?.endYearMonth ?? targetYearMonth
  const companyProfile = buildETaxCompanyProfile({ targetYear, company, meterSettings })
  const pl = calculateFiscalYearProfitLoss({
    caseRecords,
    expenses,
    adjustments,
    fixedCosts,
    fixedAssets,
    targetYear,
  })
  const monthlyRows = calculateFiscalYearMonthlyProfitLoss({
    caseRecords,
    expenses,
    adjustments,
    fixedCosts,
    fixedAssets,
    targetYear,
  })
  const smallAssets = fixedAssets.filter((asset) => asset.assetKind === 'small' && !asset.isDeleted)
  const checkItems = buildETaxCheckItems(auxiliary)
  const inputStatus = buildETaxInputStatus(checkItems)

  return {
    company: companyProfile,
    summary: buildETaxSettlementSummary(
      pl,
      companyProfile.fiscalYearLabel,
      fixedAssets,
      smallAssets,
      targetYear,
      auxiliary,
    ),
    pl,
    balanceSheet: buildETaxBalanceSheet(fixedAssets, asOfYearMonth, auxiliary),
    bsInput: buildETaxBsInput(fixedAssets, asOfYearMonth, auxiliary),
    fixedAssets: buildETaxFixedAssetRows(fixedAssets, asOfYearMonth),
    smallAssets: buildETaxSmallAssetRows(fixedAssets),
    accountBreakdown: buildETaxAccountBreakdown(auxiliary, fixedAssets, asOfYearMonth),
    accountBreakdownDetail: buildETaxAccountBreakdownDetail(auxiliary, fixedAssets, asOfYearMonth),
    businessOverview: buildETaxBusinessOverview(companyProfile, pl, expenses, auxiliary, monthlyRows),
    consumptionTax: buildETaxConsumptionTaxSummary(pl, expenses, targetYear),
    auxiliaryDataLines: buildETaxAuxiliaryDataLines(auxiliary),
    inputStatus,
    checkItems,
    actionRequiredItems: inputStatus.actionRequiredItems,
    missingItems: inputStatus.actionRequiredItems,
  }
}
