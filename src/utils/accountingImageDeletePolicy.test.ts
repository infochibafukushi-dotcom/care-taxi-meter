import { describe, expect, it } from 'vitest'
import {
  canHardDeleteAccountingImage,
  resolveAccountingImageDeleteAction,
  assertTenantCanDeleteAccountingImage,
  IMAGE_HARD_DELETE_CONFIRM_MESSAGE,
  IMAGE_SOFT_HIDE_MESSAGE,
} from './accountingImageDeletePolicy'

describe('accountingImageDeletePolicy', () => {
  it('allows hard delete for never-linked unorganized receipts', () => {
    const decision = resolveAccountingImageDeleteAction({
      status: 'unorganized',
      receiptStatus: 'draft',
    })
    expect(decision.action).toBe('hard_delete')
    expect(canHardDeleteAccountingImage({ status: 'unorganized', receiptStatus: 'ocr_ready' })).toBe(
      true,
    )
  })

  it('forbids hard delete for expense-linked receipts', () => {
    expect(
      resolveAccountingImageDeleteAction({
        status: 'linked',
        receiptStatus: 'confirmed',
        linkedExpenseId: 'exp-1',
      }).action,
    ).toBe('soft_hide')
  })

  it('forbids hard delete for orphan-linked receipts (past link)', () => {
    expect(
      resolveAccountingImageDeleteAction({
        status: 'linked',
        linkedExpenseId: 'missing-expense',
      }).action,
    ).toBe('soft_hide')
  })

  it('forbids hard delete for fixed-asset evidence', () => {
    expect(
      resolveAccountingImageDeleteAction(
        { status: 'unorganized', linkedExpenseId: 'exp-fa' },
        { linkedExpense: { linkedAssetId: 'asset-1', confirmationStatus: '下書き' } },
      ).action,
    ).toBe('soft_hide')
  })

  it('exposes required user-facing messages', () => {
    expect(IMAGE_HARD_DELETE_CONFIRM_MESSAGE).toContain('復元できません')
    expect(IMAGE_SOFT_HIDE_MESSAGE).toContain('完全削除できません')
  })

  it('blocks cross-tenant delete', () => {
    expect(() =>
      assertTenantCanDeleteAccountingImage(
        { franchiseeId: 'f1', storeId: 's1' },
        { franchiseeId: 'f2', storeId: 's1', role: 'owner' },
      ),
    ).toThrow(/他加盟店/)
  })

  it('allows same-tenant delete', () => {
    expect(() =>
      assertTenantCanDeleteAccountingImage(
        { franchiseeId: 'f1', storeId: 's1' },
        { franchiseeId: 'f1', storeId: 's1', role: 'owner' },
      ),
    ).not.toThrow()
  })
})
