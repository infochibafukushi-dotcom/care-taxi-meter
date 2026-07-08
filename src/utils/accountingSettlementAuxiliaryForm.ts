import type { MeterSettings } from '../services/meterSettings'
import type { Company } from '../types/work'
import type {
  AccountingSettlementAuxiliaryInput,
  SettlementBankAccountRow,
  SettlementLoanRow,
  SettlementOfficerLoanRow,
  SettlementPayableRow,
  SettlementReceivableRow,
  StoredAccountingSettlementAuxiliary,
} from '../types/accountingSettlementAuxiliary'
import { resolveAccountingTenantFields } from '../services/accountingTenant'
import { buildETaxCompanyProfile } from './accountingETaxData'

const UNSET = '未設定'

export const createSettlementRowId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const buildEmptyBankAccountRow = (): SettlementBankAccountRow => ({
  id: createSettlementRowId('bank'),
  institutionName: '',
  branchName: '',
  accountType: '普通',
  accountLastFour: '',
  yearEndBalance: null,
  notes: '',
})

export const buildEmptyLoanRow = (): SettlementLoanRow => ({
  id: createSettlementRowId('loan'),
  lenderName: '',
  loanDate: '',
  originalAmount: null,
  yearEndBalance: null,
  repaymentDueDate: '',
  interestRate: '',
  hasCollateral: '無',
  notes: '',
})

export const buildEmptyOfficerLoanRow = (): SettlementOfficerLoanRow => ({
  id: createSettlementRowId('officer-loan'),
  officerName: '',
  occurrenceDate: '',
  description: '',
  yearEndBalance: null,
  notes: '',
})

export const buildEmptyReceivableRow = (): SettlementReceivableRow => ({
  id: createSettlementRowId('receivable'),
  counterpartyName: '',
  registrationNumber: '',
  description: '',
  occurrenceDate: '',
  yearEndBalance: null,
  notes: '',
})

export const buildEmptyPayableRow = (): SettlementPayableRow => ({
  id: createSettlementRowId('payable'),
  counterpartyName: '',
  registrationNumber: '',
  description: '',
  occurrenceDate: '',
  yearEndBalance: null,
  notes: '',
})

export const buildDefaultSettlementAuxiliary = ({
  franchiseeId,
  storeId,
  targetYear,
  company,
  meterSettings,
  staffId,
  staffName,
}: {
  franchiseeId: string
  storeId: string
  targetYear: number
  company: Company | null
  meterSettings: MeterSettings | null
  staffId: string
  staffName?: string
}): AccountingSettlementAuxiliaryInput => {
  const profile = buildETaxCompanyProfile({ targetYear, company, meterSettings })

  return {
    ...resolveAccountingTenantFields({ franchiseeId, storeId }),
    targetYear,
    companyBasic: {
      companyName: profile.companyName === UNSET ? '' : profile.companyName,
      corporateNumber: profile.corporateNumber === UNSET ? '' : profile.corporateNumber,
      address: profile.address === UNSET ? '' : profile.address,
      representativeName: profile.representativeName === UNSET ? '' : profile.representativeName,
      businessDescription: '',
      officerCount: null,
      employeeCount: null,
      fiscalMonthEnd: 3,
      fiscalYearStartDate: `${targetYear}-04-01`,
      fiscalYearEndDate: `${targetYear + 1}-03-31`,
    },
    yearEndBalance: {
      cash: null,
      deposits: null,
      accountsReceivable: null,
      accruedIncome: null,
      prepayments: null,
      accountsPayable: null,
      borrowings: null,
      officerLoans: null,
      capital: null,
      retainedEarnings: null,
      customAccounts: [],
    },
    bankAccounts: [],
    loans: [],
    officerLoans: [],
    receivables: [],
    payables: [],
    updatedBy: staffId,
    updatedByName: staffName,
  }
}

export const mergeSettlementAuxiliary = (
  stored: StoredAccountingSettlementAuxiliary | null,
  defaults: AccountingSettlementAuxiliaryInput,
): AccountingSettlementAuxiliaryInput => {
  if (!stored) {
    return defaults
  }

  return {
    ...defaults,
    ...stored,
    companyBasic: { ...defaults.companyBasic, ...stored.companyBasic },
    yearEndBalance: {
      ...defaults.yearEndBalance,
      ...stored.yearEndBalance,
      customAccounts: stored.yearEndBalance.customAccounts ?? [],
    },
    bankAccounts: stored.bankAccounts ?? [],
    loans: stored.loans ?? [],
    officerLoans: stored.officerLoans ?? [],
    receivables: stored.receivables ?? [],
    payables: stored.payables ?? [],
  }
}

export const getSettlementBalanceAmount = (
  auxiliary: AccountingSettlementAuxiliaryInput | null | undefined,
  key: keyof AccountingSettlementAuxiliaryInput['yearEndBalance'],
): number | null => {
  if (!auxiliary || key === 'customAccounts') {
    return null
  }
  const value = auxiliary.yearEndBalance[key]
  return typeof value === 'number' ? value : null
}

export const hasSettlementText = (value: string | null | undefined) => Boolean(value?.trim())

export const hasSettlementAmount = (value: number | null | undefined) =>
  typeof value === 'number' && !Number.isNaN(value)

export const hasSettlementCount = (value: number | null | undefined) =>
  typeof value === 'number' && !Number.isNaN(value) && value >= 0
