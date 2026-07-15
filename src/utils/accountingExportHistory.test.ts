import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNTING_EXPORT_SCHEMA_VERSION } from '../types/accountingExportHistory'

const { recordAccountingExportMock } = vi.hoisted(() => ({
  recordAccountingExportMock: vi.fn(),
}))

vi.mock('../services/accountingExports', async () => {
  const actual = await vi.importActual<typeof import('../services/accountingExports')>(
    '../services/accountingExports',
  )
  return {
    ...actual,
    recordAccountingExport: recordAccountingExportMock,
  }
})

import { recordAccountingExportOperation } from './accountingExportHistory'

describe('recordAccountingExportOperation validation', () => {
  beforeEach(() => {
    recordAccountingExportMock.mockReset()
    recordAccountingExportMock.mockResolvedValue('doc-1')
  })

  it('returns error when files is empty', async () => {
    const result = await recordAccountingExportOperation({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      createdBy: 'u1',
      createdByName: 'Test',
      exportType: 'etax-pdf',
      targetYearMonth: '2027-03',
      files: [],
    })
    expect(result).toEqual({ error: 'files is empty' })
    expect(recordAccountingExportMock).not.toHaveBeenCalled()
  })

  it('returns error on duplicate fileNames', async () => {
    const result = await recordAccountingExportOperation({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      createdBy: 'u1',
      createdByName: 'Test',
      exportType: 'etax-csv',
      targetYearMonth: '2027-03',
      files: [
        { fileName: 'a.csv', format: 'csv', documentType: 'x' },
        { fileName: 'a.csv', format: 'csv', documentType: 'y' },
      ],
    })
    expect(result).toEqual({ error: 'duplicate fileNames in manifest' })
    expect(recordAccountingExportMock).not.toHaveBeenCalled()
  })

  it('calls recordAccountingExport once with stripped manifest (single-write path)', async () => {
    const result = await recordAccountingExportOperation({
      franchiseeId: 'f1',
      companyId: 'f1',
      storeId: 's1',
      createdBy: 'u1',
      createdByName: 'Test',
      exportType: 'etax-pdf',
      targetYearMonth: '2027-03',
      files: [
        {
          fileName: 'cover.pdf',
          format: 'pdf',
          documentType: 'etax-cover',
          rowCount: undefined as unknown as number,
        },
        { fileName: 'pl.pdf', format: 'pdf', documentType: 'etax-pdf-bulk' },
      ],
      exportSchemaVersion: ACCOUNTING_EXPORT_SCHEMA_VERSION,
    })
    expect(result).toEqual({ id: 'doc-1' })
    expect(recordAccountingExportMock).toHaveBeenCalledTimes(1)
    const payload = recordAccountingExportMock.mock.calls[0][0] as {
      fileCount: number
      files: Array<Record<string, unknown>>
      fileName: string
    }
    expect(payload.fileCount).toBe(2)
    expect(payload.fileCount).toBe(payload.files.length)
    expect(payload.fileName).toBe('cover.pdf')
    expect(payload.files[0]).toEqual({
      fileName: 'cover.pdf',
      format: 'pdf',
      documentType: 'etax-cover',
    })
    expect(payload.files[0]).not.toHaveProperty('rowCount')
  })
})
