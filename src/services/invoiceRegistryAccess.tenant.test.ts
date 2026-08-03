import { describe, expect, it } from 'vitest'
import { matchesTenantScope } from '../services/tenancy'
import { mapFirestoreDocToInvoiceLookupHistory } from '../services/accountingInvoiceLookupHistory'

describe('invoice lookup history tenant isolation', () => {
  const rowFor = (franchiseeId: string) =>
    mapFirestoreDocToInvoiceLookupHistory('log-1', {
      actionType: 'accounting.invoice_lookup',
      franchiseeId,
      storeId: 's1',
      targetId: 'T1234567890123',
      userId: 'u1',
      userName: '太郎',
      role: 'owner',
      afterData: {
        schemaVersion: 1,
        origin: 'manual',
        outcome: 'success',
        apiCalled: true,
        lookupSource: 'nta-invoice-api',
        usedFallback: false,
        invoiceNumber: 'T1234567890123',
        requestedAt: '2026-08-03T00:00:00.000Z',
        completedAt: '2026-08-03T00:00:01.000Z',
        durationMs: 1000,
      },
    })

  it('FC加盟店オーナー can only match own franchise history rows', () => {
    const own = rowFor('fc-own')
    const other = rowFor('fc-other')
    expect(own).not.toBeNull()
    expect(other).not.toBeNull()
    expect(
      matchesTenantScope(own!, { role: 'owner', franchiseeId: 'fc-own', storeId: 's1' }),
    ).toBe(true)
    expect(
      matchesTenantScope(other!, { role: 'owner', franchiseeId: 'fc-own', storeId: 's1' }),
    ).toBe(false)
  })

  it('hq_admin can match all franchise history rows', () => {
    const other = rowFor('fc-other')
    expect(
      matchesTenantScope(other!, { role: 'hq_admin', franchiseeId: 'hq', storeId: 'hq-s' }),
    ).toBe(true)
  })
})
