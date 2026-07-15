import type { AccountingExportFiscalPeriodSnapshot } from '../types/accountingExportHistory'
import type { FiscalPeriod } from '../types/accountingFiscalPeriod'

const URL_LIKE_KEY = /url|Url|URL|downloadUrl|storagePath|imageUrl/i

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasId = (value: unknown): value is { id: string } =>
  isPlainObject(value) && typeof value.id === 'string'

/**
 * Normalize Firestore Timestamp-like values to ISO strings so the same instant
 * fingerprints identically whether stored as Timestamp, {seconds}, or ISO string.
 */
const normalizeTimestampLike = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown> & {
    toDate?: () => Date
    seconds?: number
    nanoseconds?: number
    nanos?: number
  }

  if (typeof record.toDate === 'function') {
    try {
      return record.toDate().toISOString()
    } catch {
      // fall through to seconds / plain-object handling
    }
  }

  if (typeof record.seconds === 'number' && Number.isFinite(record.seconds)) {
    const nanos =
      typeof record.nanoseconds === 'number'
        ? record.nanoseconds
        : typeof record.nanos === 'number'
          ? record.nanos
          : 0
    return new Date(record.seconds * 1000 + Math.floor(nanos / 1e6)).toISOString()
  }

  return value
}

/** Sort object keys, sort arrays of {id} by id, drop undefined and URL-like keys. */
export const canonicalizeForFingerprint = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => canonicalizeForFingerprint(item))
      .filter((item) => item !== undefined)
    if (items.every(hasId)) {
      return [...items].sort((a, b) => a.id.localeCompare(b.id, 'en'))
    }
    return items
  }

  const normalized = normalizeTimestampLike(value)
  if (normalized !== value) {
    return canonicalizeForFingerprint(normalized)
  }

  const sortedKeys = Object.keys(value as Record<string, unknown>).sort((a, b) =>
    a.localeCompare(b, 'en'),
  )
  const result: Record<string, unknown> = {}
  for (const key of sortedKeys) {
    if (URL_LIKE_KEY.test(key)) {
      continue
    }
    const nested = canonicalizeForFingerprint((value as Record<string, unknown>)[key])
    if (nested !== undefined) {
      result[key] = nested
    }
  }
  return result
}

export const sha256Hex = async (text: string): Promise<string> => {
  const encoded = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const buildAccountingExportSourceFingerprint = async (payload: unknown): Promise<string> => {
  const canonical = canonicalizeForFingerprint(payload)
  return sha256Hex(JSON.stringify(canonical))
}

export const toFiscalPeriodSnapshot = (
  period: FiscalPeriod,
): AccountingExportFiscalPeriodSnapshot => ({
  fiscalYear: period.fiscalYear,
  startDate: period.startDate,
  endDate: period.endDate,
  startYearMonth: period.startYearMonth,
  endYearMonth: period.endYearMonth,
  isShortFiscalYear: period.isShortFiscalYear,
  monthCount: period.monthCount,
  label: period.label,
})

type FingerprintExpense = {
  id: string
  updatedAt?: string
  taxIncludedAmount?: number
  taxRate?: number | null
  taxCategory?: string
  confirmationStatus?: string
  expenseCategory?: string
  postingDate?: string
  transactionDate?: string
}

type FingerprintReceipt = {
  id: string
  updatedAt?: string
  status?: string
  linkedExpenseId?: string
  downloadUrl?: string
  storagePath?: string
  imageUrl?: string
  url?: string
}

type FingerprintAsset = {
  id: string
  updatedAt?: string
  acquisitionCost?: number
  remainingBookValue?: number
  status?: string
  monthlyDepreciationYen?: number
  depreciationStartYearMonth?: string
  depreciationEndYearMonth?: string
}

type FingerprintFixedCost = {
  id: string
  updatedAt?: string
  monthlyAmountYen?: number
  annualAmountYen?: number
  status?: string
  confirmationStatus?: string
  expenseCategory?: string
  startYearMonth?: string
  cancelYearMonth?: string
}

type FingerprintAdjustment = {
  id: string
  updatedAt?: string
  amountYen?: number
  confirmationStatus?: string
  targetYearMonth?: string
}

/** Case / sales fields that affect management PL (see accountingSalesMapping / accountingPl). */
export type FingerprintCaseRecord = {
  id: string
  updatedAt?: unknown
  createdAt?: unknown
  closedAt?: string
  /** Primary PL total — prefer actualFareYen / totalFareYen from StoredCaseRecord */
  totalFareYen?: number
  totalFare?: number
  fareYen?: number
  actualFareYen?: number
  /** Category amounts used by aggregateSalesBreakdown / PL */
  salesCategoryAmounts?: Record<string, number>
}

export type FingerprintCompany = {
  corporateName?: string
  name?: string
  corporateNumber?: string
  invoiceNumber?: string
  address?: string
  representativeName?: string
}

type FingerprintAuxiliary = {
  yearEndBalance?: Record<string, unknown>
  bankAccounts?: Array<{ id: string; yearEndBalance?: number | null }>
  loans?: Array<{ id: string; yearEndBalance?: number | null; originalAmount?: number | null }>
  officerLoans?: Array<{ id: string; yearEndBalance?: number | null }>
  receivables?: Array<{ id: string; yearEndBalance?: number | null; receivableKind?: string }>
  payables?: Array<{ id: string; yearEndBalance?: number | null }>
} | null

export type ETaxExportFingerprintInputParams = {
  fiscalPeriod: AccountingExportFiscalPeriodSnapshot | FiscalPeriod | null | undefined
  exportType: string
  exportSchemaVersion: string
  expenses?: FingerprintExpense[]
  receipts?: FingerprintReceipt[]
  fixedAssets?: FingerprintAsset[]
  adjustments?: FingerprintAdjustment[]
  fixedCosts?: FingerprintFixedCost[]
  settlementAuxiliary?: FingerprintAuxiliary
  /** Prefer full caseRecords (amounts) over count/ids alone */
  caseRecords?: FingerprintCaseRecord[]
  /** @deprecated Prefer caseRecords — kept for count/id-only callers */
  caseRecordIdsOrCount?: string[] | number
  /** e-Tax header company fields (no secrets) */
  company?: FingerprintCompany | null
}

const mapExpense = (expense: FingerprintExpense) => ({
  id: expense.id,
  updatedAt: expense.updatedAt,
  taxIncludedAmount: expense.taxIncludedAmount,
  taxRate: expense.taxRate ?? null,
  taxCategory: expense.taxCategory,
  confirmationStatus: expense.confirmationStatus,
  expenseCategory: expense.expenseCategory,
  postingDate: expense.postingDate || expense.transactionDate,
})

const mapReceipt = (receipt: FingerprintReceipt) => ({
  id: receipt.id,
  updatedAt: receipt.updatedAt,
  status: receipt.status,
  linkedExpenseId: receipt.linkedExpenseId,
})

const mapAsset = (asset: FingerprintAsset) => ({
  id: asset.id,
  updatedAt: asset.updatedAt,
  acquisitionCost: asset.acquisitionCost,
  remainingBookValue: asset.remainingBookValue,
  status: asset.status,
  monthlyDepreciationYen: asset.monthlyDepreciationYen,
  depreciationStartYearMonth: asset.depreciationStartYearMonth,
  depreciationEndYearMonth: asset.depreciationEndYearMonth,
})

const mapFixedCost = (cost: FingerprintFixedCost) => ({
  id: cost.id,
  updatedAt: cost.updatedAt,
  monthlyAmountYen: cost.monthlyAmountYen,
  annualAmountYen: cost.annualAmountYen,
  status: cost.status,
  confirmationStatus: cost.confirmationStatus,
  expenseCategory: cost.expenseCategory,
  startYearMonth: cost.startYearMonth,
  cancelYearMonth: cost.cancelYearMonth,
})

const mapAdjustment = (adjustment: FingerprintAdjustment) => ({
  id: adjustment.id,
  updatedAt: adjustment.updatedAt,
  amountYen: adjustment.amountYen,
  confirmationStatus: adjustment.confirmationStatus,
  targetYearMonth: adjustment.targetYearMonth,
})

const mapCaseRecord = (record: FingerprintCaseRecord) => {
  const totalFareYen =
    record.totalFareYen ?? record.actualFareYen ?? record.totalFare ?? record.fareYen
  return {
    id: record.id,
    updatedAt: record.updatedAt ?? record.createdAt ?? record.closedAt,
    totalFareYen,
    actualFareYen: record.actualFareYen,
    salesCategoryAmounts: record.salesCategoryAmounts,
  }
}

const mapCompany = (company: FingerprintCompany | null | undefined) => {
  if (!company) {
    return null
  }
  return {
    corporateName: company.corporateName ?? company.name,
    name: company.name,
    corporateNumber: company.corporateNumber ?? company.invoiceNumber,
    invoiceNumber: company.invoiceNumber ?? company.corporateNumber,
    address: company.address,
    representativeName: company.representativeName,
  }
}

const mapAuxiliaryBalances = (auxiliary: FingerprintAuxiliary) => {
  if (!auxiliary) {
    return null
  }
  const yearEnd = auxiliary.yearEndBalance ?? {}
  const {
    cash,
    deposits,
    accountsReceivable,
    accruedIncome,
    prepayments,
    accountsPayable,
    borrowings,
    officerLoans,
    capital,
    retainedEarnings,
  } = yearEnd as Record<string, unknown>

  return {
    yearEndBalance: {
      cash: cash ?? null,
      deposits: deposits ?? null,
      accountsReceivable: accountsReceivable ?? null,
      accruedIncome: accruedIncome ?? null,
      prepayments: prepayments ?? null,
      accountsPayable: accountsPayable ?? null,
      borrowings: borrowings ?? null,
      officerLoans: officerLoans ?? null,
      capital: capital ?? null,
      retainedEarnings: retainedEarnings ?? null,
    },
    bankAccounts: (auxiliary.bankAccounts ?? []).map((row) => ({
      id: row.id,
      yearEndBalance: row.yearEndBalance ?? null,
    })),
    loans: (auxiliary.loans ?? []).map((row) => ({
      id: row.id,
      yearEndBalance: row.yearEndBalance ?? null,
      originalAmount: row.originalAmount ?? null,
    })),
    officerLoans: (auxiliary.officerLoans ?? []).map((row) => ({
      id: row.id,
      yearEndBalance: row.yearEndBalance ?? null,
    })),
    receivables: (auxiliary.receivables ?? []).map((row) => ({
      id: row.id,
      yearEndBalance: row.yearEndBalance ?? null,
      receivableKind: row.receivableKind,
    })),
    payables: (auxiliary.payables ?? []).map((row) => ({
      id: row.id,
      yearEndBalance: row.yearEndBalance ?? null,
    })),
  }
}

/** Build fingerprint payload for settlement packages (no secrets / URLs / Date.now()). */
export const buildETaxExportFingerprintInput = (
  params: ETaxExportFingerprintInputParams,
): Record<string, unknown> => {
  const period = params.fiscalPeriod
  const mappedCaseRecords = (params.caseRecords ?? []).map(mapCaseRecord)
  const caseField =
    mappedCaseRecords.length > 0
      ? { caseRecords: mappedCaseRecords }
      : typeof params.caseRecordIdsOrCount === 'number'
        ? { caseRecordCount: params.caseRecordIdsOrCount }
        : Array.isArray(params.caseRecordIdsOrCount)
          ? { caseRecordIds: [...params.caseRecordIdsOrCount].sort((a, b) => a.localeCompare(b, 'en')) }
          : {}

  return {
    exportType: params.exportType,
    exportSchemaVersion: params.exportSchemaVersion,
    fiscalPeriod: period
      ? {
          fiscalYear: period.fiscalYear,
          startDate: period.startDate,
          endDate: period.endDate,
          startYearMonth: period.startYearMonth,
          endYearMonth: period.endYearMonth,
          isShortFiscalYear: period.isShortFiscalYear,
          monthCount: 'monthCount' in period ? period.monthCount : undefined,
        }
      : null,
    company: mapCompany(params.company),
    expenses: (params.expenses ?? []).map(mapExpense),
    receipts: (params.receipts ?? []).map(mapReceipt),
    fixedAssets: (params.fixedAssets ?? []).map(mapAsset),
    adjustments: (params.adjustments ?? []).map(mapAdjustment),
    fixedCosts: (params.fixedCosts ?? []).map(mapFixedCost),
    settlementAuxiliary: mapAuxiliaryBalances(params.settlementAuxiliary ?? null),
    ...caseField,
    counts: {
      expenses: (params.expenses ?? []).length,
      receipts: (params.receipts ?? []).length,
      fixedAssets: (params.fixedAssets ?? []).length,
      adjustments: (params.adjustments ?? []).length,
      fixedCosts: (params.fixedCosts ?? []).length,
      sales: mappedCaseRecords.length > 0 ? mappedCaseRecords.length : undefined,
    },
  }
}
