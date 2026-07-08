import type {
  AccountingFixedCostInput,
  FixedCostAmountMode,
  FixedCostStatus,
  StoredAccountingFixedCost,
} from '../types/accounting'
import { isConfirmedForPl } from '../types/accounting'

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

export const getFiscalYearStartYearMonth = (referenceYearMonth: string) => {
  const [yearText, monthText] = referenceYearMonth.split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!year || !month) {
    return referenceYearMonth
  }

  const fiscalStartYear = month >= 4 ? year : year - 1
  return `${fiscalStartYear}-04`
}

export const getFiscalYearEndYearMonth = (fiscalYearStartYearMonth: string) => {
  const [yearText] = fiscalYearStartYearMonth.split('-')
  const year = Number(yearText)

  if (!year) {
    return fiscalYearStartYearMonth
  }

  return `${year + 1}-03`
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
  const fiscalStart = getFiscalYearStartYearMonth(referenceYearMonth)
  const fiscalEnd = getFiscalYearEndYearMonth(fiscalStart)
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
