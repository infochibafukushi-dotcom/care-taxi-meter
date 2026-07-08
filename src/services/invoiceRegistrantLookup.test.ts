import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyInvoiceRegistrantLookupToParsedFields,
  corporateNumberFromInvoiceNumber,
  lookupInvoiceRegistrant,
  normalizeInvoiceRegistrationNumber,
} from '../services/invoiceRegistrantLookup'
import { clearInvoiceRegistrantCacheForTests } from '../utils/invoiceRegistrantCache'

describe('normalizeInvoiceRegistrationNumber', () => {
  it('normalizes T + 13 digits', () => {
    expect(normalizeInvoiceRegistrationNumber('T4200001013662')).toBe('T4200001013662')
    expect(normalizeInvoiceRegistrationNumber('t 4200-0010-1366-2')).toBe('T4200001013662')
    expect(normalizeInvoiceRegistrationNumber('4200001013662')).toBe('T4200001013662')
  })
})

describe('corporateNumberFromInvoiceNumber', () => {
  it('strips leading T', () => {
    expect(corporateNumberFromInvoiceNumber('T4200001013662')).toBe('4200001013662')
  })
})

describe('lookupInvoiceRegistrant', () => {
  beforeEach(() => {
    clearInvoiceRegistrantCacheForTests()
    vi.restoreAllMocks()
  })

  it('maps API registrant and caches by invoice number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        registrant: {
          invoiceNumber: 'T4200001013662',
          corporateNumber: '4200001013662',
          registeredName: '株式会社セリア',
          address: '岐阜県大垣市今宿６丁目５２番地１８',
          registrationStatus: '登録',
          registrationDate: '2023-10-01',
          lookupMethod: 'インボイス番号検索',
          lookedUpAt: '2026-07-08T00:00:00.000Z',
          source: 'nta-invoice-api',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await lookupInvoiceRegistrant('T4200001013662')
    expect(first.status).toBe('success')
    if (first.status === 'success') {
      expect(first.registrant.registeredName).toBe('株式会社セリア')
      expect(first.invoiceCheckStatus).toBe('確認済')
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await lookupInvoiceRegistrant('T4200001013662')
    expect(second.status).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('prefers search result over OCR vendor when applying lookup', () => {
    const applied = applyInvoiceRegistrantLookupToParsedFields(
      {
        invoiceNumber: 'T4200001013662',
        vendorName: 'Seria',
        invoiceRegisteredName: undefined,
        invoiceCheckStatus: '未確認',
      },
      {
        status: 'success',
        invoiceCheckStatus: '確認済',
        registrant: {
          invoiceNumber: 'T4200001013662',
          corporateNumber: '4200001013662',
          registeredName: '株式会社セリア',
          registrationStatus: '登録',
          lookupMethod: 'インボイス番号検索',
          lookedUpAt: '2026-07-08T00:00:00.000Z',
          source: 'nta-invoice-api',
        },
      },
    )

    expect(applied.vendorName).toBe('株式会社セリア')
    expect(applied.invoiceRegisteredName).toBe('株式会社セリア')
    expect(applied.invoiceCheckStatus).toBe('確認済')
    expect(applied.invoiceLookupMethod).toBe('インボイス番号検索')
  })
})
