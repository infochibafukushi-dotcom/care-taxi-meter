import type { AccountingTenantFields } from './accounting'

export type SettlementCustomAccount = {
  id: string
  accountName: string
  amountYen: number | null
  mappingId?: string
}

export type SettlementCompanyBasicInfo = {
  companyName: string
  corporateNumber: string
  address: string
  representativeName: string
  businessDescription: string
  officerCount: number | null
  employeeCount: number | null
  /** 決算月（1-12）。4月始まりの場合は 3 */
  fiscalMonthEnd: number | null
  fiscalYearStartDate: string
  fiscalYearEndDate: string
}

export type SettlementYearEndBalance = {
  cash: number | null
  deposits: number | null
  accountsReceivable: number | null
  accruedIncome: number | null
  prepayments: number | null
  accountsPayable: number | null
  borrowings: number | null
  officerLoans: number | null
  capital: number | null
  retainedEarnings: number | null
  customAccounts: SettlementCustomAccount[]
}

export type SettlementBankAccountRow = {
  id: string
  institutionName: string
  branchName: string
  accountType: string
  accountLastFour: string
  yearEndBalance: number | null
  notes: string
}

export type SettlementLoanRow = {
  id: string
  lenderName: string
  loanDate: string
  originalAmount: number | null
  yearEndBalance: number | null
  repaymentDueDate: string
  interestRate: string
  hasCollateral: string
  notes: string
}

export type SettlementOfficerLoanRow = {
  id: string
  officerName: string
  occurrenceDate: string
  description: string
  yearEndBalance: number | null
  notes: string
}

export type SettlementReceivableRow = {
  id: string
  counterpartyName: string
  registrationNumber: string
  description: string
  occurrenceDate: string
  yearEndBalance: number | null
  notes: string
}

export type SettlementPayableRow = {
  id: string
  counterpartyName: string
  registrationNumber: string
  description: string
  occurrenceDate: string
  yearEndBalance: number | null
  notes: string
}

export type AccountingSettlementAuxiliaryInput = AccountingTenantFields & {
  targetYear: number
  companyBasic: SettlementCompanyBasicInfo
  yearEndBalance: SettlementYearEndBalance
  bankAccounts: SettlementBankAccountRow[]
  loans: SettlementLoanRow[]
  officerLoans: SettlementOfficerLoanRow[]
  receivables: SettlementReceivableRow[]
  payables: SettlementPayableRow[]
  updatedBy: string
  updatedByName?: string
}

export type StoredAccountingSettlementAuxiliary = AccountingSettlementAuxiliaryInput & {
  id: string
  createdAt?: string
  updatedAt?: string
}
