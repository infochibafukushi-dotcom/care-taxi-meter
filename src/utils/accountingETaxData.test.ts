import { describe, expect, it } from 'vitest'
import {
  buildETaxBsInput,
  buildETaxCheckItems,
  buildETaxCompanyProfile,
  buildETaxInputStatus,
  buildETaxPackage,
} from './accountingETaxData'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'

const completeAuxiliary = {
  companyBasic: {
    companyName: 'ちばケアタクシー',
    corporateNumber: '',
    address: '',
    representativeName: '',
    businessDescription: '介護タクシー事業',
    officerCount: 2,
    employeeCount: 5,
    fiscalMonthEnd: 3,
    fiscalYearStartDate: '2026-04-01',
    fiscalYearEndDate: '2027-03-31',
  },
  yearEndBalance: {
    cash: 50000,
    deposits: 2500000,
    accountsReceivable: 0,
    accruedIncome: 0,
    prepayments: 0,
    accountsPayable: 0,
    borrowings: 5000000,
    officerLoans: 0,
    capital: 1000000,
    retainedEarnings: 300000,
    customAccounts: [],
  },
  bankAccounts: [
    {
      id: '1',
      institutionName: '千葉銀行',
      branchName: '中央支店',
      accountType: '普通',
      accountLastFour: '1234',
      yearEndBalance: 2500000,
      notes: '',
    },
  ],
  loans: [
    {
      id: '1',
      lenderName: '千葉銀行',
      loanDate: '2024-04-01',
      originalAmount: 6000000,
      yearEndBalance: 5000000,
      repaymentDueDate: '',
      interestRate: '',
      hasCollateral: '無',
      notes: '',
    },
  ],
  officerLoans: [],
  receivables: [],
  payables: [],
} as AccountingSettlementAuxiliaryInput

describe('buildETaxCheckItems', () => {
  it('classifies zero-balance optional fields as 該当なし', () => {
    const items = buildETaxCheckItems(completeAuxiliary)
    const naLabels = items.filter((item) => item.status === 'na').map((item) => item.label)

    expect(naLabels).toContain('売掛金残高')
    expect(naLabels).toContain('未収金残高')
    expect(naLabels).toContain('仮払金残高')
    expect(naLabels).toContain('未払金残高')
    expect(naLabels).toContain('役員借入金残高')
  })

  it('reports balance and breakdown mismatch as 要確認', () => {
    const items = buildETaxCheckItems({
      ...completeAuxiliary,
      bankAccounts: [
        {
          ...completeAuxiliary.bankAccounts[0],
          yearEndBalance: 2400000,
        },
      ],
    })

    const review = items.find((item) => item.mappingId === 'etax.check.deposits.mismatch')
    expect(review?.status).toBe('review')
    expect(review?.detail).toBe('残高 2500000 / 内訳合計 2400000')
  })

  it('checks receivable kind totals separately', () => {
    const items = buildETaxCheckItems({
      ...completeAuxiliary,
      yearEndBalance: {
        ...completeAuxiliary.yearEndBalance,
        accountsReceivable: 100000,
        accruedIncome: 0,
      },
      receivables: [
        {
          id: 'r1',
          receivableKind: 'accountsReceivable',
          counterpartyName: 'A社',
          registrationNumber: '',
          description: '',
          occurrenceDate: '2026-01-01',
          yearEndBalance: 80000,
          notes: '',
        },
      ],
    })

    expect(items.some((item) => item.mappingId === 'etax.check.accountsReceivable.mismatch')).toBe(true)
  })

  it('summarizes four status counts for input status', () => {
    const inputStatus = buildETaxInputStatus(buildETaxCheckItems(completeAuxiliary))

    expect(inputStatus.requiredCount).toBe(0)
    expect(inputStatus.naCount).toBe(5)
    expect(inputStatus.reviewCount).toBe(0)
    expect(inputStatus.plannedCount).toBe(1)
    expect(inputStatus.actionRequiredItems).toHaveLength(0)
  })
})

describe('buildETaxBsInput', () => {
  it('includes zero-balance optional accounts as 該当なし', () => {
    const lines = buildETaxBsInput([], '2027-03', completeAuxiliary)
    const naLabels = lines.filter((line) => line.status === 'na').map((line) => line.label)

    expect(naLabels).toEqual(['売掛金', '未収金', '仮払金', '未払金', '役員借入金'])
  })
})

describe('buildETaxCompanyProfile fiscal period label', () => {
  it('uses FiscalPeriod label for FY2026', () => {
    const profile = buildETaxCompanyProfile({
      targetYear: 2026,
      company: null,
      meterSettings: null,
    })
    expect(profile.fiscalYearLabel).toBe('2026年度（2026/7/7〜2027/3/31）')
  })

  it('shows 会社設立前の年度です before incorporation', () => {
    const profile = buildETaxCompanyProfile({
      targetYear: 2025,
      company: null,
      meterSettings: null,
    })
    expect(profile.fiscalYearLabel).toBe('会社設立前の年度です')
  })
})

describe('buildETaxPackage as-of month', () => {
  it('uses period endYearMonth for BS/asset as-of even if targetYearMonth differs', () => {
    const asset = {
      id: 'asset-1',
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      assetKind: 'fixed',
      assetName: '車両',
      assetCategory: '車両運搬具',
      purchaseDate: '2026-07-07',
      useStartDate: '2026-07-07',
      condition: '新品',
      acquisitionCost: 1_200_000,
      standardUsefulLifeYears: 6,
      appliedUsefulLifeYears: 6,
      depreciationStartYearMonth: '2026-07',
      depreciationEndYearMonth: '2032-06',
      monthlyDepreciationYen: 16_666,
      remainingBookValue: 1_200_000,
      status: 'active',
      isDeleted: false,
      notes: '',
      createdBy: 'staff',
      updatedBy: 'staff',
    } as StoredAccountingFixedAsset

    const withPeriodEnd = buildETaxPackage({
      targetYear: 2026,
      targetYearMonth: '2027-03',
      company: null,
      meterSettings: null,
      caseRecords: [],
      expenses: [],
      adjustments: [],
      fixedCosts: [],
      fixedAssets: [asset],
      auxiliary: null,
    })
    const withOtherMonth = buildETaxPackage({
      targetYear: 2026,
      targetYearMonth: '2026-09',
      company: null,
      meterSettings: null,
      caseRecords: [],
      expenses: [],
      adjustments: [],
      fixedCosts: [],
      fixedAssets: [asset],
      auxiliary: null,
    })

    expect(withPeriodEnd.fixedAssets[0]?.cumulativeDepreciationYen).toBe(
      withOtherMonth.fixedAssets[0]?.cumulativeDepreciationYen,
    )
    expect(withPeriodEnd.fixedAssets[0]?.remainingBookValue).toBe(
      withOtherMonth.fixedAssets[0]?.remainingBookValue,
    )
  })
})
