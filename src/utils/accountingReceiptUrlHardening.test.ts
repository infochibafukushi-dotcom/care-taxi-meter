import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeExpenseInputForSave, normalizeExpensePatchForSave } from '../types/accounting'
import { buildEmptyExpenseInput } from '../services/accountingExpenses'
import { IMAGE_SOFT_HIDE_DELETE_REASON } from './accountingImageDeletePolicy'

const repoRoot = join(__dirname, '../..')

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n')

/** コメント（// ... と /* ... *\/）を除いたソースを返す。呼び出し／importのみを検査する用途。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('accountingReceipts.ts のクライアント側 getDownloadURL 撤去', () => {
  const source = readSource('src/services/accountingReceipts.ts')
  const codeOnly = stripComments(source)

  it('uploadStorageFile は getDownloadURL を呼ばない', () => {
    const match = source.match(/const uploadStorageFile = async[\s\S]*?\n}\n/)
    expect(match).not.toBeNull()
    expect(match?.[0]).not.toContain('getDownloadURL')
  })

  it('resolveAccountingReceiptDownloadUrl は getDownloadURL を呼ばない', () => {
    const match = source.match(
      /export async function resolveAccountingReceiptDownloadUrl[\s\S]*?\n}\n/,
    )
    expect(match).not.toBeNull()
    expect(match?.[0]).not.toContain('getDownloadURL')
  })

  it('コメントを除いたコード本体に getDownloadURL 呼び出しが存在しない', () => {
    expect(codeOnly).not.toContain('getDownloadURL(')
    expect(codeOnly).not.toContain('getDownloadURL,')
    expect(codeOnly).not.toContain('getDownloadURL }')
  })

  it('firebase/storage からの import に getDownloadURL が含まれない', () => {
    const importMatch = source.match(/import\s*\{([^}]*)\}\s*from\s*'firebase\/storage'/)
    expect(importMatch).not.toBeNull()
    expect(importMatch?.[1] ?? '').not.toContain('getDownloadURL')
  })
})

describe('getAccountingReceiptAccessUrl.ts のログ出力', () => {
  const source = readSource('functions/src/getAccountingReceiptAccessUrl.ts')

  it('logger 呼び出しは buildAccountingReceiptAccessLogFields を使う', () => {
    expect(source).toContain('buildAccountingReceiptAccessLogFields')
    const loggerCallMatch = source.match(/logger\.info\([\s\S]*?\n\s*\)\n/)
    expect(loggerCallMatch).not.toBeNull()
    expect(loggerCallMatch?.[0]).toContain('buildAccountingReceiptAccessLogFields')
  })

  it('署名 URL 発行には v4 の短期署名を使う', () => {
    expect(source).toContain("version: 'v4'")
    expect(source).toContain('getSignedUrl')
  })
})

describe('soft-hide ポリシーの維持', () => {
  it('IMAGE_SOFT_HIDE_DELETE_REASON が継続して export されている', () => {
    expect(IMAGE_SOFT_HIDE_DELETE_REASON).toBe('accounting_linked_evidence_soft_hide')
  })
})

describe('normalizeExpenseInputForSave の URL 除去と金額不変性', () => {
  it('receiptImageUrl 等の永続 URL フィールドを空にする', () => {
    const input = {
      ...buildEmptyExpenseInput({
        franchiseeId: 'f1',
        storeId: 's1',
        staffId: 'u1',
        staffName: 'User',
      }),
      receiptImageUrl: 'https://example.com/token-url.jpg',
      receiptPreviewImageUrl: 'https://example.com/token-url-preview.jpg',
      receiptFileUrl: 'https://example.com/token-url-original.pdf',
      receiptStoragePath: 'accounting/f1/s1/receipts/r1/original/a.jpg',
      receiptId: 'r1',
      taxIncludedAmount: 136578,
    }

    const normalized = normalizeExpenseInputForSave(input)

    expect(normalized.receiptImageUrl).toBe('')
    expect(normalized.receiptPreviewImageUrl).toBe('')
    expect(normalized.receiptFileUrl).toBe('')
    // storage path / receiptId は保持される
    expect(normalized.receiptStoragePath).toBe('accounting/f1/s1/receipts/r1/original/a.jpg')
    expect(normalized.receiptId).toBe('r1')
  })

  it('金額・税額フィールドは URL 除去の影響を受けない', () => {
    const input = {
      ...buildEmptyExpenseInput({
        franchiseeId: 'f1',
        storeId: 's1',
        staffId: 'u1',
        staffName: 'User',
      }),
      receiptImageUrl: 'https://example.com/token-url.jpg',
      taxIncludedAmount: 136578,
      taxRate: 10,
      taxCalculationMode: 'manual' as const,
      taxAmount: 12416,
      consumptionTaxAmount: 12416,
    }

    const normalized = normalizeExpenseInputForSave(input)

    expect(normalized.taxIncludedAmount).toBe(136578)
    expect(normalized.taxAmount).toBe(12416)
    expect(normalized.consumptionTaxAmount).toBe(12416)
  })
})

describe('normalizeExpensePatchForSave（部分更新）の URL 除去', () => {
  it('関係ないフィールドの patch でも永続 URL フィールドは空になる', () => {
    const patch = normalizeExpensePatchForSave({ memo: '出張時のタクシー代' })
    expect(patch.receiptImageUrl).toBe('')
    expect(patch.receiptPreviewImageUrl).toBe('')
    expect(patch.receiptFileUrl).toBe('')
    expect(patch.memo).toBe('出張時のタクシー代')
  })
})
