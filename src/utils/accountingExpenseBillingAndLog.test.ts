import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { formatExpenseListBillingInvoiceNumber } from './accountingExpenseListDisplay'

describe('formatExpenseListBillingInvoiceNumber', () => {
  it('shows billing invoice number when present', () => {
    expect(formatExpenseListBillingInvoiceNumber('04938-2312929-1')).toBe('04938-2312929-1')
  })

  it('shows dash for empty legacy data without error', () => {
    expect(formatExpenseListBillingInvoiceNumber('')).toBe('－')
    expect(formatExpenseListBillingInvoiceNumber(undefined)).toBe('－')
    expect(formatExpenseListBillingInvoiceNumber(null)).toBe('－')
  })
})

describe('accounting OCR debug logging gate', () => {
  const originalDev = import.meta.env.DEV

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // @ts-expect-error test restore
    import.meta.env.DEV = originalDev
  })

  it('does not enable OCR debug logging in production even with debugAccounting=1', async () => {
    // @ts-expect-error test override
    import.meta.env.DEV = false
    vi.stubGlobal('window', {
      location: { search: '?debugAccounting=1' },
    })
    const { isAccountingOcrDebugLoggingEnabled } = await import('../services/accountingReceiptOcr')
    expect(isAccountingOcrDebugLoggingEnabled()).toBe(false)
  })
})
