import { describe, expect, it } from 'vitest'
import type { StoredAccountingExpense } from '../types/accounting'
import { buildExpensesCsv } from './accountingCsv'
import {
  DEFAULT_EXPENSE_LIST_FILTERS,
  describeExpenseListFilters,
  normalizeExpenseSearchText,
  queryExpenseList,
  selectExpensesForFilteredCsv,
  type ExpenseListFilters,
} from './accountingExpenseListQuery'

const expense = (overrides: Partial<StoredAccountingExpense>): StoredAccountingExpense => ({
  id: 'e1',
  franchiseeId: 'f1',
  companyId: 'f1',
  storeId: 's1',
  transactionDate: '2026-07-10',
  postingDate: '2026-07-10',
  vendorName: 'アマゾンジャパン合同会社',
  description: 'コピー用紙A4',
  expenseCategory: '消耗品費',
  taxIncludedAmount: 1100,
  taxRate: 10,
  consumptionTaxAmount: 100,
  paymentMethod: '現金',
  confirmationStatus: '確認済み',
  plTreatment: 'expense',
  billingInvoiceNumber: 'INV-001',
  memo: '事務用品メモ',
  createdBy: 'u1',
  createdByName: 'user',
  updatedBy: 'u1',
  updatedByName: 'user',
  createdAt: '2026-07-10T10:00:00.000Z',
  updatedAt: '2026-07-11T10:00:00.000Z',
  ...overrides,
})

const sampleExpenses: StoredAccountingExpense[] = [
  expense({
    id: 'e1',
    vendorName: 'アマゾンジャパン合同会社',
    description: 'コピー用紙A4',
    billingInvoiceNumber: 'INV-001',
    memo: '事務用品メモ',
    taxIncludedAmount: 1100,
    postingDate: '2026-07-05',
    transactionDate: '2026-07-05',
    expenseCategory: '消耗品費',
    confirmationStatus: '確認済み',
    paymentMethod: '現金',
    invoiceStatus: 'verified',
    invoiceNumber: 'T3040001028447',
    receiptId: 'r1',
    createdAt: '2026-07-05T09:00:00.000Z',
    updatedAt: '2026-07-06T09:00:00.000Z',
  }),
  expense({
    id: 'e2',
    vendorName: 'ＥＮＥＯＳ',
    description: 'ガソリン代',
    billingInvoiceNumber: 'ＢＩＬＬ－９９',
    memo: 'ＭＥＭＯ－Ａ',
    taxIncludedAmount: 5500,
    postingDate: '2026-07-15',
    transactionDate: '2026-07-15',
    expenseCategory: '燃料費',
    confirmationStatus: '未確認',
    paymentMethod: 'クレジットカード',
    invoiceStatus: 'none',
    invoiceNumber: '',
    receiptId: '',
    createdAt: '2026-07-15T09:00:00.000Z',
    updatedAt: '2026-07-16T09:00:00.000Z',
  }),
  expense({
    id: 'e3',
    vendorName: '山田自動車',
    description: '車検費用',
    billingInvoiceNumber: 'INV-XYZ',
    memo: '定期点検',
    taxIncludedAmount: 88000,
    postingDate: '2026-07-20',
    transactionDate: '2026-07-20',
    expenseCategory: '車両修繕費',
    confirmationStatus: '確認済み',
    paymentMethod: '銀行振込',
    invoiceStatus: 'verified',
    invoiceNumber: 'T1234567890123',
    receiptFileStoragePath: 'path/to/file.pdf',
    createdAt: '2026-07-20T09:00:00.000Z',
    updatedAt: '2026-07-21T09:00:00.000Z',
  }),
  expense({
    id: 'e4',
    vendorName: '削除済み商店',
    description: '削除対象',
    taxIncludedAmount: 2200,
    postingDate: '2026-07-08',
    transactionDate: '2026-07-08',
    confirmationStatus: '確認済み',
    isDeleted: true,
    createdAt: '2026-07-08T09:00:00.000Z',
    updatedAt: '2026-07-09T09:00:00.000Z',
  }),
  expense({
    id: 'e5',
    vendorName: '先月の経費',
    description: '対象外月',
    taxIncludedAmount: 999,
    postingDate: '2026-06-30',
    transactionDate: '2026-06-30',
    confirmationStatus: '確認済み',
  }),
]

const withFilters = (overrides: Partial<ExpenseListFilters>): ExpenseListFilters => ({
  ...DEFAULT_EXPENSE_LIST_FILTERS,
  ...overrides,
})

describe('normalizeExpenseSearchText', () => {
  it('全角英数字を半角小文字へ正規化する', () => {
    expect(normalizeExpenseSearchText('ＡＢＣ１２３')).toBe('abc123')
    expect(normalizeExpenseSearchText('  Bill-99  ')).toBe('bill-99')
  })
})

describe('queryExpenseList', () => {
  it('支払先を部分一致検索する（全角半角・大小無視）', () => {
    const result = queryExpenseList(sampleExpenses, '2026-07', withFilters({ searchQuery: 'eneos' }))
    expect(result.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('摘要・請求書番号・メモを部分一致検索する', () => {
    expect(
      queryExpenseList(sampleExpenses, '2026-07', withFilters({ searchQuery: 'コピー用紙' })).items.map(
        (row) => row.id,
      ),
    ).toEqual(['e1'])
    expect(
      queryExpenseList(sampleExpenses, '2026-07', withFilters({ searchQuery: 'bill-99' })).items.map(
        (row) => row.id,
      ),
    ).toEqual(['e2'])
    expect(
      queryExpenseList(sampleExpenses, '2026-07', withFilters({ searchQuery: 'memo-a' })).items.map(
        (row) => row.id,
      ),
    ).toEqual(['e2'])
  })

  it('金額を部分一致検索する', () => {
    const result = queryExpenseList(sampleExpenses, '2026-07', withFilters({ searchQuery: '88000' }))
    expect(result.items.map((row) => row.id)).toEqual(['e3'])
  })

  it('支払日の日付範囲で絞り込む', () => {
    const result = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ paymentDateFrom: '2026-07-10', paymentDateTo: '2026-07-18' }),
    )
    expect(result.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('勘定科目で絞り込む', () => {
    const result = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ expenseCategory: '燃料費' }),
    )
    expect(result.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('金額範囲で絞り込む', () => {
    const result = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ amountMin: '2000', amountMax: '10000' }),
    )
    expect(result.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('確認状態で絞り込む', () => {
    const confirmed = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ confirmationStatus: '確認済み' }),
    )
    expect(confirmed.items.map((row) => row.id).sort()).toEqual(['e1', 'e3'])

    const unconfirmed = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ confirmationStatus: '未確認' }),
    )
    expect(unconfirmed.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('証憑有無で絞り込む', () => {
    const withReceipt = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ hasReceipt: 'yes' }),
    )
    expect(withReceipt.items.map((row) => row.id).sort()).toEqual(['e1', 'e3'])

    const withoutReceipt = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ hasReceipt: 'no' }),
    )
    expect(withoutReceipt.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('インボイス登録有無で絞り込む', () => {
    const registered = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ hasInvoiceRegistration: 'yes' }),
    )
    expect(registered.items.map((row) => row.id).sort()).toEqual(['e1', 'e3'])

    const unregistered = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ hasInvoiceRegistration: 'no' }),
    )
    expect(unregistered.items.map((row) => row.id)).toEqual(['e2'])
  })

  it('支払方法で絞り込む', () => {
    const result = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ paymentMethod: '銀行振込' }),
    )
    expect(result.items.map((row) => row.id)).toEqual(['e3'])
  })

  it('複数条件を組み合わせて絞り込む', () => {
    const result = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({
        confirmationStatus: '確認済み',
        hasReceipt: 'yes',
        amountMin: '1000',
        amountMax: '2000',
        expenseCategory: '消耗品費',
      }),
    )
    expect(result.items.map((row) => row.id)).toEqual(['e1'])
  })

  it('並び替え（支払日・金額・登録日時・更新日時）ができる', () => {
    const byDateAsc = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ sortKey: 'paymentDate', sortDirection: 'asc' }),
    )
    expect(byDateAsc.items.map((row) => row.id)).toEqual(['e1', 'e2', 'e3'])

    const byAmountDesc = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ sortKey: 'amount', sortDirection: 'desc' }),
    )
    expect(byAmountDesc.items.map((row) => row.id)).toEqual(['e3', 'e2', 'e1'])

    const byCreatedAsc = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ sortKey: 'createdAt', sortDirection: 'asc' }),
    )
    expect(byCreatedAsc.items.map((row) => row.id)).toEqual(['e1', 'e2', 'e3'])

    const byUpdatedDesc = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ sortKey: 'updatedAt', sortDirection: 'desc' }),
    )
    expect(byUpdatedDesc.items.map((row) => row.id)).toEqual(['e3', 'e2', 'e1'])
  })

  it('条件クリア後は初期一覧（削除除外・取得順）に戻る', () => {
    const filtered = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ searchQuery: 'アマゾン', sortKey: 'amount', sortDirection: 'asc' }),
    )
    expect(filtered.items).toHaveLength(1)

    const cleared = queryExpenseList(sampleExpenses, '2026-07', DEFAULT_EXPENSE_LIST_FILTERS)
    expect(cleared.items.map((row) => row.id)).toEqual(['e1', 'e2', 'e3'])
    expect(cleared.isFiltered).toBe(false)
    expect(cleared.activeConditionLabels).toEqual([])
  })

  it('削除済みは通常除外され、含む指定時のみ表示される', () => {
    const normal = queryExpenseList(sampleExpenses, '2026-07', DEFAULT_EXPENSE_LIST_FILTERS)
    expect(normal.items.map((row) => row.id)).not.toContain('e4')

    const withDeleted = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ includeDeleted: true }),
    )
    expect(withDeleted.items.map((row) => row.id)).toContain('e4')
  })

  it('結果件数と税込合計金額を返す', () => {
    const result = queryExpenseList(sampleExpenses, '2026-07', DEFAULT_EXPENSE_LIST_FILTERS)
    expect(result.totalCount).toBe(3)
    expect(result.totalTaxIncludedAmount).toBe(1100 + 5500 + 88000)
    expect(describeExpenseListFilters(DEFAULT_EXPENSE_LIST_FILTERS)).toEqual([])
  })

  it('本番想定の26件・136,578円を維持できる（フィクスチャ集計）', () => {
    const productionLike = Array.from({ length: 26 }, (_, index) => {
      const baseAmount = index === 0 ? 136_578 - 25 * 1_000 : 1_000
      return expense({
        id: `prod-${index}`,
        postingDate: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
        transactionDate: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
        taxIncludedAmount: baseAmount,
        confirmationStatus: '確認済み',
      })
    })
    const result = queryExpenseList(productionLike, '2026-07', DEFAULT_EXPENSE_LIST_FILTERS)
    expect(result.totalCount).toBe(26)
    expect(result.totalTaxIncludedAmount).toBe(136_578)
  })

  it('絞り込み後も証憑添付判定が維持される', () => {
    const result = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ hasReceipt: 'yes', searchQuery: 'アマゾン' }),
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.receiptId).toBe('r1')
  })
})

describe('expense list mobile filter UI contract', () => {
  it('折りたたみ式フィルター向けのCSSクラスが定義されている', async () => {
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../pages/AccountingPage.css', import.meta.url), 'utf8'),
    )
    expect(css).toContain('.accounting-expense-filter-panel')
    expect(css).toContain('.accounting-expense-filter-toggle')
    expect(css).toContain('min-height: 2.75rem')
    expect(css).toContain('@media (min-width: 768px)')
  })
})

describe('expense list CSV scope', () => {
  it('絞り込み結果CSVは確認済み・未削除のみを既存列で出力する', () => {
    const filtered = queryExpenseList(
      sampleExpenses,
      '2026-07',
      withFilters({ hasReceipt: 'yes' }),
    )
    const csvRows = selectExpensesForFilteredCsv(filtered.items)
    expect(csvRows.map((row) => row.id).sort()).toEqual(['e1', 'e3'])

    const csv = buildExpensesCsv(csvRows, '2026-07')
    expect(csv).toContain('日付')
    expect(csv).toContain('取引先')
    expect(csv).toContain('金額(円)')
    expect(csv).toContain('税率(%)')
    expect(csv).toContain('税額(円)')
    expect(csv).toContain('アマゾンジャパン合同会社')
    expect(csv).toContain('1100')
    expect(csv).toContain('100')
    expect(csv).not.toContain('ＥＮＥＯＳ')
  })

  it('全件CSVは確認済み・未削除の当月全件を既存列で出力する', () => {
    const allVisible = queryExpenseList(sampleExpenses, '2026-07', DEFAULT_EXPENSE_LIST_FILTERS)
    const csvRows = selectExpensesForFilteredCsv(allVisible.items)
    expect(csvRows.map((row) => row.id).sort()).toEqual(['e1', 'e3'])

    const csv = buildExpensesCsv(csvRows, '2026-07')
    expect(csv).toContain('インボイス番号')
    expect(csv).toContain('領収書画像有無')
    expect(csv).toContain('PL反映区分')
    expect(csv).toContain('山田自動車')
    expect(csv).toContain('88000')
  })
})
