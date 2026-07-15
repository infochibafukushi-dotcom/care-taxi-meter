import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type { AccountingSettlementAuxiliaryInput } from '../types/accountingSettlementAuxiliary'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod, getFiscalPeriodMonths } from './accountingFiscalPeriod'
import {
  buildAccountingFilingChecks,
  compareSettlementAmount,
  filterFilingChecks,
  formatYen,
  summarizeFilingChecks,
} from './accountingFilingCheck'

const baseAuxiliary = {
  companyBasic: {
    companyName: '株式会社千葉福祉サポート',
    corporateNumber: '',
    address: '',
    representativeName: '',
    businessDescription: '介護タクシー事業',
    officerCount: 1,
    employeeCount: 1,
    fiscalMonthEnd: 3,
    fiscalYearStartDate: '2026-07-07',
    fiscalYearEndDate: '2027-03-31',
  },
  yearEndBalance: {
    cash: 10000,
    deposits: 1000000,
    accountsReceivable: 0,
    accruedIncome: 0,
    prepayments: 0,
    accountsPayable: 0,
    borrowings: 500000,
    officerLoans: 0,
    capital: 1000000,
    retainedEarnings: 0,
    customAccounts: [],
  },
  bankAccounts: [
    {
      id: 'b1',
      institutionName: '千葉銀行',
      branchName: '中央',
      accountType: '普通',
      accountLastFour: '1234',
      yearEndBalance: 1000000,
      notes: '',
    },
  ],
  loans: [
    {
      id: 'l1',
      lenderName: '千葉銀行',
      loanDate: '2026-08-01',
      originalAmount: 500000,
      yearEndBalance: 500000,
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

const makeExpense = (
  overrides: Partial<StoredAccountingExpense> & { id: string },
): StoredAccountingExpense =>
  ({
    franchiseeId: 'f1',
    storeId: 's1',
    vendorName: 'テスト商店',
    description: '消耗品',
    expenseCategory: '消耗品費',
    taxIncludedAmount: 1100,
    consumptionTaxAmount: 100,
    taxRate: 10,
    taxCategory: 'taxable',
    paymentMethod: '現金',
    confirmationStatus: '確認済み',
    postingDate: '2026-08-15',
    transactionDate: '2026-08-15',
    receiptDate: '2026-08-15',
    receiptImageUrl: 'https://example.com/r.jpg',
    createdBy: 'u1',
    createdByName: 'u1',
    updatedBy: 'u1',
    updatedByName: 'u1',
    plTreatment: 'expense',
    ...overrides,
  }) as StoredAccountingExpense

const makeReceipt = (
  overrides: Partial<StoredAccountingReceipt> & { id: string },
): StoredAccountingReceipt =>
  ({
    id: overrides.id,
    franchiseeId: 'f1',
    storeId: 's1',
    storagePath: 'receipts/a.jpg',
    downloadUrl: 'https://example.com/a.jpg',
    originalStoragePath: 'receipts/a.jpg',
    originalDownloadUrl: 'https://example.com/a.jpg',
    mimeType: 'image/jpeg',
    fileName: 'a.jpg',
    fileSizeBytes: 10,
    status: 'linked',
    receiptDate: '2026-08-15',
    uploadedBy: 'u1',
    uploadedByName: 'u1',
    ...overrides,
  }) as StoredAccountingReceipt

describe('compareSettlementAmount', () => {
  it('returns notApplicable when flagged', () => {
    expect(
      compareSettlementAmount({
        expectedAmountYen: 100,
        actualAmountYen: 100,
        expectedEntered: true,
        actualEntered: true,
        notApplicable: true,
      }).status,
    ).toBe('notApplicable')
  })

  it('returns warning when both unset', () => {
    expect(
      compareSettlementAmount({
        expectedAmountYen: null,
        actualAmountYen: null,
        expectedEntered: false,
        actualEntered: false,
      }).status,
    ).toBe('warning')
  })

  it('returns notApplicable for zero balance entered', () => {
    expect(
      compareSettlementAmount({
        expectedAmountYen: 0,
        actualAmountYen: null,
        expectedEntered: true,
        actualEntered: false,
      }).status,
    ).toBe('notApplicable')
  })

  it('returns complete when amounts match', () => {
    const result = compareSettlementAmount({
      expectedAmountYen: 1000,
      actualAmountYen: 1000,
      expectedEntered: true,
      actualEntered: true,
    })
    expect(result.status).toBe('complete')
    expect(result.differenceYen).toBe(0)
  })

  it('returns blocking on mismatch', () => {
    const result = compareSettlementAmount({
      expectedAmountYen: 1000,
      actualAmountYen: 980,
      expectedEntered: true,
      actualEntered: true,
    })
    expect(result.status).toBe('blocking')
    expect(result.differenceYen).toBe(20)
  })

  it('returns blocking when balance positive and breakdown empty', () => {
    expect(
      compareSettlementAmount({
        expectedAmountYen: 1000,
        actualAmountYen: null,
        expectedEntered: true,
        actualEntered: false,
      }).status,
    ).toBe('blocking')
  })

  it('returns warning when breakdown only', () => {
    expect(
      compareSettlementAmount({
        expectedAmountYen: null,
        actualAmountYen: 1000,
        expectedEntered: false,
        actualEntered: true,
      }).status,
    ).toBe('warning')
  })
})

describe('formatYen', () => {
  it('formats with ja locale', () => {
    expect(formatYen(1000000)).toBe('1,000,000円')
  })
})

describe('buildAccountingFilingChecks', () => {
  it('marks FY2026 period complete with short first year', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    const periodItem = summary.items.find((item) => item.id === 'period.available')
    expect(periodItem?.status).toBe('complete')
    expect(period?.label).toContain('2026')
    expect(periodItem?.summary).toBe(period!.label)
  })

  it('marks asOfMonth notApplicable when no saved baseline month', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    const asOf = summary.items.find((item) => item.id === 'period.asOfMonth')
    expect(asOf?.status).toBe('notApplicable')
    expect(asOf?.label).toBe('基準月（期末）')
    expect(asOf?.summary).toBe('比較対象となる保存済み基準月がありません')
    expect(asOf?.detail).toContain(period.endYearMonth)
  })

  it('blocks pre-incorporation year', () => {
    const summary = buildAccountingFilingChecks({
      targetYear: 2025,
      fiscalPeriod: null,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: null,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'period.available')?.status).toBe('blocking')
    expect(summary.items.find((item) => item.id === 'period.available')?.summary).toBe(
      '会社設立前の年度です',
    )
    expect(summary.blockingCount).toBeGreaterThan(0)
    expect(summary.isFilingReady).toBe(false)
  })

  it('marks deposits match complete when equal', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'settlement.depositsMatch')?.status).toBe(
      'complete',
    )
  })

  it('blocks deposits mismatch', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        bankAccounts: [{ ...baseAuxiliary.bankAccounts[0], yearEndBalance: 980000 }],
      },
      company: null,
    })

    const deposits = summary.items.find((item) => item.id === 'settlement.depositsMatch')
    expect(deposits?.status).toBe('blocking')
    expect(deposits?.differenceYen).toBe(20000)
  })

  it('warns when deposits both empty', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        yearEndBalance: { ...baseAuxiliary.yearEndBalance, deposits: null },
        bankAccounts: [],
      },
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'settlement.depositsMatch')?.status).toBe(
      'warning',
    )
  })

  it('treats deposits zero as notApplicable', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        yearEndBalance: { ...baseAuxiliary.yearEndBalance, deposits: 0 },
        bankAccounts: [],
      },
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'settlement.depositsMatch')?.status).toBe(
      'notApplicable',
    )
  })

  it('warns when deposits breakdown only', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        yearEndBalance: { ...baseAuxiliary.yearEndBalance, deposits: null },
      },
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'settlement.depositsMatch')?.status).toBe(
      'warning',
    )
  })

  it('checks borrowings match and mismatch', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const ok = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    expect(ok.items.find((item) => item.id === 'settlement.borrowingsMatch')?.status).toBe('complete')

    const bad = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        loans: [{ ...baseAuxiliary.loans[0], yearEndBalance: 400000 }],
      },
      company: null,
    })
    expect(bad.items.find((item) => item.id === 'settlement.borrowingsMatch')?.status).toBe(
      'blocking',
    )
  })

  it('blocks unorganized receipts', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [{ id: 'r1' } as never],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'receipts.unorganized')?.status).toBe('blocking')
    expect(summary.isFilingReady).toBe(false)
  })

  it('blocks missing tax rate on taxable expenses', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [makeExpense({ id: 'e1', taxRate: null })],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'expenses.missingTaxRate')?.status).toBe(
      'blocking',
    )
  })

  it('blocks fixed asset candidate without override', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [
        makeExpense({
          id: 'e2',
          taxIncludedAmount: 150000,
          description: '福祉車両用品',
          normalExpenseOverrideConfirmed: false,
        }),
      ],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'expenses.fixedAssetCandidate')?.status).toBe(
      'blocking',
    )
  })

  it('does not count planned in blockingCount and allows filing ready when only planned/warnings', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.plannedCount).toBeGreaterThan(0)
    expect(summary.items.some((item) => item.id === 'planned.corporateTax')).toBe(true)
    expect(summary.items.some((item) => item.id === 'planned.fullBalanceSheetEquality')).toBe(true)
    expect(
      summary.items.find((item) => item.id === 'planned.fullBalanceSheetEquality')?.label,
    ).not.toMatch(/BS貸借一致/)

    // capital positive → warning (no automatic company match), cash set → complete
    expect(summary.blockingCount).toBe(0)
    expect(summary.isFilingReady).toBe(true)
    expect(summary.plannedCount).not.toBe(summary.blockingCount)
  })

  it('blocks when settlement auxiliary fetch fails and does not treat it as empty defaults', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const loadError = 'accountingSettlementAuxiliary: Missing or insufficient permissions.'
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: null,
      company: null,
      settlementAuxiliaryLoadError: loadError,
    })

    const loadItem = summary.items.find((item) => item.id === 'system.settlementAuxiliaryLoad')
    expect(loadItem?.status).toBe('blocking')
    expect(loadItem?.detail).toBe(loadError)
    expect(summary.items.some((item) => item.id === 'settlement.depositsMatch')).toBe(false)
    expect(summary.blockingCount).toBeGreaterThan(0)
    expect(summary.isFilingReady).toBe(false)
  })

  it('excludes deleted expenses from unconfirmed counts', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [
        makeExpense({
          id: 'e3',
          confirmationStatus: '未確認',
          isDeleted: true,
        }),
      ],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'expenses.unconfirmed')?.status).toBe('complete')
  })

  it('does not block expense checks when only deleted expenses have issues', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [
        makeExpense({
          id: 'del1',
          isDeleted: true,
          expenseCategory: '' as never,
          taxRate: null,
          taxCategory: 'non_taxable',
          consumptionTaxAmount: 100,
          confirmationStatus: '未確認',
          receiptImageUrl: undefined,
          receiptId: undefined,
        }),
      ],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'expenses.unconfirmed')?.status).toBe('complete')
    expect(summary.items.find((item) => item.id === 'expenses.missingCategory')?.status).toBe(
      'complete',
    )
    expect(summary.items.find((item) => item.id === 'expenses.missingTaxRate')?.status).toBe(
      'complete',
    )
    expect(summary.items.find((item) => item.id === 'receipts.expenseMissingVoucher')?.status).toBe(
      'complete',
    )
  })

  it('filters expenses by fiscal period months', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    expect(period.isShortFiscalYear).toBe(true)
    expect(getFiscalPeriodMonths(period)).not.toContain('2026-04')
    expect(getFiscalPeriodMonths(period)).toContain('2026-07')
    expect(getFiscalPeriodMonths(period)).not.toContain('2027-04')

    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [
        makeExpense({
          id: 'out-apr',
          postingDate: '2026-04-15',
          transactionDate: '2026-04-15',
          expenseCategory: '' as never,
        }),
        makeExpense({
          id: 'in-jul',
          postingDate: '2026-07-07',
          transactionDate: '2026-07-07',
          expenseCategory: '' as never,
        }),
        makeExpense({
          id: 'out-next',
          postingDate: '2027-04-01',
          transactionDate: '2027-04-01',
          expenseCategory: '' as never,
        }),
      ],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    const missingCategory = summary.items.find((item) => item.id === 'expenses.missingCategory')
    expect(missingCategory?.status).toBe('blocking')
    expect(missingCategory?.sourceIds).toEqual(['in-jul'])
  })

  it('excludes plTreatment non-expense from missingCategory blocking', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [
        makeExpense({
          id: 'excluded1',
          expenseCategory: '' as never,
          plTreatment: 'excluded',
        }),
      ],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'expenses.missingCategory')?.status).toBe(
      'complete',
    )
  })

  it('warns on capital unset, zero, and positive without mismatch wording', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)

    const unset = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        yearEndBalance: { ...baseAuxiliary.yearEndBalance, capital: null },
      },
      company: null,
    })
    expect(unset.items.find((item) => item.id === 'settlement.capital')?.status).toBe('warning')
    expect(unset.items.find((item) => item.id === 'settlement.capital')?.summary).toBe(
      '資本金が未入力です',
    )

    const zero = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: {
        ...baseAuxiliary,
        yearEndBalance: { ...baseAuxiliary.yearEndBalance, capital: 0 },
      },
      company: null,
    })
    const zeroItem = zero.items.find((item) => item.id === 'settlement.capital')
    expect(zeroItem?.status).toBe('warning')
    expect(zeroItem?.summary).toContain('資本金が0円で入力されています')
    expect(zeroItem?.summary).not.toMatch(/不一致/)

    const positive = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    const positiveItem = positive.items.find((item) => item.id === 'settlement.capital')
    expect(positiveItem?.status).toBe('warning')
    expect(positiveItem?.summary).toContain('会社基本情報との自動照合には未対応')
    expect(positiveItem?.summary).not.toMatch(/不一致/)
    expect(positiveItem?.detail).toContain('1,000,000円')
  })

  it('blocks dangling and mismatch receipt links but not healthy one-way links', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)

    const danglingExpense = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [makeExpense({ id: 'e-dangle', receiptId: 'missing-r' })],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    expect(
      danglingExpense.items.find((item) => item.id === 'receipts.expenseReceiptMissing')?.status,
    ).toBe('blocking')

    const orphanReceipt = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [makeReceipt({ id: 'r-orphan', linkedExpenseId: 'missing-e', status: 'linked' })],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    expect(
      orphanReceipt.items.find((item) => item.id === 'receipts.orphanLinkedExpense')?.status,
    ).toBe('blocking')

    const mismatch = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [makeExpense({ id: 'e1', receiptId: 'r1' })],
      receipts: [makeReceipt({ id: 'r1', linkedExpenseId: 'e2', status: 'linked' })],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    expect(mismatch.items.find((item) => item.id === 'receipts.linkMismatch')?.status).toBe(
      'blocking',
    )

    const oneWayExpense = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [makeExpense({ id: 'e1', receiptId: 'r1' })],
      receipts: [makeReceipt({ id: 'r1', linkedExpenseId: undefined, status: 'unorganized' })],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    expect(oneWayExpense.items.find((item) => item.id === 'receipts.linkMismatch')?.status).toBe(
      'complete',
    )
    expect(
      oneWayExpense.items.find((item) => item.id === 'receipts.expenseReceiptMissing')?.status,
    ).toBe('complete')

    const oneWayReceipt = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [makeExpense({ id: 'e1', receiptId: undefined })],
      receipts: [makeReceipt({ id: 'r1', linkedExpenseId: 'e1', status: 'linked' })],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })
    expect(oneWayReceipt.items.find((item) => item.id === 'receipts.linkMismatch')?.status).toBe(
      'complete',
    )
    expect(
      oneWayReceipt.items.find((item) => item.id === 'receipts.orphanLinkedExpense')?.status,
    ).toBe('complete')
  })

  it('blocks linked receipts missing original storage and urls', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [makeExpense({ id: 'e1', receiptId: 'r1' })],
      receipts: [
        makeReceipt({
          id: 'r1',
          linkedExpenseId: 'e1',
          status: 'linked',
          storagePath: '',
          downloadUrl: '',
          originalStoragePath: '',
          originalDownloadUrl: '',
          ocrImageStoragePath: '',
          ocrImageDownloadUrl: '',
        }),
      ],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    const item = summary.items.find((row) => row.id === 'receipts.missingOriginalStorage')
    expect(item?.status).toBe('blocking')
    expect(item?.detail).toContain('原本ファイルがありません')
  })

  it('filterFilingChecks actionable returns blocking and warning only', () => {
    const items = summarizeFilingChecks([
      {
        id: 'a',
        category: 'expenses',
        label: 'a',
        status: 'blocking',
        summary: '',
      },
      {
        id: 'b',
        category: 'expenses',
        label: 'b',
        status: 'warning',
        summary: '',
      },
      {
        id: 'c',
        category: 'tax',
        label: 'c',
        status: 'planned',
        summary: '',
      },
      {
        id: 'd',
        category: 'period',
        label: 'd',
        status: 'complete',
        summary: '',
      },
    ]).items

    const actionable = filterFilingChecks(items, 'actionable')
    expect(actionable.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('fixed assets ending book value', () => {
  it('uses endingBookValue id and labels without 台帳整合 wording', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.some((item) => item.id === 'fixedAssets.ledgerIntegrity')).toBe(false)
    const ending = summary.items.find((item) => item.id === 'fixedAssets.endingBookValue')
    expect(ending?.status).toBe('notApplicable')
    expect(ending?.label).toBe('固定資産台帳の期末帳簿価額')
    expect(ending?.summary).toBe('固定資産台帳に登録がありません')
    expect(JSON.stringify(summary.items)).not.toMatch(/台帳整合/)
    expect(JSON.stringify(summary.items)).not.toMatch(/固定資産帳簿価額と台帳合計/)
  })

  it('blocks when remaining book value is negative at period end', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    const asset = {
      id: 'fa1',
      franchiseeId: 'f1',
      storeId: 's1',
      assetKind: 'fixed',
      purchaseDate: '2026-08-01',
      useStartDate: '2026-08-01',
      assetCategory: '車両',
      assetName: 'テスト車両',
      condition: '新品',
      acquisitionCost: 100000,
      standardUsefulLifeYears: 4,
      appliedUsefulLifeYears: 4,
      monthlyDepreciationYen: 50000,
      depreciationStartYearMonth: '2020-01',
      depreciationEndYearMonth: '2020-12',
      remainingBookValue: -1,
      status: 'active',
    } as StoredAccountingFixedAsset

    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [asset],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    expect(summary.items.find((item) => item.id === 'fixedAssets.negativeBookValue')?.status).toBe(
      'blocking',
    )
    expect(summary.items.find((item) => item.id === 'fixedAssets.endingBookValue')?.status).toBe(
      'blocking',
    )
  })

  it('completes ending book value with period end month and short-year note', () => {
    const period = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!
    const asset = {
      id: 'fa2',
      franchiseeId: 'f1',
      storeId: 's1',
      assetKind: 'fixed',
      purchaseDate: '2026-08-01',
      useStartDate: '2026-08-01',
      assetCategory: '車両',
      assetName: 'テスト車両',
      condition: '新品',
      acquisitionCost: 120000,
      standardUsefulLifeYears: 4,
      appliedUsefulLifeYears: 4,
      monthlyDepreciationYen: 2500,
      depreciationStartYearMonth: '2026-08',
      depreciationEndYearMonth: '2030-07',
      remainingBookValue: 120000,
      status: 'active',
    } as StoredAccountingFixedAsset

    const summary = buildAccountingFilingChecks({
      targetYear: 2026,
      fiscalPeriod: period,
      expenses: [],
      receipts: [],
      unorganizedReceipts: [],
      fixedAssets: [asset],
      settlementAuxiliary: baseAuxiliary,
      company: null,
    })

    const ending = summary.items.find((item) => item.id === 'fixedAssets.endingBookValue')
    expect(ending?.status).toBe('complete')
    expect(ending?.summary).toContain(`期末基準月=${period.endYearMonth}`)
    expect(ending?.summary).toContain('台帳合計=')
    expect(ending?.detail).toContain('突合は未実施')
    expect(ending?.detail).toContain('初年度短縮のため償却対象月は期末会計年度の月のみ')
  })
})
