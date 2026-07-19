import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearInvoiceRegistrantCacheForTests } from '../utils/invoiceRegistrantCache'

const createAuditLogMock = vi.fn(async () => undefined)
const isReviewDemoRuntimeEnabledMock = vi.fn(() => false)

vi.mock('../services/auditLogs', () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args),
}))

vi.mock('../utils/reviewDemo', () => ({
  isReviewDemoRuntimeEnabled: () => isReviewDemoRuntimeEnabledMock(),
}))

vi.mock('../lib/firebase', () => ({
  getFirebaseApp: () => ({}),
}))

const getDocsMock = vi.fn()
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore')
  return {
    ...actual,
    getFirestore: () => ({}),
    getDocs: (...args: unknown[]) => getDocsMock(...args),
    collection: (...args: unknown[]) => ({ path: args.join('/') }),
    query: (...args: unknown[]) => ({ constraints: args.slice(1) }),
    where: (...args: unknown[]) => ({ type: 'where', args }),
    orderBy: (...args: unknown[]) => ({ type: 'orderBy', args }),
    limit: (...args: unknown[]) => ({ type: 'limit', args }),
  }
})

describe('accounting invoice lookup history', () => {
  beforeEach(() => {
    clearInvoiceRegistrantCacheForTests()
    createAuditLogMock.mockReset()
    createAuditLogMock.mockResolvedValue(undefined)
    isReviewDemoRuntimeEnabledMock.mockReturnValue(false)
    getDocsMock.mockReset()
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  const auditContext = {
    actor: {
      userId: 'staff-1',
      userName: '経理太郎',
      role: 'owner' as const,
      franchiseeId: 'f1',
      storeId: 's1',
    },
    franchiseeId: 'f1',
    storeId: 's1',
    origin: 'manual' as const,
  }

  it('saves one history row on manual lookup success via nta api', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        registrant: {
          invoiceNumber: 'T4200001013662',
          corporateNumber: '4200001013662',
          registeredName: '株式会社セリア',
          registrationStatus: '登録',
          lookupMethod: 'インボイス番号検索',
          lookedUpAt: '2026-07-08T00:00:00.000Z',
          source: 'nta-invoice-api',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupInvoiceRegistrant('T4200001013662', auditContext)
    expect(result.status).toBe('success')
    expect(createAuditLogMock).toHaveBeenCalledTimes(1)
    const payload = createAuditLogMock.mock.calls[0]?.[0] as {
      action: string
      after: Record<string, unknown>
    }
    expect(payload.action).toBe('accounting.invoice_lookup')
    expect(payload.after).toMatchObject({
      schemaVersion: 1,
      origin: 'manual',
      outcome: 'success',
      apiCalled: true,
      lookupSource: 'nta-invoice-api',
      usedFallback: false,
      invoiceNumber: 'T4200001013662',
    })
    expect(payload.after).not.toHaveProperty('address')
    expect(JSON.stringify(payload)).not.toMatch(/NTA_INVOICE_API_ID|Bearer|eyJ/)
  })

  it('saves one history row on ocr origin without double write', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          registrant: {
            invoiceNumber: 'T4200001013662',
            corporateNumber: '4200001013662',
            registeredName: '株式会社セリア',
            registrationStatus: '登録',
            lookupMethod: 'インボイス番号検索',
            lookedUpAt: '2026-07-08T00:00:00.000Z',
            source: 'nta-invoice-api',
          },
        }),
      }),
    )

    await lookupInvoiceRegistrant('T4200001013662', { ...auditContext, origin: 'ocr' })
    expect(createAuditLogMock).toHaveBeenCalledTimes(1)
    expect(createAuditLogMock.mock.calls[0]?.[0]).toMatchObject({
      after: { origin: 'ocr' },
    })
  })

  it('records cache hit without calling api again for history fields', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        registrant: {
          invoiceNumber: 'T4200001013662',
          corporateNumber: '4200001013662',
          registeredName: '株式会社セリア',
          registrationStatus: '登録',
          lookupMethod: 'インボイス番号検索',
          lookedUpAt: '2026-07-08T00:00:00.000Z',
          source: 'nta-invoice-api',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await lookupInvoiceRegistrant('T4200001013662', auditContext)
    await lookupInvoiceRegistrant('T4200001013662', auditContext)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createAuditLogMock).toHaveBeenCalledTimes(2)
    expect(createAuditLogMock.mock.calls[1]?.[0]).toMatchObject({
      after: {
        apiCalled: false,
        lookupSource: 'cache',
        outcome: 'success',
      },
    })
  })

  it('records fallback usage', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          message: 'Invoice API is not configured (NTA_INVOICE_API_ID)',
        }),
      }),
    )

    const result = await lookupInvoiceRegistrant('T4200001013662', auditContext)
    expect(result.status).toBe('success')
    expect(createAuditLogMock.mock.calls[0]?.[0]).toMatchObject({
      after: {
        lookupSource: 'fallback',
        usedFallback: true,
        apiCalled: true,
        outcome: 'success',
      },
    })
    const serialized = JSON.stringify(createAuditLogMock.mock.calls[0]?.[0])
    expect(serialized).not.toContain('NTA_INVOICE_API_ID')
  })

  it('records not_found outcome without secrets', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          announcement: [],
          message: '登録情報が見つかりませんでした https://example.invalid/secret?token=abc',
        }),
      }),
    )

    // Use a number without fallback entry
    const result = await lookupInvoiceRegistrant('T1234567890123', auditContext)
    expect(result.status).toBe('error')
    const after = (createAuditLogMock.mock.calls[0]?.[0] as { after: Record<string, unknown> }).after
    expect(after.outcome).toBe('not_found')
    expect(String(after.errorMessage)).toHaveLength(Math.min(String(after.errorMessage).length, 200))
    expect(String(after.errorMessage).length).toBeLessThanOrEqual(200)
    expect(String(after.errorMessage)).not.toContain('https://')
    expect(String(after.errorMessage)).not.toContain('token=')
  })

  it('records api error with sanitized message <= 200 chars', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    const longSecret =
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig ' +
      'https://api.example/invoice?id=NTA_INVOICE_API_ID ' +
      'x'.repeat(300)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: longSecret }),
      }),
    )

    await lookupInvoiceRegistrant('T9999999999999', auditContext)
    const after = (createAuditLogMock.mock.calls[0]?.[0] as { after: Record<string, unknown> }).after
    expect(after.outcome).toBe('error')
    expect(String(after.errorMessage).length).toBeLessThanOrEqual(200)
    expect(String(after.errorMessage)).not.toMatch(/Bearer|eyJ|NTA_INVOICE_API_ID|https?:\/\//)
  })

  it('skips invalid invoice number without storing raw input', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    const result = await lookupInvoiceRegistrant('INVALID-RAW-VALUE', auditContext)
    expect(result.status).toBe('skipped')
    expect(createAuditLogMock).toHaveBeenCalledTimes(1)
    const payload = createAuditLogMock.mock.calls[0]?.[0] as {
      targetId: string
      after: Record<string, unknown>
    }
    expect(payload.after).toMatchObject({
      outcome: 'skipped',
      apiCalled: false,
      lookupSource: 'none',
      invoiceNumber: '',
    })
    expect(payload.targetId).toBe('')
    expect(JSON.stringify(payload)).not.toContain('INVALID-RAW-VALUE')
  })

  it('keeps lookup result when history save fails', async () => {
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    createAuditLogMock.mockRejectedValueOnce(new Error('permission-denied'))
    const onHistoryPersistFailure = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          registrant: {
            invoiceNumber: 'T4200001013662',
            corporateNumber: '4200001013662',
            registeredName: '株式会社セリア',
            registrationStatus: '登録',
            lookupMethod: 'インボイス番号検索',
            lookedUpAt: '2026-07-08T00:00:00.000Z',
            source: 'nta-invoice-api',
          },
        }),
      }),
    )

    const result = await lookupInvoiceRegistrant('T4200001013662', {
      ...auditContext,
      onHistoryPersistFailure,
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.registrant.registeredName).toBe('株式会社セリア')
    }
    expect(onHistoryPersistFailure).toHaveBeenCalledTimes(1)
  })

  it('does not write history in review demo mode', async () => {
    isReviewDemoRuntimeEnabledMock.mockReturnValue(true)
    const { lookupInvoiceRegistrant } = await import('./invoiceRegistrantLookup')
    const result = await lookupInvoiceRegistrant('T4200001013662', auditContext)
    expect(result.status).toBe('success')
    expect(createAuditLogMock).not.toHaveBeenCalled()
  })

  it('applies tenant constraints when fetching history', async () => {
    const { fetchAccountingInvoiceLookupHistory } = await import('./accountingInvoiceLookupHistory')
    const { createTenantQueryConstraints } = await import('./tenancy')

    getDocsMock.mockResolvedValue({ docs: [] })
    await fetchAccountingInvoiceLookupHistory(
      { role: 'owner', franchiseeId: 'f1', storeId: 's1' },
      100,
    )
    expect(getDocsMock).toHaveBeenCalledTimes(1)
    expect(
      createTenantQueryConstraints({ role: 'owner', franchiseeId: 'f1', storeId: 's1' }),
    ).toHaveLength(1)

    getDocsMock.mockResolvedValue({ docs: [] })
    await fetchAccountingInvoiceLookupHistory(
      { role: 'manager', franchiseeId: 'f1', storeId: 's1' },
      50,
    )
    expect(getDocsMock).toHaveBeenCalledTimes(2)
    expect(
      createTenantQueryConstraints({ role: 'manager', franchiseeId: 'f1', storeId: 's1' }),
    ).toHaveLength(2)
  })

  it('sanitizes error messages for history', async () => {
    const { sanitizeInvoiceLookupErrorMessage } = await import('./accountingInvoiceLookupHistory')
    const sanitized = sanitizeInvoiceLookupErrorMessage(
      'fail Bearer token-abc https://secret.example/path NTA_INVOICE_API_ID ' + 'y'.repeat(250),
    )
    expect(sanitized.length).toBeLessThanOrEqual(200)
    expect(sanitized).not.toMatch(/Bearer|https?:\/\/|NTA_INVOICE_API_ID/)
  })
})

describe('InvoiceLookupHistoryPanel read-only surface', () => {
  it('does not expose edit or delete controls in source', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/accounting/InvoiceLookupHistoryPanel.tsx'),
      'utf8',
    )
    expect(source).toContain('インボイス検索履歴')
    expect(source).toContain('再読込')
    expect(source).toContain('isDriverTenantRole')
    expect(source).not.toMatch(/削除|編集|onDelete|onEdit|updateDoc|deleteDoc/)
  })

  it('normalizes franchise roles when mapping history docs', async () => {
    const { mapFirestoreDocToInvoiceLookupHistory } = await import('./accountingInvoiceLookupHistory')
    const mapped = mapFirestoreDocToInvoiceLookupHistory('log-1', {
      actionType: 'accounting.invoice_lookup',
      franchiseeId: 'f1',
      storeId: 's1',
      targetId: 'T4200001013662',
      userId: 'u1',
      userName: '太郎',
      role: 'franchisee_owner',
      afterData: {
        schemaVersion: 1,
        origin: 'manual',
        outcome: 'success',
        apiCalled: true,
        lookupSource: 'nta-invoice-api',
        usedFallback: false,
        invoiceNumber: 'T4200001013662',
        requestedAt: '2026-07-19T00:00:00.000Z',
        completedAt: '2026-07-19T00:00:01.000Z',
        durationMs: 1000,
      },
    })
    expect(mapped?.actorRole).toBe('owner')
  })
})
