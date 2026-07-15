import { describe, expect, it } from 'vitest'
import {
  buildUnlinkedVoucherFileName,
  buildVoucherFileName,
  ensureUniqueRelativePath,
  resolveSafeSubmissionExtension,
  sanitizeFileNameSegment,
} from './accountingSubmissionFileName'

describe('sanitizeFileNameSegment', () => {
  it('strips forbidden path and Windows characters', () => {
    expect(sanitizeFileNameSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('collapses underscores and trims trailing dots/spaces', () => {
    expect(sanitizeFileNameSegment('  foo__bar...  ')).toBe('foo_bar')
  })

  it('replaces control chars and newlines', () => {
    expect(sanitizeFileNameSegment('a\nb\tc\u0001d')).toBe('a_b_c_d')
  })

  it('enforces max length and falls back for empty', () => {
    expect(sanitizeFileNameSegment('あ'.repeat(200), 10).length).toBeLessThanOrEqual(10)
    expect(sanitizeFileNameSegment('   ')).toBe('untitled')
  })
})

describe('resolveSafeSubmissionExtension', () => {
  it('resolves from mime and filename', () => {
    expect(resolveSafeSubmissionExtension({ mimeType: 'application/pdf' })).toEqual({ ext: 'pdf' })
    expect(resolveSafeSubmissionExtension({ originalFileName: 'x.PNG' })).toEqual({ ext: 'png' })
    expect(resolveSafeSubmissionExtension({ mimeType: 'image/jpeg', originalFileName: 'a.webp' })).toEqual({
      ext: 'jpg',
    })
  })

  it('rejects exe-like and unknown formats', () => {
    expect(resolveSafeSubmissionExtension({ originalFileName: 'virus.exe' })).toEqual({
      issue: 'unsupportedFormat',
    })
    expect(resolveSafeSubmissionExtension({ originalFileName: 'note.txt' })).toEqual({
      issue: 'unsupportedFormat',
    })
    expect(resolveSafeSubmissionExtension({})).toEqual({ issue: 'unsupportedFormat' })
  })
})

describe('buildVoucherFileName / buildUnlinkedVoucherFileName', () => {
  it('builds linked and unlinked paths under 証憑', () => {
    expect(
      buildVoucherFileName({
        expenseNo: 'EXP-000001',
        receiptNo: 'RCP-000001',
        date: '2026-08-15',
        vendor: 'テスト商店',
        amountYen: 1100,
        ext: 'jpg',
      }),
    ).toBe('証憑/EXP-000001_RCP-000001_2026-08-15_テスト商店_1100.jpg')

    expect(
      buildUnlinkedVoucherFileName({
        receiptNo: 'RCP-000002',
        date: '2026-09-01',
        vendor: '未紐付店',
        amountYen: 500,
        ext: 'pdf',
      }),
    ).toBe('証憑/未紐付け/RCP-000002_2026-09-01_未紐付店_500.pdf')
  })

  it('sanitizes vendor names in path', () => {
    const path = buildVoucherFileName({
      receiptNo: 'RCP-000001',
      date: '2026-08-15',
      vendor: 'A/B:C',
      amountYen: 1,
      ext: 'png',
    })
    expect(path.includes('/')).toBe(true)
    expect(path.split('/').pop()?.includes(':')).toBe(false)
    expect(path).toContain('A_B_C')
  })

  it('omits EXP prefix when expenseNo is not provided (shared receipt style)', () => {
    expect(
      buildVoucherFileName({
        receiptNo: 'RCP-000001',
        date: '2026-07-07',
        vendor: '取引先',
        amountYen: 41080,
        ext: 'pdf',
      }),
    ).toBe('証憑/RCP-000001_2026-07-07_取引先_41080.pdf')
  })
})

describe('ensureUniqueRelativePath', () => {
  it('appends _2/_3 on collision', () => {
    const occupied = new Set<string>()
    const first = ensureUniqueRelativePath(occupied, '証憑/a.pdf')
    const second = ensureUniqueRelativePath(occupied, '証憑/a.pdf')
    const third = ensureUniqueRelativePath(occupied, '証憑/a.pdf')
    expect(first).toBe('証憑/a.pdf')
    expect(second).toBe('証憑/a_2.pdf')
    expect(third).toBe('証憑/a_3.pdf')
  })
})
