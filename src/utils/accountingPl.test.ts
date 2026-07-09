import { describe, expect, it } from 'vitest'
import type {
  StoredAccountingAdjustment,
  StoredAccountingExpense,
  StoredAccountingFixedCost,
} from '../types/accounting'
import { getAccountPlCategory, normalizeExpenseCategory, normalizeExpensePatchForSave, normalizeSalesCategory } from '../types/accounting'
import { calculateMonthlyProfitLoss, calculateYearlyProfitLoss } from './accountingPl'

describe('accounting category master', () => {
  it('maps legacy sales/expense names to current categories', () => {
    expect(normalizeSalesCategory('運賃')).toBe('運賃収入')
    expect(normalizeSalesCategory('介助')).toBe('介助料収入')
    expect(normalizeSalesCategory('機材レンタル')).toBe('機材利用料収入')
    expect(normalizeExpenseCategory('車両費')).toBe('車両修繕費')
    expect(normalizeExpenseCategory('システム費')).toBe('システム利用料')
    expect(normalizeExpenseCategory('高速・駐車場')).toBe('高速代・駐車場代')
    expect(normalizeExpenseCategory('支払手数料')).toBe('決済手数料')
  })

  it('assigns pl category from master', () => {
    expect(getAccountPlCategory('運賃収入')).toBe('sales')
    expect(getAccountPlCategory('外注費')).toBe('costOfSales')
    expect(getAccountPlCategory('システム利用料')).toBe('fixedExpense')
    expect(getAccountPlCategory('燃料費')).toBe('variableExpense')
    expect(getAccountPlCategory('車両費')).toBe('variableExpense')
  })
})

const expense = (overrides: Partial<StoredAccountingExpense>): StoredAccountingExpense => ({
  id: 'e1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  transactionDate: '2026-03-15',
  postingDate: '2026-03-15',
  vendorName: 'vendor',
  description: 'desc',
  expenseCategory: '燃料費',
  taxIncludedAmount: 1000,
  taxRate: 10,
  consumptionTaxAmount: 91,
  paymentMethod: '現金',
  confirmationStatus: '確認済み',
  plTreatment: 'expense',
  createdBy: 'u1',
  createdByName: 'user',
  updatedBy: 'u1',
  updatedByName: 'user',
  ...overrides,
})

const fixedCost = (overrides: Partial<StoredAccountingFixedCost>): StoredAccountingFixedCost => ({
  id: 'fc1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  name: '通信',
  expenseCategory: '通信費',
  amountMode: 'monthly',
  monthlyAmountYen: 5000,
  annualAmountYen: 60_000,
  startYearMonth: '2026-01',
  status: 'active',
  confirmationStatus: '確認済み',
  sourceType: 'fixedCost',
  ...overrides,
})

describe('calculateMonthlyProfitLoss management accounting', () => {
  it('splits cost of sales / fixed / variable and computes gross & operating profit', () => {
    const pl = calculateMonthlyProfitLoss({
      caseRecords: [],
      adjustments: [
        {
          id: 'a1',
          franchiseeId: 'f1',
          companyId: 'f1',
          storeId: 's1',
          adjustmentType: 'sales',
          targetYearMonth: '2026-03',
          salesCategory: '運賃',
          amountYen: 100_000,
          description: 'sales adj',
          confirmationStatus: '確認済み',
          createdBy: 'u1',
          createdByName: 'u',
          updatedBy: 'u1',
          updatedByName: 'u',
        } as StoredAccountingAdjustment,
      ],
      expenses: [
        expense({ id: '1', expenseCategory: '外注費', taxIncludedAmount: 20_000 }),
        expense({ id: '2', expenseCategory: '燃料費', taxIncludedAmount: 8_000 }),
        expense({ id: '3', expenseCategory: 'システム費', taxIncludedAmount: 3_000 }),
        expense({
          id: '4',
          expenseCategory: '車両費',
          taxIncludedAmount: 4_000,
          postingDate: '2026-03-10',
          transactionDate: '2026-03-10',
        }),
      ],
      fixedCosts: [fixedCost({})],
      targetYearMonth: '2026-03',
    })

    expect(pl.salesTotalYen).toBe(100_000)
    expect(pl.costOfSales['外注費']).toBe(20_000)
    expect(pl.costOfSalesTotalYen).toBe(20_000)
    expect(pl.grossProfitYen).toBe(80_000)
    expect(pl.variableExpenses['燃料費']).toBe(8_000)
    expect(pl.variableExpenses['車両修繕費']).toBe(4_000)
    expect(pl.variableExpensesTotalYen).toBe(12_000)
    expect(pl.fixedCosts['システム利用料']).toBe(3_000)
    expect(pl.fixedCosts['通信費']).toBe(5_000)
    expect(pl.fixedCostsTotalYen).toBe(8_000)
    expect(pl.operatingProfitYen).toBe(60_000)
  })
})

describe('calculateYearlyProfitLoss', () => {
  it('aggregates months into year total and prior years', () => {
    const yearly = calculateYearlyProfitLoss({
      caseRecords: [],
      adjustments: [
        {
          id: 'a1',
          franchiseeId: 'f1',
          companyId: 'f1',
          storeId: 's1',
          adjustmentType: 'sales',
          targetYearMonth: '2026-01',
          salesCategory: '運賃収入',
          amountYen: 10_000,
          description: 'jan',
          confirmationStatus: '確認済み',
          createdBy: 'u1',
          createdByName: 'u',
          updatedBy: 'u1',
          updatedByName: 'u',
        } as StoredAccountingAdjustment,
        {
          id: 'a2',
          franchiseeId: 'f1',
          companyId: 'f1',
          storeId: 's1',
          adjustmentType: 'sales',
          targetYearMonth: '2026-02',
          salesCategory: '介助料収入',
          amountYen: 5_000,
          description: 'feb',
          confirmationStatus: '確認済み',
          createdBy: 'u1',
          createdByName: 'u',
          updatedBy: 'u1',
          updatedByName: 'u',
        } as StoredAccountingAdjustment,
      ],
      expenses: [],
      fixedCosts: [],
      targetYear: 2026,
    })

    expect(yearly.columns.m01.salesTotalYen).toBe(10_000)
    expect(yearly.columns.m02.salesTotalYen).toBe(5_000)
    expect(yearly.columns.yearTotal.salesTotalYen).toBe(15_000)
    expect(yearly.columnLabels.twoYearsAgo).toContain('前々期')
    expect(yearly.columnLabels.previousYear).toContain('前期')
  })

  it('reflects fixed asset depreciation as 減価償却費 in monthly PL', () => {
    const pl = calculateMonthlyProfitLoss({
      adjustments: [],
      caseRecords: [],
      expenses: [],
      fixedCosts: [],
      fixedAssets: [
        {
          id: 'fa1',
          franchiseeId: 'f1',
          companyId: 'f1',
          storeId: 's1',
          assetKind: 'fixed',
          purchaseDate: '2026-01-10',
          useStartDate: '2026-03-01',
          assetCategory: 'PC',
          assetName: 'PC',
          condition: '新品',
          acquisitionCost: 240_000,
          standardUsefulLifeYears: 4,
          appliedUsefulLifeYears: 4,
          monthlyDepreciationYen: 5_000,
          depreciationStartYearMonth: '2026-03',
          depreciationEndYearMonth: '2030-02',
          remainingBookValue: 235_000,
          status: 'active',
          notes: '',
        },
      ],
      targetYearMonth: '2026-03',
    })

    expect(pl.fixedCosts['減価償却費']).toBe(5_000)
    expect(pl.fixedCostsTotalYen).toBe(5_000)
  })
})

describe('postingDate-based PL aggregation (backdated entry)', () => {
  it('includes expense in posting month PL, not in entry month (example 1)', () => {
    const backdatedExpense = expense({
      id: 'backdated-1',
      receiptDate: '2026-07-20',
      postingDate: '2026-07-20',
      transactionDate: '2026-07-20',
      taxIncludedAmount: 1_000,
      createdAt: '2026-08-05T00:00:00.000Z',
    })

    const julyPl = calculateMonthlyProfitLoss({
      caseRecords: [],
      adjustments: [],
      expenses: [backdatedExpense],
      fixedCosts: [],
      targetYearMonth: '2026-07',
    })
    const augustPl = calculateMonthlyProfitLoss({
      caseRecords: [],
      adjustments: [],
      expenses: [backdatedExpense],
      fixedCosts: [],
      targetYearMonth: '2026-08',
    })

    expect(julyPl.variableExpenses['燃料費']).toBe(1_000)
    expect(julyPl.confirmedExpenseCount).toBe(1)
    expect(augustPl.variableExpenses['燃料費']).toBe(0)
    expect(augustPl.confirmedExpenseCount).toBe(0)
  })

  it('uses postingDate for PL when receiptDate differs (example 2)', () => {
    const splitDateExpense = expense({
      id: 'split-date-1',
      receiptDate: '2026-07-20',
      postingDate: '2026-08-01',
      transactionDate: '2026-08-01',
      taxIncludedAmount: 1_000,
      createdAt: '2026-08-05T00:00:00.000Z',
    })

    const julyPl = calculateMonthlyProfitLoss({
      caseRecords: [],
      adjustments: [],
      expenses: [splitDateExpense],
      fixedCosts: [],
      targetYearMonth: '2026-07',
    })
    const augustPl = calculateMonthlyProfitLoss({
      caseRecords: [],
      adjustments: [],
      expenses: [splitDateExpense],
      fixedCosts: [],
      targetYearMonth: '2026-08',
    })

    expect(julyPl.variableExpenses['燃料費']).toBe(0)
    expect(augustPl.variableExpenses['燃料費']).toBe(1_000)
    expect(augustPl.confirmedExpenseCount).toBe(1)
  })

  it('syncs transactionDate when postingDate changes on patch save', () => {
    const patch = normalizeExpensePatchForSave({
      postingDate: '2026-07-20',
    })

    expect(patch.postingDate).toBe('2026-07-20')
    expect(patch.transactionDate).toBe('2026-07-20')
  })
})
