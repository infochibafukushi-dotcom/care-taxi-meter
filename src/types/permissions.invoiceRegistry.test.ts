import { describe, expect, it } from 'vitest'
import { canAccessAccounting, canAccessInvoiceRegistry } from './permissions'
import type { StaffRole } from './work'

describe('canAccessAccounting / canAccessInvoiceRegistry', () => {
  it('allows FC加盟店オーナー (owner) for accounting UI and invoice registry', () => {
    expect(canAccessAccounting('owner')).toBe(true)
    expect(canAccessInvoiceRegistry('owner')).toBe(true)
  })

  it('allows FC本部管理者 (hq_admin) for accounting UI and invoice registry', () => {
    expect(canAccessAccounting('hq_admin')).toBe(true)
    expect(canAccessInvoiceRegistry('hq_admin')).toBe(true)
  })

  it('reuses canAccessAccounting for invoice registry (no separate role inventing)', () => {
    expect(canAccessInvoiceRegistry).toBe(canAccessAccounting)
  })

  it('denies manager even though Firestore isAccountingUser may include store managers', () => {
    expect(canAccessAccounting('manager')).toBe(false)
    expect(canAccessInvoiceRegistry('manager')).toBe(false)
  })

  it('denies driver and empty role', () => {
    const denied: Array<StaffRole | ''> = ['driver', '']
    for (const role of denied) {
      expect(canAccessAccounting(role)).toBe(false)
      expect(canAccessInvoiceRegistry(role)).toBe(false)
    }
  })
})

describe('AccountingPage invoice registry UI gating source', () => {
  it('uses canAccessInvoiceRegistry for menu and confirm button', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AccountingPage.tsx'), 'utf8')
    expect(source).toContain('canAccessInvoiceRegistry')
    expect(source).toContain('canUseInvoiceRegistryUi')
    expect(source).toContain("tab !== 'invoice-registry' || canUseInvoiceRegistryUi")
    expect(source).toContain('!canUseInvoiceRegistryUi')
    expect(source).toContain('インボイス登録確認')
  })
})
