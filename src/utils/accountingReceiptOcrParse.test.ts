import { describe, expect, it } from 'vitest'
import {
  buildSuggestedExpenseCategory,
  extractConsumptionTaxAmount,
  extractInvoiceNumber,
  extractProductDescription,
  extractReceiptDate,
  extractTaxIncludedAmount,
  extractTaxRate,
  extractVendorName,
  parseAccountingReceiptOcrText,
  toHalfWidthAscii,
} from './accountingReceiptOcrParse'
import { suggestExpenseCategoryFromReceiptText } from './accountingReceiptExpenseCategorySuggest'

describe('toHalfWidthAscii', () => {
  it('converts full-width alphanumerics', () => {
    expect(toHalfWidthAscii('Ｔ１２３４５６７８９０１２３')).toBe('T1234567890123')
  })
})

describe('extractInvoiceNumber', () => {
  it.each([
    ['T1234567890123', 'T1234567890123'],
    ['登録番号 T 1234 5678 9012 3', 'T1234567890123'],
    ['T-1234-5678-9012-3', 'T1234567890123'],
    ['Ｔ１２３４５６７８９０１２３', 'T1234567890123'],
  ])('normalizes %s', (input, expected) => {
    expect(extractInvoiceNumber(input)).toBe(expected)
  })
})

describe('extractReceiptDate', () => {
  it.each([
    ['2026/07/08', '2026-07-08'],
    ['2026-07-08', '2026-07-08'],
    ['2026年7月8日', '2026-07-08'],
    ['26/07/08', '2026-07-08'],
  ])('parses %s', (input, expected) => {
    expect(extractReceiptDate(input)).toBe(expected)
  })
})

describe('extractTaxIncludedAmount', () => {
  it('prefers total keywords', () => {
    const text = `
      小計 ￥1,000
      合計 ￥1,100
      お釣り ￥0
    `

    expect(extractTaxIncludedAmount(text)).toBe(1100)
  })

  it('supports yen formats', () => {
    expect(extractTaxIncludedAmount('総合計 ¥1,100')).toBe(1100)
    expect(extractTaxIncludedAmount('お支払金額 1100円')).toBe(1100)
  })

  it('reads amount on the next line after total keyword', () => {
    expect(extractTaxIncludedAmount('合計\n￥995')).toBe(995)
  })

  it('matches spaced total keyword from OCR noise', () => {
    expect(extractTaxIncludedAmount('合 計\n995')).toBe(995)
  })

  it('prefers お買上 and ご請求 keywords', () => {
    expect(extractTaxIncludedAmount('お買上 995')).toBe(995)
    expect(extractTaxIncludedAmount('ご請求額 ￥995')).toBe(995)
  })

  it('ignores date-like concatenated numbers near total', () => {
    const text = `
      2026/07/08
      2026708
      合計
      ￥995
      消費税 90
      T4200001013662
    `
    expect(extractTaxIncludedAmount(text)).toBe(995)
  })

  it('does not prefer huge OCR noise over total amount', () => {
    const text = `
      Seria
      2026年7月8日
      登録番号 T4200001013662
      合計 ￥995
      ポイント残高 2026707
      消費税 90
    `
    expect(extractTaxIncludedAmount(text)).toBe(995)
    expect(extractConsumptionTaxAmount(text, 995)).toBe(90)
  })
})

describe('extractConsumptionTaxAmount', () => {
  it('extracts tax near keyword', () => {
    expect(extractConsumptionTaxAmount('消費税 100円')).toBe(100)
  })

  it('reads tax on the next line', () => {
    expect(extractConsumptionTaxAmount('消費税\n90', 995)).toBe(90)
  })

  it('extracts 内税額 keyword', () => {
    expect(extractConsumptionTaxAmount('内税額 90', 995)).toBe(90)
  })
})

describe('extractTaxRate', () => {
  it('returns undefined when rate is not present', () => {
    expect(extractTaxRate('合計 1,100円')).toBeUndefined()
  })

  it('detects 8 percent', () => {
    expect(extractTaxRate('軽減税率 8%')).toBe(8)
  })
})

describe('extractVendorName', () => {
  it('finds company-like line', () => {
    expect(extractVendorName('株式会社テスト薬局\n2026/07/08\n合計 1,100円')).toBe('株式会社テスト薬局')
  })

  it('finds Seria receipt vendor', () => {
    expect(extractVendorName('Seria\n2026/07/08\n合計 995')).toBe('Seria')
    expect(extractVendorName('セリア\n2026/07/08\n合計 995')).toBe('セリア')
  })
})

describe('parseAccountingReceiptOcrText', () => {
  it('builds parsed fields from receipt-like text', () => {
    const parsed = parseAccountingReceiptOcrText(`
      株式会社サンプル
      2026年7月8日
      合計 ￥1,100
      消費税 100円
      登録番号 T1234567890123
    `)

    expect(parsed.receiptDate).toBe('2026-07-08')
    expect(parsed.vendorName).toBe('株式会社サンプル')
    expect(parsed.taxIncludedAmount).toBe(1100)
    expect(parsed.consumptionTaxAmount).toBe(100)
    expect(parsed.taxRate).toBeUndefined()
    expect(parsed.invoiceNumber).toBe('T1234567890123')
  })

  it('extracts custom or preset tax rate when percent is present', () => {
    expect(
      extractTaxRate(`
      合計 1,050
      消費税等(5%) 50円
    `),
    ).toBe(5)
    expect(extractTaxRate('軽減税率 適用')).toBe(8)
    expect(extractTaxRate('税率 10 %')).toBe(10)
  })

  it('builds parsed fields from Seria-like receipt text', () => {
    const parsed = parseAccountingReceiptOcrText(`
      Seria
      2026/07/08
      ホッチキス 100
      スマートブラシ 200
      スタンプマット 300
      合計 995
      消費税 90
      登録番号 T4200001013662
    `)

    expect(parsed.vendorName).toBe('Seria')
    expect(parsed.receiptDate).toBe('2026-07-08')
    expect(parsed.taxIncludedAmount).toBe(995)
    expect(parsed.consumptionTaxAmount).toBe(90)
    expect(parsed.description).toBe('ホッチキス・スマートブラシ・スタンプマット')
    expect(parsed.invoiceNumber).toBe('T4200001013662')
    expect(buildSuggestedExpenseCategory(parsed)).toBe('事務用品・雑費')
  })
})

describe('extractProductDescription', () => {
  it('joins product lines with middle dot', () => {
    expect(
      extractProductDescription(`
        ホッチキス 100
        スマートブラシ 200
        合計 995
      `),
    ).toBe('ホッチキス・スマートブラシ')
  })
})

describe('suggestExpenseCategoryFromReceiptText', () => {
  it('maps stationery products to 事務用品・雑費', () => {
    expect(
      suggestExpenseCategoryFromReceiptText({
        description: 'ホッチキス・スタンプマット',
        vendorName: 'Seria',
      }),
    ).toBe('事務用品・雑費')
  })
})
