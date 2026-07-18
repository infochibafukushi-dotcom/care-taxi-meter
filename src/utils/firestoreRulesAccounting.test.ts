import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8')

function extractMatchBlock(source: string, collectionPath: string): string {
  const start = source.indexOf(`match /${collectionPath}/`)
  if (start < 0) return ''
  const after = source.slice(start)
  const nextMatch = after.search(/\n\s*match \//)
  // Prefer closing at next top-level-ish match after this block's content
  const endMarker = after.indexOf('\n    match /', 1)
  if (endMarker > 0) return after.slice(0, endMarker)
  if (nextMatch > 0) return after.slice(0, nextMatch)
  return after
}

const settlementAuxiliaryBlock = extractMatchBlock(rules, 'accountingSettlementAuxiliary')

describe('firestore.rules accountingSettlementAuxiliary', () => {
  it('defines accounting access helpers', () => {
    expect(rules).toContain('function isAccountingUser()')
    expect(rules).toContain('function canReadAccounting(data)')
    expect(rules).toContain('function canWriteAccountingData(data)')
    expect(rules).toContain('function canReadSettlementAuxiliaryDoc(docId)')
  })

  it('keeps accounting collections behind canReadAccounting', () => {
    for (const collection of [
      'accountingExpenses',
      'accountingReceipts',
      'accountingFixedAssets',
      'accountingSales',
      'accountingFixedCosts',
    ]) {
      expect(rules).toContain(`match /${collection}/{`)
    }
    expect(rules).toMatch(/match \/accountingExpenses\/\{expenseId\}[\s\S]*?allow read: if canReadAccounting\(resource\.data\);/)
  })

  it('allows settlementAuxiliary read via resource tenant OR docId match for accounting users', () => {
    expect(settlementAuxiliaryBlock).toContain('match /accountingSettlementAuxiliary/{docId}')
    expect(settlementAuxiliaryBlock).toContain('canReadSettlementAuxiliaryDoc(docId)')
    // 既存ドキュメント: canReadAccounting OR (isAccountingUser && docId)
    expect(settlementAuxiliaryBlock).toMatch(/canReadAccounting\(resource\.data\)/)
    expect(settlementAuxiliaryBlock).toMatch(/canReadSettlementAuxiliaryDoc\(docId\)/)
    // 未認証・全公開は禁止（当該 match ブロック内のみ検査）
    expect(settlementAuxiliaryBlock).not.toMatch(/allow read: if true/)
    expect(settlementAuxiliaryBlock).not.toMatch(/allow read: if signedIn\(\)/)
  })

  it('denies settlementAuxiliary delete and requires signed accounting user for writes', () => {
    expect(settlementAuxiliaryBlock).toMatch(/allow delete: if false;/)
    expect(settlementAuxiliaryBlock).toMatch(/allow create: if isAccountingUser\(\) && canWriteAccountingData/)
  })

  it('owner/manager role aliases remain accepted', () => {
    expect(rules).toContain("role() == 'franchisee_owner' || role() == 'owner'")
    expect(rules).toContain("role() == 'store_manager' || role() == 'manager'")
  })
})
