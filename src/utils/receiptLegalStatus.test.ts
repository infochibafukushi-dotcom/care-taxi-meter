import { describe, expect, it } from 'vitest'
import {
  assertTransitionAccountingReceiptLegalStatus,
  canDiscardReceiptScanSession,
  canHardDeleteScannerReceipt,
  canPromoteToLegalSaved,
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

  it('allows legal_pending_timestamp → late_saved after timestamp when overdue', () => {
    expect(canTransitionAccountingReceiptLegalStatus('image_review', 'late_saved')).toBe(false)
    expect(canTransitionAccountingReceiptLegalStatus('legal_pending_timestamp', 'late_saved')).toBe(
      true,
    )
  })

  it('allows legal_pending_timestamp → legal_saved_accounting_pending after timestamp', () => {
    expect(
      canTransitionAccountingReceiptLegalStatus(
        'legal_pending_timestamp',
        'legal_saved_accounting_pending',
      ),
    ).toBe(true)
  })

  it('allows transitions to deleted from pre-confirm states', () => {
    expect(canTransitionAccountingReceiptLegalStatus('draft', 'deleted')).toBe(true)
    expect(canTransitionAccountingReceiptLegalStatus('image_review', 'deleted')).toBe(true)
    expect(canTransitionAccountingReceiptLegalStatus('legal_pending_timestamp', 'deleted')).toBe(
      true,
    )
    expect(
      canTransitionAccountingReceiptLegalStatus('legal_saved_accounting_pending', 'deleted'),
    ).toBe(true)
    expect(canTransitionAccountingReceiptLegalStatus('accounting_confirmed', 'deleted')).toBe(true)
    expect(canTransitionAccountingReceiptLegalStatus('late_saved', 'deleted')).toBe(true)
  })

  it('does not allow transitions from deleted', () => {
    expect(canTransitionAccountingReceiptLegalStatus('deleted', 'draft')).toBe(false)
    expect(canTransitionAccountingReceiptLegalStatus('deleted', 'image_review')).toBe(false)
  })
})

describe('canHardDeleteScannerReceipt', () => {
  it('allows hard delete before timestamp issued', () => {
    expect(
      canHardDeleteScannerReceipt({
        legalStatus: 'legal_pending_timestamp',
        timestampStatus: 'pending',
      }),
    ).toBe(true)
    expect(
      canHardDeleteScannerReceipt({
        legalStatus: 'image_review',
        timestampStatus: 'none',
      }),
    ).toBe(true)
    expect(
      canHardDeleteScannerReceipt({
        legalStatus: 'late_saved',
        timestampStatus: 'failed',
      }),
    ).toBe(false)
  })

  it('blocks hard delete when timestamp is issued', () => {
    expect(
      canHardDeleteScannerReceipt({
        legalStatus: 'legal_saved_accounting_pending',
        timestampStatus: 'issued',
      }),
    ).toBe(false)
    expect(
      canHardDeleteScannerReceipt({
        legalStatus: 'late_saved',
        timestampStatus: 'issued',
      }),
    ).toBe(false)
  })

  it('blocks hard delete for accounting_confirmed with issued timestamp', () => {
    expect(
      canHardDeleteScannerReceipt({
        legalStatus: 'accounting_confirmed',
        timestampStatus: 'issued',
      }),
    ).toBe(false)
  })
})

describe('canPromoteToLegalSaved', () => {
  it('returns true only when timestampStatus is issued', () => {
    expect(canPromoteToLegalSaved('issued')).toBe(true)
    expect(canPromoteToLegalSaved('pending')).toBe(false)
    expect(canPromoteToLegalSaved('failed')).toBe(false)
    expect(canPromoteToLegalSaved('none')).toBe(false)
    expect(canPromoteToLegalSaved(undefined)).toBe(false)
  })
})
