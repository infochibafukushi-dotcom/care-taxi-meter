import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_EXPORT_SCHEMA_VERSION,
  formatAccountingExportTypeLabel,
} from '../types/accountingExportHistory'
import {
  buildAccountingExportSourceFingerprint,
  buildETaxExportFingerprintInput,
  canonicalizeForFingerprint,
} from './accountingExportFingerprint'
import { buildReadinessSnapshot, summarizeFilingChecks } from './accountingFilingCheck'
import type { FilingCheckItem } from '../types/accountingFilingCheck'
import { shortFingerprint } from './accountingExportHistory'

describe('canonicalizeForFingerprint', () => {
  it('sorts object keys and drops undefined', () => {
    expect(canonicalizeForFingerprint({ b: 2, a: 1, c: undefined })).toEqual({ a: 1, b: 2 })
  })

  it('sorts arrays of {id} by id regardless of input order', () => {
    const a = canonicalizeForFingerprint([
      { id: 'z', amount: 1 },
      { id: 'a', amount: 2 },
    ])
    const b = canonicalizeForFingerprint([
      { id: 'a', amount: 2 },
      { id: 'z', amount: 1 },
    ])
    expect(a).toEqual(b)
  })

  it('drops URL-like keys', () => {
    expect(
      canonicalizeForFingerprint({
        id: '1',
        downloadUrl: 'https://example.com/a',
        storagePath: 'path/to/file',
        imageUrl: 'https://example.com/img',
        url: 'https://example.com',
        amount: 100,
      }),
    ).toEqual({ amount: 100, id: '1' })
  })

  it('normalizes Timestamp-like objects and ISO strings to the same instant', () => {
    const iso = '2026-03-15T12:00:00.000Z'
    const ms = Date.parse(iso)
    const seconds = Math.floor(ms / 1000)
    const nanoseconds = (ms % 1000) * 1e6

    const fromIso = canonicalizeForFingerprint({ updatedAt: iso })
    const fromSeconds = canonicalizeForFingerprint({
      updatedAt: { seconds, nanoseconds },
    })
    const fromToDate = canonicalizeForFingerprint({
      updatedAt: { toDate: () => new Date(iso) },
    })

    expect(fromIso).toEqual(fromSeconds)
    expect(fromIso).toEqual(fromToDate)
    expect(fromIso).toEqual({ updatedAt: iso })
  })
})

describe('buildAccountingExportSourceFingerprint', () => {
  const baseParams = {
    fiscalPeriod: {
      fiscalYear: 2026,
      startDate: '2026-07-07',
      endDate: '2027-03-31',
      startYearMonth: '2026-07',
      endYearMonth: '2027-03',
      isShortFiscalYear: true,
      monthCount: 9,
      label: '2026年度',
    },
    exportType: 'etax-pdf',
    exportSchemaVersion: ACCOUNTING_EXPORT_SCHEMA_VERSION,
    expenses: [
      {
        id: 'e2',
        updatedAt: '2026-01-02',
        taxIncludedAmount: 1100,
        taxRate: 10,
        taxCategory: '課税',
        confirmationStatus: '確認済み',
        expenseCategory: '消耗品費',
        postingDate: '2026-08-01',
      },
      {
        id: 'e1',
        updatedAt: '2026-01-01',
        taxIncludedAmount: 2200,
        taxRate: 10,
        taxCategory: '課税',
        confirmationStatus: '確認済み',
        expenseCategory: '燃料費',
        postingDate: '2026-08-02',
      },
    ],
    receipts: [
      {
        id: 'r1',
        updatedAt: '2026-01-01',
        status: 'confirmed',
        linkedExpenseId: 'e1',
        downloadUrl: 'https://example.com/r1',
        storagePath: 'receipts/r1',
      },
    ],
    fixedCosts: [
      {
        id: 'fc1',
        updatedAt: '2026-01-01',
        monthlyAmountYen: 50000,
        annualAmountYen: 600000,
        status: 'active',
        confirmationStatus: '確認済み',
        expenseCategory: '地代家賃',
        startYearMonth: '2026-07',
      },
    ],
    adjustments: [
      {
        id: 'adj1',
        updatedAt: '2026-01-01',
        amountYen: 3000,
        confirmationStatus: '確認済み',
        targetYearMonth: '2026-08',
      },
    ],
    caseRecords: [
      {
        id: 'c1',
        updatedAt: '2026-08-01T00:00:00.000Z',
        totalFareYen: 4500,
        salesCategoryAmounts: { 運賃収入: 4000, 介助料収入: 500 },
      },
    ],
    company: {
      name: '株式会社テスト',
      corporateName: '株式会社テスト',
      invoiceNumber: 'T1234567890123',
      address: '東京都',
      representativeName: '山田太郎',
    },
  }

  it('is stable for same data regardless of array order', async () => {
    const payloadA = buildETaxExportFingerprintInput(baseParams)
    const payloadB = buildETaxExportFingerprintInput({
      ...baseParams,
      expenses: [...baseParams.expenses].reverse(),
    })
    const hashA = await buildAccountingExportSourceFingerprint(payloadA)
    const hashB = await buildAccountingExportSourceFingerprint(payloadB)
    expect(hashA).toBe(hashB)
    expect(hashA).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when expense amount changes', async () => {
    const base = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput(baseParams),
    )
    const changed = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        expenses: [
          { ...baseParams.expenses[0], taxIncludedAmount: 9999 },
          baseParams.expenses[1],
        ],
      }),
    )
    expect(changed).not.toBe(base)
  })

  it('changes when caseRecord / sales amount changes', async () => {
    const base = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput(baseParams),
    )
    const changed = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        caseRecords: [{ ...baseParams.caseRecords[0], totalFareYen: 9999 }],
      }),
    )
    expect(changed).not.toBe(base)
  })

  it('changes when fixedCost monthlyAmountYen changes', async () => {
    const base = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput(baseParams),
    )
    const changed = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        fixedCosts: [{ ...baseParams.fixedCosts[0], monthlyAmountYen: 99999 }],
      }),
    )
    expect(changed).not.toBe(base)
  })

  it('changes when adjustment amountYen changes', async () => {
    const base = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput(baseParams),
    )
    const changed = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        adjustments: [{ ...baseParams.adjustments[0], amountYen: 9999 }],
      }),
    )
    expect(changed).not.toBe(base)
  })

  it('same Timestamp object vs ISO string yields same fingerprint when both normalize', async () => {
    const iso = '2026-08-01T00:00:00.000Z'
    const withIso = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        caseRecords: [{ ...baseParams.caseRecords[0], updatedAt: iso }],
      }),
    )
    const withTimestamp = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        caseRecords: [
          {
            ...baseParams.caseRecords[0],
            updatedAt: { toDate: () => new Date(iso) },
          },
        ],
      }),
    )
    expect(withTimestamp).toBe(withIso)
  })

  it('ignores URL fields on receipts', async () => {
    const withoutUrl = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput({
        ...baseParams,
        receipts: [
          {
            id: 'r1',
            updatedAt: '2026-01-01',
            status: 'confirmed',
            linkedExpenseId: 'e1',
          },
        ],
      }),
    )
    const withUrl = await buildAccountingExportSourceFingerprint(
      buildETaxExportFingerprintInput(baseParams),
    )
    expect(withUrl).toBe(withoutUrl)
  })
})

describe('formatAccountingExportTypeLabel', () => {
  it('labels legacy and Phase 1D types', () => {
    expect(formatAccountingExportTypeLabel('monthly-pl')).toBe('月次PL CSV')
    expect(formatAccountingExportTypeLabel('expenses')).toBe('経費 CSV')
    expect(formatAccountingExportTypeLabel('sales')).toBe('確定売上 CSV')
    expect(formatAccountingExportTypeLabel('yearly-management-pl-csv')).toBe('年次管理会計PL CSV')
    expect(formatAccountingExportTypeLabel('etax-pdf')).toBe('e-Tax PDF')
    expect(formatAccountingExportTypeLabel('etax-csv')).toBe('e-Tax CSV')
    expect(formatAccountingExportTypeLabel('tax-advisor-pdf')).toBe('税理士相談用 PDF')
    expect(formatAccountingExportTypeLabel('tax-advisor-csv')).toBe('税理士相談用 CSV')
  })
})

describe('buildReadinessSnapshot', () => {
  it('matches summarizeFilingChecks counts', () => {
    const items: FilingCheckItem[] = [
      {
        id: 'a',
        category: 'expenses',
        label: 'A',
        status: 'blocking',
        summary: 'x',
      },
      {
        id: 'b',
        category: 'expenses',
        label: 'B',
        status: 'warning',
        summary: 'x',
      },
      {
        id: 'c',
        category: 'expenses',
        label: 'C',
        status: 'planned',
        summary: 'x',
      },
      {
        id: 'd',
        category: 'expenses',
        label: 'D',
        status: 'complete',
        summary: 'x',
      },
      {
        id: 'e',
        category: 'expenses',
        label: 'E',
        status: 'notApplicable',
        summary: 'x',
      },
      {
        id: 'f',
        category: 'expenses',
        label: 'F',
        status: 'complete',
        summary: 'x',
      },
    ]
    const summary = summarizeFilingChecks(items)
    const snapshot = buildReadinessSnapshot(summary)
    expect(snapshot).toEqual({
      blockingCount: summary.blockingCount,
      warningCount: summary.warningCount,
      plannedCount: summary.plannedCount,
      completeCount: summary.completeCount,
      notApplicableCount: summary.notApplicableCount,
      isFilingReady: summary.isFilingReady,
    })
    expect(snapshot.blockingCount).toBe(1)
    expect(snapshot.warningCount).toBe(1)
    expect(snapshot.plannedCount).toBe(1)
    expect(snapshot.completeCount).toBe(2)
    expect(snapshot.notApplicableCount).toBe(1)
    expect(snapshot.isFilingReady).toBe(false)
  })
})

describe('shortFingerprint', () => {
  it('returns 記録なし for missing fingerprint', () => {
    expect(shortFingerprint(undefined)).toBe('記録なし')
  })

  it('shortens fingerprint', () => {
    expect(shortFingerprint('abcdefghijklmnop', 10)).toBe('abcdefghij')
  })
})
