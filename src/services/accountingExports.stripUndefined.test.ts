import { describe, expect, it } from 'vitest'
import { removeUndefinedDeep, stripUndefined } from './accountingExports'

describe('stripUndefined / removeUndefinedDeep', () => {
  it('exports removeUndefinedDeep as an alias of stripUndefined', () => {
    expect(removeUndefinedDeep).toBe(stripUndefined)
  })

  it('removes undefined nested keys', () => {
    expect(
      stripUndefined({
        a: 1,
        b: undefined,
        nested: { c: 2, d: undefined, deeper: { e: undefined, f: 'ok' } },
        list: [1, undefined, { g: undefined, h: 3 }],
      }),
    ).toEqual({
      a: 1,
      nested: { c: 2, deeper: { f: 'ok' } },
      list: [1, { h: 3 }],
    })
  })

  it('keeps only defined keys on a PDF-like file manifest item', () => {
    const cleaned = stripUndefined({
      fileName: 'etax-cover.pdf',
      format: 'pdf',
      documentType: 'etax-cover',
      rowCount: undefined,
      byteSize: undefined,
      contentHash: undefined,
    })
    expect(cleaned).toEqual({
      fileName: 'etax-cover.pdf',
      format: 'pdf',
      documentType: 'etax-cover',
    })
  })

  it('can strip legacy minimal export input for save', () => {
    const cleaned = stripUndefined({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      exportType: 'monthly-pl',
      targetYearMonth: '2026-08',
      fileName: 'accounting-pl-2026-08.csv',
      rowCount: 10,
      createdBy: 'staff1',
      createdByName: '太郎',
      fiscalPeriod: undefined,
      files: undefined,
      readiness: undefined,
      sourceFingerprint: undefined,
    })
    expect(cleaned).toEqual({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      exportType: 'monthly-pl',
      targetYearMonth: '2026-08',
      fileName: 'accounting-pl-2026-08.csv',
      rowCount: 10,
      createdBy: 'staff1',
      createdByName: '太郎',
    })
  })
})
