import type { TaxAdvisorPackage } from '../types/accountingTaxAdvisor'
import type { MonthlyProfitLoss } from '../types/accounting'

const emptyBreakdown = () => ({}) as MonthlyProfitLoss['sales']

const emptyPl = (): MonthlyProfitLoss => ({
  targetYearMonth: '2027-03',
  sales: emptyBreakdown(),
  salesTotalYen: 1_000_000,
  costOfSales: {} as MonthlyProfitLoss['costOfSales'],
  costOfSalesTotalYen: 0,
  grossProfitYen: 1_000_000,
  fixedCosts: {} as MonthlyProfitLoss['fixedCosts'],
  fixedCostsTotalYen: 41_080,
  fixedCostCount: 1,
  variableExpenses: {} as MonthlyProfitLoss['variableExpenses'],
  variableExpensesTotalYen: 0,
  expenses: {} as MonthlyProfitLoss['expenses'],
  expensesTotalYen: 41_080,
  deferredCandidate: {} as MonthlyProfitLoss['deferredCandidate'],
  deferredCandidateTotalYen: 0,
  deferredCandidateCount: 0,
  operatingProfitYen: 958_920,
  caseRecordCount: 0,
  confirmedExpenseCount: 0,
})

const line = (label: string, displayValue: string, amountYen: number | null = null) => ({
  label,
  displayValue,
  amountYen,
  status: 'ok' as const,
})

/** Minimal package for PDF generation / size smoke — no Firebase imports. */
export const createTaxAdvisorPdfSamplePackage = (): TaxAdvisorPackage =>
  ({
    header: {
      targetYear: 2026,
      fiscalYearLabel: '2026年度（2026/7/7〜2027/3/31）',
      companyName: '株式会社千葉福祉サポート',
      storeName: 'ちばケアタクシー',
      createdDate: '2026-07-15',
      purpose: '税理士相談・申告前確認用の根拠資料一式',
    },
    etax: {
      company: {
        fiscalYearLabel: '2026年度（2026/7/7〜2027/3/31）',
      },
      summary: [
        line('会社名', '株式会社千葉福祉サポート'),
        line('店舗', 'ちばケアタクシー'),
        line('金額', '￥41,080', 41080),
        line('記号', '①②③'),
      ],
      pl: emptyPl(),
      balanceSheet: [line('資産', '現金', 500_000), line('負債', '未払金', 100_000)],
      bsInput: [],
      fixedAssets: [],
      smallAssets: [],
      accountBreakdown: [line('消耗品費', 'アマゾンジャパン合同会社', 41080)],
      accountBreakdownDetail: [],
      businessOverview: [line('事業', '福祉輸送')],
      consumptionTax: [line('課税売上', '', 900_000)],
      auxiliaryDataLines: [],
      inputStatus: {
        requiredCount: 0,
        naCount: 0,
        reviewCount: 0,
        plannedCount: 0,
        totalCount: 0,
        checkItems: [],
        actionRequiredItems: [],
      },
      checkItems: [
        {
          id: 'c1',
          label: '申告前チェック',
          status: 'ok',
          category: '確認',
          detail: '￥41,080 / ①②③',
        },
      ],
      actionRequiredItems: [],
      missingItems: [],
    },
    fiscalYearExpenses: [],
    fiscalYearReceipts: [],
    unorganizedReceipts: [],
    fixedCostRows: [],
    ledgerAssets: [
      {
        id: 'a1',
        purchaseDate: '2024-04-01',
        useStartDate: '2024-04-01',
        assetName: '車両ちばケアタクシー',
        assetCategory: '車両',
        condition: '普通',
        firstRegistrationYearMonth: '2024-04',
        acquisitionCost: 3_000_000,
        standardUsefulLifeYears: 6,
        appliedUsefulLifeYears: 6,
        monthlyDepreciationYen: 41_666,
        depreciationStartYearMonth: '2024-04',
        depreciationEndYearMonth: '2030-03',
        remainingBookValue: 2_500_000,
        status: 'active',
        notes: '',
      },
    ],
    smallAssets: [],
    depreciationRows: Array.from({ length: 24 }, (_, i) => ({
      targetYearMonth: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
      assetName: '車両A',
      assetCategory: '車両',
      acquisitionCost: 3_000_000,
      monthlyDepreciationYen: 41_666,
      depreciationYen: 41_666,
      cumulativeDepreciationYen: 41_666 * (i + 1),
      remainingBookValue: 3_000_000 - 41_666 * (i + 1),
      plExpenseCategory: '減価償却費',
    })),
    reviewItems: [
      {
        id: 'r1',
        category: '確認',
        label: '申告前チェック',
        detail: '損益計算書 / 貸借対照表 / 固定資産台帳 / 減価償却明細',
      },
    ],
    dataSources: [],
    fiscalYearEndYearMonth: '2027-03',
    pl: emptyPl(),
  }) as unknown as TaxAdvisorPackage
