import { describe, expect, it } from 'vitest'
import {
  buildOcrCandidatesFromParsed,
  classifyReceiptWithoutInvoice,
  extractAddress,
  extractPhoneNumber,
  isPublicFeeReceiptText,
} from './accountingReceiptClassification'

describe('public fee classification', () => {
  it('detects city office / registry keywords', () => {
    expect(isPublicFeeReceiptText('市役所 印鑑登録証明書 手数料 300円')).toBe(true)
    expect(isPublicFeeReceiptText('セリア ホッチキス')).toBe(false)
  })

  it('sets not_required for public fees', () => {
    const hint = classifyReceiptWithoutInvoice({
      text: '〇〇市役所\n印鑑登録証明書\n手数料 300円',
      vendorName: '〇〇市役所',
    })
    expect(hint.invoiceStatus).toBe('not_required')
    expect(hint.taxAmount).toBe(0)
    expect(hint.accountTitle).toBe('支払手数料')
    expect(hint.description).toBe('証明書発行手数料')
  })
})

describe('small business without invoice', () => {
  it('sets invoiceStatus none with taxable', () => {
    const hint = classifyReceiptWithoutInvoice({
      text: '山田商店\nTEL 03-1234-5678\n合計 1980',
      vendorName: '山田商店',
      phoneNumber: '03-1234-5678',
    })
    expect(hint.invoiceStatus).toBe('none')
    expect(hint.taxCategory).toBe('taxable')
    expect(hint.notice).toContain('仕入税額控除')
  })
})

describe('extractPhoneNumber / extractAddress', () => {
  it('extracts phone and address', () => {
    expect(extractPhoneNumber('TEL:03-1234-5678')).toBe('03-1234-5678')
    expect(extractAddress('〒123-4567 東京都港区芝1丁目2番3号')).toContain('東京都港区')
  })
})

describe('buildOcrCandidatesFromParsed', () => {
  it('keeps verified status when invoice number exists', () => {
    const candidates = buildOcrCandidatesFromParsed({
      parsed: {
        invoiceNumber: 'T4200001013662',
        invoiceRegisteredName: '株式会社セリア',
        invoiceCheckStatus: '確認済',
        vendorName: 'Seria',
        receiptDate: '2026-07-08',
        taxIncludedAmount: 995,
        consumptionTaxAmount: 90,
      },
      rawText: 'Seria\n合計 995\nT4200001013662',
      suggestedExpenseCategory: '消耗品費',
    })
    expect(candidates.invoiceStatus).toBe('verified')
    expect(candidates.vendorName).toBe('Seria')
    expect(candidates.invoiceRegisteredName).toBe('株式会社セリア')
  })

  it('classifies no-invoice public fee from raw text', () => {
    const candidates = buildOcrCandidatesFromParsed({
      parsed: {
        vendorName: '千葉市役所',
        receiptDate: '2026-07-01',
        taxIncludedAmount: 300,
      },
      rawText: '千葉市役所\n住民票\n手数料 300円',
      suggestedExpenseCategory: '',
    })
    expect(candidates.invoiceStatus).toBe('not_required')
    expect(candidates.taxAmount).toBe(0)
  })
})
