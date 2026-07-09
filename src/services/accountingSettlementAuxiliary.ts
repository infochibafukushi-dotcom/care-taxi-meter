import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'
import { getFirebaseApp } from '../lib/firebase'
import type {
  AccountingSettlementAuxiliaryInput,
  SettlementBankAccountRow,
  SettlementCompanyBasicInfo,
  SettlementCustomAccount,
  SettlementLoanRow,
  SettlementOfficerLoanRow,
  SettlementPayableRow,
  SettlementReceivableRow,
  SettlementYearEndBalance,
  StoredAccountingSettlementAuxiliary,
} from '../types/accountingSettlementAuxiliary'
import { removeUndefinedFields } from '../utils/removeUndefinedFields'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import { resolveAccountingTenantFields } from './accountingTenant'
import type { TenantAccessScope } from './tenancy'
import { matchesTenantScope } from './tenancy'

const collectionName = 'accountingSettlementAuxiliary'

const toNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toIsoString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return undefined
}

const toStringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const normalizeCustomAccount = (row: Record<string, unknown>): SettlementCustomAccount => ({
  id: toStringValue(row.id, `custom-${Date.now()}`),
  accountName: toStringValue(row.accountName),
  amountYen: toNumberOrNull(row.amountYen),
  mappingId: typeof row.mappingId === 'string' ? row.mappingId : undefined,
})

const normalizeBankAccount = (row: Record<string, unknown>): SettlementBankAccountRow => ({
  id: toStringValue(row.id, `bank-${Date.now()}`),
  institutionName: toStringValue(row.institutionName),
  branchName: toStringValue(row.branchName),
  accountType: toStringValue(row.accountType, '普通'),
  accountLastFour: toStringValue(row.accountLastFour),
  yearEndBalance: toNumberOrNull(row.yearEndBalance),
  notes: toStringValue(row.notes),
})

const normalizeLoan = (row: Record<string, unknown>): SettlementLoanRow => ({
  id: toStringValue(row.id, `loan-${Date.now()}`),
  lenderName: toStringValue(row.lenderName),
  loanDate: toStringValue(row.loanDate),
  originalAmount: toNumberOrNull(row.originalAmount),
  yearEndBalance: toNumberOrNull(row.yearEndBalance),
  repaymentDueDate: toStringValue(row.repaymentDueDate),
  interestRate: toStringValue(row.interestRate),
  hasCollateral: toStringValue(row.hasCollateral, '無'),
  notes: toStringValue(row.notes),
})

const normalizeOfficerLoan = (row: Record<string, unknown>): SettlementOfficerLoanRow => ({
  id: toStringValue(row.id, `officer-loan-${Date.now()}`),
  officerName: toStringValue(row.officerName),
  occurrenceDate: toStringValue(row.occurrenceDate),
  description: toStringValue(row.description),
  yearEndBalance: toNumberOrNull(row.yearEndBalance),
  notes: toStringValue(row.notes),
})

const normalizeReceivable = (row: Record<string, unknown>): SettlementReceivableRow => ({
  id: toStringValue(row.id, `receivable-${Date.now()}`),
  counterpartyName: toStringValue(row.counterpartyName),
  registrationNumber: toStringValue(row.registrationNumber),
  description: toStringValue(row.description),
  occurrenceDate: toStringValue(row.occurrenceDate),
  yearEndBalance: toNumberOrNull(row.yearEndBalance),
  notes: toStringValue(row.notes),
})

const normalizePayable = (row: Record<string, unknown>): SettlementPayableRow => ({
  id: toStringValue(row.id, `payable-${Date.now()}`),
  counterpartyName: toStringValue(row.counterpartyName),
  registrationNumber: toStringValue(row.registrationNumber),
  description: toStringValue(row.description),
  occurrenceDate: toStringValue(row.occurrenceDate),
  yearEndBalance: toNumberOrNull(row.yearEndBalance),
  notes: toStringValue(row.notes),
})

const normalizeCompanyBasic = (value: Record<string, unknown>): SettlementCompanyBasicInfo => ({
  companyName: toStringValue(value.companyName),
  corporateNumber: toStringValue(value.corporateNumber),
  address: toStringValue(value.address),
  representativeName: toStringValue(value.representativeName),
  businessDescription: toStringValue(value.businessDescription),
  officerCount: toNumberOrNull(value.officerCount),
  employeeCount: toNumberOrNull(value.employeeCount),
  fiscalMonthEnd: toNumberOrNull(value.fiscalMonthEnd) ?? 3,
  fiscalYearStartDate: toStringValue(value.fiscalYearStartDate),
  fiscalYearEndDate: toStringValue(value.fiscalYearEndDate),
})

const normalizeYearEndBalance = (value: Record<string, unknown>): SettlementYearEndBalance => ({
  cash: toNumberOrNull(value.cash),
  deposits: toNumberOrNull(value.deposits),
  accountsReceivable: toNumberOrNull(value.accountsReceivable),
  accruedIncome: toNumberOrNull(value.accruedIncome),
  prepayments: toNumberOrNull(value.prepayments),
  accountsPayable: toNumberOrNull(value.accountsPayable),
  borrowings: toNumberOrNull(value.borrowings),
  officerLoans: toNumberOrNull(value.officerLoans),
  capital: toNumberOrNull(value.capital),
  retainedEarnings: toNumberOrNull(value.retainedEarnings),
  customAccounts: Array.isArray(value.customAccounts)
    ? value.customAccounts.map((row) => normalizeCustomAccount(row as Record<string, unknown>))
    : [],
})

const normalizeStoredSettlementAuxiliary = (
  id: string,
  data: Record<string, unknown>,
): StoredAccountingSettlementAuxiliary => ({
  id,
  franchiseeId: toStringValue(data.franchiseeId ?? data.companyId),
  companyId: toStringValue(data.companyId ?? data.franchiseeId),
  storeId: toStringValue(data.storeId),
  targetYear: Number(data.targetYear ?? 0),
  companyBasic: normalizeCompanyBasic((data.companyBasic as Record<string, unknown>) ?? {}),
  yearEndBalance: normalizeYearEndBalance((data.yearEndBalance as Record<string, unknown>) ?? {}),
  bankAccounts: Array.isArray(data.bankAccounts)
    ? data.bankAccounts.map((row) => normalizeBankAccount(row as Record<string, unknown>))
    : [],
  loans: Array.isArray(data.loans)
    ? data.loans.map((row) => normalizeLoan(row as Record<string, unknown>))
    : [],
  officerLoans: Array.isArray(data.officerLoans)
    ? data.officerLoans.map((row) => normalizeOfficerLoan(row as Record<string, unknown>))
    : [],
  receivables: Array.isArray(data.receivables)
    ? data.receivables.map((row) => normalizeReceivable(row as Record<string, unknown>))
    : [],
  payables: Array.isArray(data.payables)
    ? data.payables.map((row) => normalizePayable(row as Record<string, unknown>))
    : [],
  updatedBy: toStringValue(data.updatedBy),
  updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : undefined,
  createdAt: toIsoString(data.createdAt),
  updatedAt: toIsoString(data.updatedAt),
})

export const buildSettlementAuxiliaryDocId = ({
  franchiseeId,
  storeId,
  targetYear,
}: {
  franchiseeId: string
  storeId: string
  targetYear: number
}) => `${franchiseeId}_${storeId}_${targetYear}`

export async function fetchAccountingSettlementAuxiliary(
  scope: TenantAccessScope | undefined,
  targetYear: number,
): Promise<StoredAccountingSettlementAuxiliary | null> {
  if (isReviewDemoRuntimeEnabled() || !scope?.franchiseeId || !scope.storeId) {
    return null
  }

  const db = getFirestore(getFirebaseApp())
  const docId = buildSettlementAuxiliaryDocId({
    franchiseeId: scope.franchiseeId,
    storeId: scope.storeId,
    targetYear,
  })
  const snapshot = await getDoc(doc(db, collectionName, docId))
  if (!snapshot.exists()) {
    return null
  }

  const stored = normalizeStoredSettlementAuxiliary(snapshot.id, snapshot.data() as Record<string, unknown>)
  return matchesTenantScope(stored, scope) ? stored : null
}

export async function saveAccountingSettlementAuxiliary(
  input: AccountingSettlementAuxiliaryInput,
  options?: { isNewDocument?: boolean },
) {
  if (isReviewDemoRuntimeEnabled()) {
    return buildSettlementAuxiliaryDocId(input)
  }

  const db = getFirestore(getFirebaseApp())
  const tenant = resolveAccountingTenantFields({
    franchiseeId: input.franchiseeId,
    storeId: input.storeId,
  })
  const docId = buildSettlementAuxiliaryDocId({
    franchiseeId: tenant.franchiseeId,
    storeId: tenant.storeId,
    targetYear: input.targetYear,
  })
  const docRef = doc(db, collectionName, docId)

  await setDoc(
    docRef,
    removeUndefinedFields({
      ...input,
      ...tenant,
      updatedAt: serverTimestamp(),
      ...(options?.isNewDocument ? { createdAt: serverTimestamp() } : {}),
    }),
    { merge: true },
  )

  return docId
}
