import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_AUTH_REQUIRED_MESSAGE,
  ACCOUNTING_SETTLEMENT_AUXILIARY_LOAD_HINT,
  formatAccountingQueryErrorMessage,
  hasAccountingTokenClaims,
  type AccountingAuthTokenClaims,
} from './accountingTenant'

describe('hasAccountingTokenClaims', () => {
  it('rejects null and missing role/tenant', () => {
    expect(hasAccountingTokenClaims(null)).toBe(false)
    expect(
      hasAccountingTokenClaims({
        role: '',
        franchiseeId: 'f1',
        companyId: 'f1',
        storeId: 's1',
        staffId: 'u1',
      }),
    ).toBe(false)
    expect(
      hasAccountingTokenClaims({
        role: 'owner',
        franchiseeId: '',
        companyId: '',
        storeId: 's1',
        staffId: 'u1',
      }),
    ).toBe(false)
  })

  it('accepts owner with franchiseeId or companyId', () => {
    const base: AccountingAuthTokenClaims = {
      role: 'owner',
      franchiseeId: 'ちばケアタクシー',
      companyId: '',
      storeId: 'ちばケアタクシー_main-store',
      staffId: 'owner1',
    }
    expect(hasAccountingTokenClaims(base)).toBe(true)
    expect(
      hasAccountingTokenClaims({
        ...base,
        franchiseeId: '',
        companyId: 'ちばケアタクシー',
      }),
    ).toBe(true)
  })

  it('requires storeId for manager', () => {
    expect(
      hasAccountingTokenClaims({
        role: 'manager',
        franchiseeId: 'f1',
        companyId: 'f1',
        storeId: '',
        staffId: 'm1',
      }),
    ).toBe(false)
    expect(
      hasAccountingTokenClaims({
        role: 'manager',
        franchiseeId: 'f1',
        companyId: 'f1',
        storeId: 's1',
        staffId: 'm1',
      }),
    ).toBe(true)
  })

  it('rejects driver', () => {
    expect(
      hasAccountingTokenClaims({
        role: 'driver',
        franchiseeId: 'f1',
        companyId: 'f1',
        storeId: 's1',
        staffId: 'd1',
      }),
    ).toBe(false)
  })
})

describe('accounting tenant messaging', () => {
  it('formats query errors with collection name', () => {
    expect(formatAccountingQueryErrorMessage('accountingSettlementAuxiliary', new Error('Missing or insufficient permissions.'))).toBe(
      'accountingSettlementAuxiliary: Missing or insufficient permissions.',
    )
  })

  it('exposes auth-required and settlement-isolated hint constants', () => {
    expect(ACCOUNTING_AUTH_REQUIRED_MESSAGE).toContain('再ログイン')
    expect(ACCOUNTING_SETTLEMENT_AUXILIARY_LOAD_HINT).toContain('accountingSettlementAuxiliary')
    expect(ACCOUNTING_SETTLEMENT_AUXILIARY_LOAD_HINT).toContain('経費一覧')
  })
})
