import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import type { StoredAccountingFixedAsset } from '../types/accountingFixedAssets'
import type { StoredAccountingReceipt } from '../services/accountingReceipts'
import type { StoredCaseRecord } from '../services/caseRecords'
import { COMPANY_FISCAL_POLICY } from '../constants/companyFiscalPolicy'
import { getCompanyFiscalPeriod } from './accountingFiscalPeriod'
import { summarizeFilingChecks } from './accountingFilingCheck'
import { assignSubmissionTemporaryNumbers } from './accountingSubmissionNumbers'
import {
  buildAccountingSubmissionPackage,
  buildMissingVoucherCsv,
  buildSubmissionCatalogCsv,
  buildUnlinkedVoucherCsv,
  escapeSpreadsheetFormula,
  toInternalSubmissionManifest,
  toPublicSubmissionManifest,
} from './accountingSubmissionPackage'

const fiscalPeriod = getCompanyFiscalPeriod(COMPANY_FISCAL_POLICY, 2026)!

const readyFiling = summarizeFilingChecks([])

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

const makeAsset = (
  overrides: Partial<StoredAccountingFixedAsset> & { id: string },
): StoredAccountingFixedAsset =>
  ({
    franchiseeId: 'f1',
    storeId: 's1',
    assetKind: 'fixed',
    purchaseDate: '2026-08-01',
    useStartDate: '2026-08-01',
    assetCategory: '車両',
    assetName: '福祉車両A',
    condition: '中古',
    acquisitionCost: 1_200_000,
    standardUsefulLifeYears: 4,
    appliedUsefulLifeYears: 4,
    monthlyDepreciationYen: 25_000,
    depreciationStartYearMonth: '2026-08',
    depreciationEndYearMonth: '2030-07',
    remainingBookValue: 1_000_000,
    status: 'active',
    ...overrides,
  }) as StoredAccountingFixedAsset

const makeCase = (
  overrides: Partial<StoredCaseRecord> & { id: string },
): StoredCaseRecord =>
  ({
    id: overrides.id,
    caseDate: '2026-09-01',
    totalFareYen: 3500,
    actualFareYen: 3500,
    ...overrides,
  }) as StoredCaseRecord

const assertNoSecrets = (text: string, secretTokens: string[]) => {
  for (const token of secretTokens) {
    expect(text.includes(token)).toBe(false)
  }
  expect(text).not.toMatch(/https?:\/\//i)
  expect(text).not.toMatch(/gs:\/\//i)
  expect(text).not.toMatch(/receipts\//)
}

describe('assignSubmissionTemporaryNumbers', () => {
  it('assigns stable EXP/RCP/AST/SAL regardless of input order', () => {
    const expenses = [
      makeExpense({ id: 'e-b', postingDate: '2026-09-01', vendorName: 'B店', taxIncludedAmount: 200 }),
      makeExpense({ id: 'e-a', postingDate: '2026-08-01', vendorName: 'A店', taxIncludedAmount: 100 }),
      makeExpense({ id: 'e-c', postingDate: '2026-08-01', vendorName: 'A店', taxIncludedAmount: 100 }),
    ]
    const receipts = [
      makeReceipt({ id: 'r-b', receiptDate: '2026-09-02', vendorNameCandidate: 'B', amountTotalCandidate: 2 }),
      makeReceipt({ id: 'r-a', receiptDate: '2026-08-02', vendorNameCandidate: 'A', amountTotalCandidate: 1 }),
    ]
    const assets = [
      makeAsset({ id: 'a-b', purchaseDate: '2026-09-01', assetName: 'B', acquisitionCost: 2 }),
      makeAsset({ id: 'a-a', purchaseDate: '2026-08-01', assetName: 'A', acquisitionCost: 1 }),
    ]
    const sales = [
      makeCase({ id: 's-b', caseDate: '2026-09-10', totalFareYen: 2000 }),
      makeCase({ id: 's-a', caseDate: '2026-08-10', totalFareYen: 1000 }),
    ]

    const forward = assignSubmissionTemporaryNumbers({
      fiscalPeriod,
      expenses,
      receipts,
      fixedAssets: assets,
      caseRecords: sales,
    })
    const reversed = assignSubmissionTemporaryNumbers({
      fiscalPeriod,
      expenses: [...expenses].reverse(),
      receipts: [...receipts].reverse(),
      fixedAssets: [...assets].reverse(),
      caseRecords: [...sales].reverse(),
    })

    expect(forward).toEqual(reversed)
    expect(forward.expenses['e-a']).toBe('EXP-000001')
    expect(forward.expenses['e-c']).toBe('EXP-000002')
    expect(forward.expenses['e-b']).toBe('EXP-000003')
    expect(forward.receipts['r-a']).toBe('RCP-000001')
    expect(forward.receipts['r-b']).toBe('RCP-000002')
    expect(forward.fixedAssets['a-a']).toBe('AST-000001')
    expect(forward.fixedAssets['a-b']).toBe('AST-000002')
    expect(forward.sales['s-a']).toBe('SAL-000001')
    expect(forward.sales['s-b']).toBe('SAL-000002')
  })

  it('skips deleted expenses and non-fixed assets', () => {
    const maps = assignSubmissionTemporaryNumbers({
      fiscalPeriod,
      expenses: [
        makeExpense({ id: 'e1', isDeleted: true }),
        makeExpense({ id: 'e2' }),
      ],
      receipts: [],
      fixedAssets: [
        makeAsset({ id: 'small1', assetKind: 'small' }),
        makeAsset({ id: 'fixed1' }),
        makeAsset({ id: 'fixed2', isDeleted: true }),
      ],
    })
    expect(Object.keys(maps.expenses)).toEqual(['e2'])
    expect(Object.keys(maps.fixedAssets)).toEqual(['fixed1'])
  })
})

describe('buildAccountingSubmissionPackage', () => {
  it('returns blocking empty package when fiscal period is unavailable', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod: null,
      expenses: [],
      receipts: [],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2020,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.items).toEqual([])
    expect(pkg.summary.canGenerateZip).toBe(false)
    expect(pkg.summary.isSubmissionReady).toBe(false)
    expect(pkg.issues.some((issue) => issue.code === 'period.unavailable')).toBe(true)
  })

  it('marks submission not ready when filing has auxiliary load blocking', () => {
    const blockedFiling = summarizeFilingChecks([
      {
        id: 'system.settlementAuxiliaryLoad',
        category: 'system',
        label: '決算補助データの取得',
        status: 'blocking',
        summary: '決算補助データの取得に失敗したため、提出準備を完了扱いにできません',
        detail: 'accountingSettlementAuxiliary: Missing or insufficient permissions.',
      },
    ])
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [],
      receipts: [],
      fixedAssets: [],
      filingSummary: blockedFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.summary.isSubmissionReady).toBe(false)
    expect(pkg.summary.filingBlockingCount).toBe(1)
    expect(pkg.summary.canGenerateZip).toBe(true)
  })

  it('builds planned report tree and available catalog CSVs', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [],
      receipts: [],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
      companyName: '株式会社千葉福祉サポート',
    })
    const paths = pkg.items.map((item) => item.relativePath)
    expect(paths).toContain('00_資料一覧.csv')
    expect(paths).toContain('01_決算サマリー.pdf')
    expect(paths).toContain('05_経費一覧.csv')
    expect(paths).toContain('12_不足証憑一覧.csv')
    expect(pkg.items.find((item) => item.relativePath === '00_資料一覧.csv')?.availability).toBe(
      'available',
    )
    expect(pkg.items.find((item) => item.relativePath === '01_決算サマリー.pdf')?.availability).toBe(
      'voucherPendingPhase2B',
    )
  })

  it('links expense↔receipt 1:1 with EXP prefix in file name', () => {
    const receipt = makeReceipt({
      id: 'receipt-1',
      linkedExpenseId: 'expense-1',
      receiptDate: '2026-08-10',
      vendorNameCandidate: '単独店',
      amountTotalCandidate: 3000,
    })
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({
          id: 'expense-1',
          receiptId: 'receipt-1',
          vendorName: '単独店',
          taxIncludedAmount: 3000,
          postingDate: '2026-08-10',
        }),
      ],
      receipts: [receipt],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    const voucher = pkg.items.find(
      (item) => item.type === 'voucher' && item.availability === 'voucherPendingPhase2B',
    )
    expect(voucher?.relativePath).toMatch(/^証憑\/EXP-\d{6}_RCP-\d{6}_/)
    expect(pkg.catalogRows[0]?.voucherFileName).toBe(voucher?.relativePath.split('/').pop())
  })

  it('shared receipt omits EXP from path and stays stable across expense order', () => {
    const receipt = makeReceipt({
      id: 'receipt-shared',
      linkedExpenseId: 'expense-1',
      receiptDate: '2026-08-10',
      vendorNameCandidate: '共有店',
      amountTotalCandidate: 3000,
    })
    const expenses = [
      makeExpense({
        id: 'expense-1',
        receiptId: 'receipt-shared',
        vendorName: '最初の経費取引先',
        taxIncludedAmount: 1111,
        postingDate: '2026-08-10',
      }),
      makeExpense({
        id: 'expense-2',
        receiptId: 'receipt-shared',
        vendorName: '二番目の経費取引先',
        taxIncludedAmount: 2222,
        postingDate: '2026-08-11',
      }),
    ]

    const build = (order: StoredAccountingExpense[]) =>
      buildAccountingSubmissionPackage({
        fiscalPeriod,
        expenses: order,
        receipts: [receipt],
        fixedAssets: [],
        filingSummary: readyFiling,
        targetYear: 2026,
        createdAt: '2026-07-15T00:00:00.000Z',
      })

    const forward = build(expenses)
    const reversed = build([...expenses].reverse())
    const vouchers = forward.items.filter(
      (item) => item.type === 'voucher' && item.availability === 'voucherPendingPhase2B',
    )
    expect(vouchers).toHaveLength(1)
    const path = vouchers[0].relativePath
    expect(path.startsWith('証憑/')).toBe(true)
    expect(path).toMatch(/^証憑\/RCP-\d{6}_/)
    expect(path).not.toContain('EXP-')
    expect(path).toContain('共有店')
    expect(path).toContain('3000')
    expect(path).not.toContain('1111')
    expect(path).not.toContain('最初の経費')

    expect(reversed.items.find((item) => item.type === 'voucher')?.relativePath).toBe(path)

    const receiptNo = forward.temporaryNumbers.receipts['receipt-shared']
    expect(forward.catalogRows.map((row) => row.receiptNo)).toEqual([receiptNo, receiptNo])
    expect(forward.catalogRows.map((row) => row.voucherFileName)).toEqual([
      path.split('/').pop(),
      path.split('/').pop(),
    ])

    const pub = toPublicSubmissionManifest(forward)
    const internal = toInternalSubmissionManifest(forward)
    expect(pub.items.find((item) => item.relativePath === path)).toBeTruthy()
    expect(internal.items.find((item) => item.relativePath === path)).toBeTruthy()
    expect(forward.summary.linkedVoucherCount).toBe(1)
  })

  it('marks missing original as dataMissing and counts missing vouchers', () => {
    const receipt = makeReceipt({
      id: 'receipt-no-file',
      linkedExpenseId: 'expense-1',
      storagePath: '',
      downloadUrl: '',
      originalStoragePath: '',
      originalDownloadUrl: '',
      ocrImageStoragePath: '',
      ocrImageDownloadUrl: '',
    })
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [makeExpense({ id: 'expense-1', receiptId: 'receipt-no-file' })],
      receipts: [receipt],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.summary.missingVoucherCount).toBeGreaterThan(0)
    expect(pkg.summary.canGenerateZip).toBe(true)
    expect(pkg.summary.isSubmissionReady).toBe(false)
    expect(pkg.issues.some((issue) => issue.code === 'voucher.missingOriginal')).toBe(true)
    expect(pkg.items.some((item) => item.availability === 'dataMissing')).toBe(true)
  })

  it('places unlinked receipts under 証憑/未紐付け and emits unlinked list', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [],
      receipts: [
        makeReceipt({
          id: 'orphan-1',
          status: 'unorganized',
          linkedExpenseId: undefined,
          receiptDate: '2026-08-20',
          vendorNameCandidate: '未紐付',
        }),
      ],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.items.some((item) => item.relativePath === '未紐付け一覧.csv')).toBe(true)
    const unlinked = pkg.items.filter((item) => item.type === 'unlinkedVoucher')
    expect(unlinked.length).toBe(1)
    expect(unlinked[0].relativePath.startsWith('証憑/未紐付け/')).toBe(true)
    expect(pkg.summary.unlinkedVoucherCount).toBe(1)
  })

  it('detects link mismatch between expense.receiptId and receipt.linkedExpenseId', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({ id: 'expense-1', receiptId: 'receipt-1' }),
        makeExpense({ id: 'expense-2', receiptId: undefined }),
      ],
      receipts: [
        makeReceipt({
          id: 'receipt-1',
          linkedExpenseId: 'expense-2',
        }),
      ],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.issues.some((issue) => issue.code === 'receipts.linkMismatch')).toBe(true)
  })

  it('treats receipt→expense one-way link as linked (not mismatch)', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [makeExpense({ id: 'expense-1', receiptId: undefined })],
      receipts: [
        makeReceipt({
          id: 'receipt-1',
          linkedExpenseId: 'expense-1',
          vendorNameCandidate: '一方向店',
        }),
      ],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.issues.some((issue) => issue.code === 'receipts.linkMismatch')).toBe(false)
    expect(pkg.summary.linkedVoucherCount).toBe(1)
    expect(pkg.catalogRows[0]?.receiptNo).toBe(pkg.temporaryNumbers.receipts['receipt-1'])
    expect(pkg.catalogRows[0]?.note).toContain('一方向')
  })

  it('flags expenses without voucher link as missing', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({
          id: 'expense-no-voucher',
          receiptId: undefined,
          taxCategory: 'non_taxable',
          taxRate: 0,
          consumptionTaxAmount: 0,
        }),
      ],
      receipts: [],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    expect(pkg.summary.missingVoucherCount).toBeGreaterThan(0)
    expect(pkg.catalogRows[0]?.receiptNo).toBe('')
    expect(pkg.catalogRows[0]?.hasOriginal).toBe('いいえ')
    expect(pkg.missingVoucherRows[0]?.missingReason).toBe('証憑紐付けなし')
    expect(pkg.summary.canGenerateZip).toBe(true)
    expect(pkg.summary.isSubmissionReady).toBe(false)
  })

  it('is deterministic for numbers/paths ignoring createdAt', () => {
    const expenses = [
      makeExpense({ id: 'e2', postingDate: '2026-09-01', receiptId: 'r1', taxIncludedAmount: 2000 }),
      makeExpense({ id: 'e1', postingDate: '2026-08-01', receiptId: 'r2', taxIncludedAmount: 1000 }),
    ]
    const receipts = [
      makeReceipt({ id: 'r1', linkedExpenseId: 'e2', receiptDate: '2026-09-01' }),
      makeReceipt({ id: 'r2', linkedExpenseId: 'e1', receiptDate: '2026-08-01' }),
    ]
    const a = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses,
      receipts,
      fixedAssets: [makeAsset({ id: 'a1' })],
      caseRecords: [makeCase({ id: 's1' })],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const b = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [...expenses].reverse(),
      receipts: [...receipts].reverse(),
      fixedAssets: [makeAsset({ id: 'a1' })],
      caseRecords: [makeCase({ id: 's1' })],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-12-31T23:59:59.000Z',
    })

    expect(a.temporaryNumbers).toEqual(b.temporaryNumbers)
    expect(a.items.map((item) => item.relativePath)).toEqual(b.items.map((item) => item.relativePath))
    expect(a.summary.expenseCount).toBe(b.summary.expenseCount)
    expect(a.createdAt).not.toBe(b.createdAt)
  })

  it('includes receipts linked to period expenses even if receipt date is outside months', () => {
    const maps = assignSubmissionTemporaryNumbers({
      fiscalPeriod,
      expenses: [makeExpense({ id: 'e1', receiptId: 'r-out', postingDate: '2026-08-15' })],
      receipts: [
        makeReceipt({
          id: 'r-out',
          receiptDate: '2025-01-01',
          createdAt: '2025-01-01T00:00:00.000Z',
          linkedExpenseId: 'e1',
        }),
      ],
      fixedAssets: [],
    })
    expect(maps.receipts['r-out']).toBe('RCP-000001')
  })
})

describe('submission CSV / manifests', () => {
  const secretExpenseId = 'firestore-expense-secret-xyz'
  const secretReceiptId = 'firestore-receipt-secret-xyz'
  const storagePath = 'tenants/f1/receipts/secret-file.jpg'

  const buildLinkedPackage = () =>
    buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({
          id: secretExpenseId,
          receiptId: secretReceiptId,
          vendorName: '公開店名',
        }),
      ],
      receipts: [
        makeReceipt({
          id: secretReceiptId,
          linkedExpenseId: secretExpenseId,
          originalStoragePath: storagePath,
          downloadUrl: 'https://firebasestorage.googleapis.com/secret',
          vendorNameCandidate: '公開店名',
        }),
      ],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
      sourceFingerprint: 'fp-test',
    })

  it('public CSVs use BOM/CRLF and exclude Firestore ids / storage / URLs', () => {
    const pkg = buildLinkedPackage()
    const catalog = buildSubmissionCatalogCsv(pkg)
    const missing = buildMissingVoucherCsv(pkg)
    const unlinked = buildUnlinkedVoucherCsv(pkg)

    for (const csv of [catalog, missing, unlinked]) {
      expect(csv.startsWith('\uFEFF')).toBe(true)
      expect(csv).toContain('\r\n')
      assertNoSecrets(csv, [secretExpenseId, secretReceiptId, storagePath])
    }

    expect(catalog).toContain('経費番号')
    expect(catalog).toContain('証憑番号')
    expect(catalog).toContain('証憑ファイル')
    expect(catalog).toContain('公開店名')
    expect(catalog).toMatch(/EXP-\d{6}/)
    expect(catalog).toMatch(/RCP-\d{6}/)
    expect(missing).toContain('不足理由')
  })

  it('escapes spreadsheet formula prefixes in public CSV text cells', () => {
    expect(escapeSpreadsheetFormula('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(escapeSpreadsheetFormula('+1+1')).toBe("'+1+1")
    expect(escapeSpreadsheetFormula('-2+3')).toBe("'-2+3")
    expect(escapeSpreadsheetFormula('@IMPORT')).toBe("'@IMPORT")
    expect(escapeSpreadsheetFormula('  =1+1')).toBe("'  =1+1")
    expect(escapeSpreadsheetFormula('普通の取引先')).toBe('普通の取引先')

    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({
          id: 'e-formula',
          vendorName: '=SUM(A1:A2)',
          description: '+危険な内容',
          expenseCategory: '@科目',
          receiptId: undefined,
          normalExpenseOverrideConfirmed: true,
          normalExpenseOverrideReason: '-例外理由',
        }),
      ],
      receipts: [],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    const catalog = buildSubmissionCatalogCsv(pkg)
    const missing = buildMissingVoucherCsv(pkg)
    expect(catalog.startsWith('\uFEFF')).toBe(true)
    expect(catalog).toContain('\r\n')
    expect(catalog).toContain("'=SUM(A1:A2)")
    expect(catalog).toContain("'+危険な内容")
    expect(catalog).toContain("'@科目")
    expect(missing).toContain("'-例外理由")
  })

  it('public catalog zeros consumption tax for non-taxable expenses', () => {
    const pkg = buildAccountingSubmissionPackage({
      fiscalPeriod,
      expenses: [
        makeExpense({
          id: 'e-nt',
          taxCategory: 'non_taxable',
          taxRate: 10,
          consumptionTaxAmount: 999,
          receiptId: undefined,
        }),
      ],
      receipts: [],
      fixedAssets: [],
      filingSummary: readyFiling,
      targetYear: 2026,
      createdAt: '2026-07-15T00:00:00.000Z',
    })
    const catalog = buildSubmissionCatalogCsv(pkg)
    expect(catalog).toContain('非課税')
    const dataLine = catalog.split('\r\n').find((line) => line.includes('EXP-'))
    expect(dataLine).toBeTruthy()
    // 税率・消費税額は非課税時 0
    expect(dataLine).toMatch(/,非課税,0,0,/)
  })

  it('public manifest omits storage paths and source ids; internal keeps them', () => {
    const pkg = buildLinkedPackage()
    const pub = toPublicSubmissionManifest(pkg)
    const internal = toInternalSubmissionManifest(pkg)
    const pubJson = JSON.stringify(pub)
    const internalJson = JSON.stringify(internal)

    assertNoSecrets(pubJson, [secretExpenseId, secretReceiptId, storagePath])
    expect(internalJson).toContain(secretReceiptId)
    expect(internalJson).toContain(storagePath)
    expect(internal.voucherRefs.length).toBeGreaterThan(0)
  })
})
