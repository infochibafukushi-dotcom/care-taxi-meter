import type {
  AccountingFixedCostInput,
  FixedCostAmountMode,
  FixedCostStatus,
  StoredAccountingFixedCost,
} from '../types/accounting'
import { isConfirmedForPl } from '../types/accounting'
import type { CompanyFiscalPolicy } from '../types/accountingFiscalPeriod'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from './accountingFiscalPeriod'

export const getFixedCostCancelYearMonth = (
  cost: Pick<StoredAccountingFixedCost, 'cancelYearMonth' | 'endYearMonth'>,
) => cost.cancelYearMonth ?? cost.endYearMonth

export const deriveFixedCostStatus = (
  cost: Pick<StoredAccountingFixedCost, 'status' | 'cancelYearMonth' | 'endYearMonth' | 'confirmationStatus'>,
): FixedCostStatus => {
  if (cost.confirmationStatus === '無効') {
    return 'cancelled'
  }

  if (cost.status === 'active' || cost.status === 'cancelled') {
    return cost.status
  }

  return getFixedCostCancelYearMonth(cost) ? 'cancelled' : 'active'
}

export const isFixedCostActiveForMonth = (
  cost: StoredAccountingFixedCost,
  targetYearMonth: string,
) => {
  if (!isConfirmedForPl(cost.confirmationStatus)) {
    return false
  }

  if (cost.startYearMonth > targetYearMonth) {
    return false
  }

  const cancelYearMonth = getFixedCostCancelYearMonth(cost)
  if (cancelYearMonth && targetYearMonth > cancelYearMonth) {
    return false
  }

  return true
}

export const syncFixedCostAmounts = (
  amountMode: FixedCostAmountMode,
  monthlyAmountYen: number,
  annualAmountYen: number,
) => {
  if (amountMode === 'monthly') {
    return {
      monthlyAmountYen,
      annualAmountYen: monthlyAmountYen * 12,
    }
  }

  return {
    monthlyAmountYen: Math.round(annualAmountYen / 12),
    annualAmountYen,
  }
}

/** 対象年月から候補となる会計年度キー（開始側年）を求める。日割りなし。 */
export const resolveCandidateFiscalYear = (
  referenceYearMonth: string,
  policy: CompanyFiscalPolicy,
): number | null => {
  const [yearText, monthText] = referenceYearMonth.split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!year || !month || month < 1 || month > 12) {
    return null
  }

  const startMonth = policy.fiscalYearEndMonth === 12 ? 1 : policy.fiscalYearEndMonth + 1
  return month >= startMonth ? year : year - 1
}

export const getFiscalYearStartYearMonth = (referenceYearMonth: string) => {
  const candidateFiscalYear = resolveCandidateFiscalYear(referenceYearMonth, COMPANY_FISCAL_POLICY)
  if (candidateFiscalYear == null) {
    return referenceYearMonth
  }

  return (
    getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, candidateFiscalYear)?.startYearMonth ??
    referenceYearMonth
  )
}

export const getFiscalYearEndYearMonth = (fiscalYearStartYearMonth: string) => {
  const candidateFiscalYear = resolveCandidateFiscalYear(
    fiscalYearStartYearMonth,
    COMPANY_FISCAL_POLICY,
  )
  if (candidateFiscalYear == null) {
    return fiscalYearStartYearMonth
  }

  return (
    getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, candidateFiscalYear)?.endYearMonth ??
    fiscalYearStartYearMonth
  )
}

export const countYearMonthsInclusive = (startYearMonth: string, endYearMonth: string) => {
  const [startYear, startMonth] = startYearMonth.split('-').map(Number)
  const [endYear, endMonth] = endYearMonth.split('-').map(Number)

  if (!startYear || !startMonth || !endYear || !endMonth || startYearMonth > endYearMonth) {
    return 0
  }

  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1
}

export const calculateFixedCostFiscalYearAmount = (
  cost: Pick<StoredAccountingFixedCost, 'monthlyAmountYen' | 'startYearMonth' | 'cancelYearMonth' | 'endYearMonth'>,
  referenceYearMonth: string,
) => {
  const candidateFiscalYear = resolveCandidateFiscalYear(referenceYearMonth, COMPANY_FISCAL_POLICY)
  if (candidateFiscalYear == null) {
    return 0
  }

  const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, candidateFiscalYear)
  if (!period) {
    return 0
  }

  const fiscalStart = period.startYearMonth
  const fiscalEnd = period.endYearMonth
  const effectiveStart = cost.startYearMonth > fiscalStart ? cost.startYearMonth : fiscalStart

  const cancelYearMonth = getFixedCostCancelYearMonth(cost)
  const effectiveEnd =
    cancelYearMonth && cancelYearMonth < fiscalEnd ? cancelYearMonth : fiscalEnd

  if (effectiveStart > effectiveEnd) {
    return 0
  }

  const monthCount = countYearMonthsInclusive(effectiveStart, effectiveEnd)
  return cost.monthlyAmountYen * monthCount
}

export const formatFixedCostYearMonthLabel = (yearMonth?: string) => {
  if (!yearMonth) {
    return '—'
  }

  const [year, month] = yearMonth.split('-')
  if (!year || !month) {
    return yearMonth
  }

  return `${year}/${month}`
}

export const buildEmptyFixedCostInput = ({
  franchiseeId,
  storeId,
  staffId,
}: {
  franchiseeId: string
  storeId: string
  staffId: string
}): AccountingFixedCostInput => ({
  franchiseeId,
  companyId: franchiseeId,
  storeId,
  name: '',
  expenseCategory: '通信費',
  amountMode: 'monthly',
  monthlyAmountYen: 0,
  annualAmountYen: 0,
  startYearMonth: '',
  status: 'active',
  memo: '',
  confirmationStatus: '確認済み',
  sourceType: 'fixedCost',
  createdBy: staffId,
  updatedBy: staffId,
})
