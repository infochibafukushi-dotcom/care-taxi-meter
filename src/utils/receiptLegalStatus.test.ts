import { describe, expect, it } from 'vitest'
import {
  assertTransitionAccountingReceiptLegalStatus,
  canDiscardReceiptScanSession,
  canTransitionAccountingReceiptLegalStatus,
} from './receiptLegalStatus'

describe('receiptLegalStatus transitions', () => {
  it('allows draft → image_review → legal_pending_timestamp', () => {
    expect(canTransitionAccountingReceiptLegalStatus('draft', 'image_review')).toBe(true)
    expect(canTransitionAccountingReceiptLegalStatus('image_review', 'legal_pending_timestamp')).toBe(
      true,
    )
  })

  it('rejects illegal jumps to legal_saved_accounting_pending from draft', () => {
    expect(
      canTransitionAccountingReceiptLegalStatus('draft', 'legal_saved_accounting_pending'),
    ).toBe(false)
    expect(() =>
      assertTransitionAccountingReceiptLegalStatus('draft', 'legal_saved_accounting_pending'),
    ).toThrow()
  })

  it('allows discard only before legal_pending_timestamp', () => {
    expect(canDiscardReceiptScanSession('draft')).toBe(true)
    expect(canDiscardReceiptScanSession('image_review')).toBe(true)
    expect(canDiscardReceiptScanSession('legal_pending_timestamp')).toBe(false)
  })
})
