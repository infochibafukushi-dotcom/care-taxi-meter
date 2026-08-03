import { describe, expect, it } from 'vitest'
import {
  INVOICE_REGISTRATION_NUMBER_ERROR,
  isVendorNameMismatch,
  normalizeBasisDateForUi,
  normalizeInvoiceRegistrationNumberForUi,
} from './invoiceRegistryNormalize'

describe('normalizeInvoiceRegistrationNumberForUi', () => {
  it('normalizes variants', () => {
    expect(normalizeInvoiceRegistrationNumberForUi('T1234567890123')).toBe('T1234567890123')
    expect(normalizeInvoiceRegistrationNumberForUi('t1234567890123')).toBe('T1234567890123')
    expect(normalizeInvoiceRegistrationNumberForUi('1234567890123')).toBe('T1234567890123')
    expect(normalizeInvoiceRegistrationNumberForUi('Ｔ１２３４５６７８９０１２３')).toBe(
      'T1234567890123',
    )
    expect(normalizeInvoiceRegistrationNumberForUi(' T1234-5678-9012-3 ')).toBe('T1234567890123')
  })

  it('rejects invalid values', () => {
    expect(normalizeInvoiceRegistrationNumberForUi('')).toBe('')
    expect(normalizeInvoiceRegistrationNumberForUi('T123')).toBe('')
    expect(normalizeInvoiceRegistrationNumberForUi('T12345678901234')).toBe('')
    expect(normalizeInvoiceRegistrationNumberForUi('X1234567890123')).toBe('')
    expect(INVOICE_REGISTRATION_NUMBER_ERROR).toContain('T＋数字13桁')
  })
})

describe('normalizeBasisDateForUi', () => {
  it('validates dates', () => {
    expect(normalizeBasisDateForUi('2026-08-01', '2026-08-03')).toEqual({
      ok: true,
      date: '2026-08-01',
    })
    expect(normalizeBasisDateForUi('2026-08-04', '2026-08-03').ok).toBe(false)
    expect(normalizeBasisDateForUi('2026-02-30', '2026-08-03').ok).toBe(false)
    expect(normalizeBasisDateForUi('', '2026-08-03')).toEqual({ ok: true, date: null })
  })
})

describe('isVendorNameMismatch', () => {
  it('uses strict equality without corporate-form folding', () => {
    expect(isVendorNameMismatch('株式会社テスト', '株式会社テスト')).toBe(false)
    expect(isVendorNameMismatch('（株）テスト', '株式会社テスト')).toBe(true)
    expect(isVendorNameMismatch('', '株式会社テスト')).toBe(false)
  })
})
